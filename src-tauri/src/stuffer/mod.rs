// Stuffer providers — integration with external stuffer panels (couriers/drops).
//
// Провайдеры (см. docs/API_STUFFER.md и PARALLEL_WORK.md / FEAT-013):
//   * `swat`  — панель StockHub (dash.stockhubdeal.com), прежний «stuffer».
//               Ключи конфига: stuffer_api_key / stuffer_base_url (пока
//               принадлежат SWAT; при появлении второго провайдера —
//               swat_api_key с фолбэком на старый ключ).
//   * `cargo` — отдельный API (нет документации) — добавляется реализацией
//               trait Provider в `cargo.rs` + регистрацией в `provider_by_id`.
//
// Общий контракт описан трейтом `Provider`: единые модели
// (CourierFull/Package/…) нормализуются из ответов конкретной панели.
// Единая точка создания — `provider_by_id`; расширение схемы ответов панели —
// забота модуля провайдера, команды и фронтенд работают с нормальными моделями.
//
// The API key is a secret: never logged nor returned to the frontend.

mod swat;

pub use swat::{
    CourierAvailable, CourierFull, LabelFile, Package, PackageComment, PackageInput, PackageLabel,
    PackagesCount, SwatProvider, TrackInput, DEFAULT_BASE_URL,
};

/// Возможности провайдера: енумы, которые различаются между панелями и потому
/// не хардкодятся в UI. Форма создания посылки берёт список отсюда.
#[derive(Debug, Clone, Default)]
pub struct ProviderCapabilities {
    /// Допустимые значения pay_option (жёстко валидируются панелью).
    pub pay_options: Vec<String>,
}

/// Общий контракт внешней панели стаффинга (курьеры/дропы + посылки).
pub trait Provider: Send + Sync {
    /// Стабильный id провайдера ("swat" / "cargo") — сохраняется в конфиге.
    fn id(&self) -> &'static str;
    /// Имя для UI.
    fn display_name(&self) -> &'static str;
    /// Енумы провайдера для форм UI.
    fn capabilities(&self) -> ProviderCapabilities;

    fn list_couriers(&self) -> Result<Vec<CourierFull>, String>;
    fn list_available_couriers(&self) -> Result<Vec<CourierAvailable>, String>;
    fn add_courier(&self, courier_id: i64) -> Result<CourierFull, String>;
    fn list_packages(&self) -> Result<Vec<Package>, String>;
    fn get_labels(&self, package_id: i64) -> Result<Vec<LabelFile>, String>;
    fn create_package(&self, package: &PackageInput) -> Result<i64, String>;
}

/// Все известные провайдеры (для UI-переключателя SWAT/CARGO).
pub const PROVIDER_IDS: &[&str] = &["swat"];

/// Фабрика провайдера по id. Неизвестный id → ошибка (не паника).
pub fn provider_by_id(id: &str, base_url: &str, api_key: &str) -> Result<Box<dyn Provider>, String> {
    match id {
        "swat" => Ok(Box::new(SwatProvider::new(base_url, api_key))),
        other => Err(format!("stuffer_unknown_provider: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_by_id_swat() {
        let p = provider_by_id("swat", "https://example.com/api/", "k").unwrap();
        assert_eq!(p.id(), "swat");
        assert_eq!(p.display_name(), "SWAT");
        assert!(!p.capabilities().pay_options.is_empty());
        assert_eq!(
            p.capabilities().pay_options,
            vec!["%", "forwarding", "test", "50/50_admin", "50/50_stuffer", "sale"]
        );
    }

    #[test]
    fn test_provider_by_id_unknown() {
        let err = provider_by_id("cargo", "https://example.com/api/", "k")
            .err()
            .unwrap();
        assert!(err.contains("stuffer_unknown_provider"), "got: {}", err);
    }
}
