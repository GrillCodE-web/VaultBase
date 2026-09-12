// Stuffer providers — integration with external stuffer panels (couriers/drops).
//
// Провайдеры (см. docs/archive/API_STUFFER.md и PARALLEL_WORK.md / FEAT-013):
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
    AddTrackResult, CourierAvailable, CourierFull, LabelFile, Package, PackageComment, PackageInput,
    PackageLabel, PackagesCount, SwatProvider, TrackInput, DEFAULT_BASE_URL,
};

/// Возможности провайдера: енумы, которые различаются между панелями и потому
/// не хардкодятся в UI. Форма создания посылки берёт список отсюда.
#[derive(Debug, Clone, Default)]
pub struct ProviderCapabilities {
    /// Допустимые значения pay_option (жёстко валидируются панелью).
    pub pay_options: Vec<String>,
}

/// Шаг live-теста пишущих методов (FEAT-012).
#[derive(Debug, Clone, serde::Serialize)]
pub struct WriteTestStep {
    /// Стабильный id шага: list_couriers / add_courier / new_package.
    pub step: String,
    /// ok | skipped | fail.
    pub status: String,
    /// Деталь: количество курьеров, id посылки, текст ошибки.
    pub detail: String,
}

/// Отчёт live-теста пишущих методов: UI показывает шаги по одному.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WriteTestReport {
    /// id провайдера (swat/…).
    pub provider: String,
    /// true только если ни один шаг не упал.
    pub ok: bool,
    pub steps: Vec<WriteTestStep>,
}

impl WriteTestReport {
    fn finish(provider: &str, mut steps: Vec<WriteTestStep>) -> Self {
        let ok = steps.iter().all(|s| s.status != "fail");
        Self {
            provider: provider.to_string(),
            ok,
            steps,
        }
    }
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
    /// Одна посылка по ID (метод `package`, апдейт панели 2026-09). В отличие
    /// от list_packages (до 500 свежих) находит и архивные посылки стаффера.
    fn get_package(&self, package_id: i64) -> Result<Package, String>;
    fn get_labels(&self, package_id: i64) -> Result<Vec<LabelFile>, String>;
    fn create_package(&self, package: &PackageInput) -> Result<i64, String>;
    /// Добавить трек к существующей посылке (метод `add_track`, апдейт панели
    /// 2026-09). Возвращает добавленный трек и полный список треков посылки.
    fn add_track(
        &self,
        package_id: i64,
        track: &str,
        carrier: &str,
    ) -> Result<AddTrackResult, String>;

    /// Live-тест пишущих методов (FEAT-012): add_courier + new_package.
    /// Провайдер-агностичный — собирается из методов трейта, поэтому работает
    /// для SWAT/CARGO без изменений. Побочный эффект осознанный: на панели
    /// появляется реальная тест-посылка (pay_option «test», если панель его
    /// поддерживает).
    fn test_write(&self) -> WriteTestReport {
        let mut steps = Vec::new();
        let couriers = match self.list_couriers() {
            Ok(c) => c,
            Err(e) => {
                steps.push(WriteTestStep {
                    step: "list_couriers".into(),
                    status: "fail".into(),
                    detail: e,
                });
                return WriteTestReport::finish(self.id(), steps);
            }
        };
        steps.push(WriteTestStep {
            step: "list_couriers".into(),
            status: "ok".into(),
            detail: format!("{} assigned courier(s)", couriers.len()),
        });

        // Курьер для теста: назначенный (add_courier тогда не нужен) или
        // первый свободный через add_courier. Ничего лишнего аккаунту не
        // добавляем: attach делаем только если назначенных нет вообще.
        let courier_id = if let Some(first) = couriers.first() {
            steps.push(WriteTestStep {
                step: "add_courier".into(),
                status: "skipped".into(),
                detail: format!("courier #{} already assigned", first.id),
            });
            first.id
        } else {
            let picked_id = match self.list_available_couriers() {
                Ok(avail) => match avail.first() {
                    Some(c) => c.id,
                    None => {
                        steps.push(WriteTestStep {
                            step: "add_courier".into(),
                            status: "fail".into(),
                            detail: "no available couriers on the panel".into(),
                        });
                        return WriteTestReport::finish(self.id(), steps);
                    }
                },
                Err(e) => {
                    steps.push(WriteTestStep {
                        step: "add_courier".into(),
                        status: "fail".into(),
                        detail: e,
                    });
                    return WriteTestReport::finish(self.id(), steps);
                }
            };
            match self.add_courier(picked_id) {
                Ok(c) => {
                    steps.push(WriteTestStep {
                        step: "add_courier".into(),
                        status: "ok".into(),
                        detail: format!("courier #{} attached", c.id),
                    });
                    c.id
                }
                Err(e) => {
                    steps.push(WriteTestStep {
                        step: "add_courier".into(),
                        status: "fail".into(),
                        detail: e,
                    });
                    return WriteTestReport::finish(self.id(), steps);
                }
            }
        };

        // pay_option «test» есть в енуме SWAT; у провайдера без него берём
        // первую опцию из его capabilities.
        let caps = self.capabilities();
        let pay_option = if caps.pay_options.iter().any(|p| p == "test") {
            "test".to_string()
        } else {
            caps.pay_options
                .first()
                .cloned()
                .unwrap_or_else(|| "test".to_string())
        };
        let package = PackageInput {
            courier_id,
            name: Some("VaultBase live test".into()),
            shop: Some("vaultbase-test".into()),
            pay_option: Some(pay_option),
            price: Some(1.0),
            quantity: Some(1),
            weight: Some("0".into()),
            ..Default::default()
        };
        match self.create_package(&package) {
            Ok(id) => steps.push(WriteTestStep {
                step: "new_package".into(),
                status: "ok".into(),
                detail: format!("package #{} created", id),
            }),
            Err(e) => steps.push(WriteTestStep {
                step: "new_package".into(),
                status: "fail".into(),
                detail: e,
            }),
        }
        WriteTestReport::finish(self.id(), steps)
    }
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

    // ── FEAT-012: test_write (default-метод трейта) на моке ──

    struct MockProvider {
        assigned: Result<Vec<CourierFull>, String>,
        available: Result<Vec<CourierAvailable>, String>,
        add_result: Result<CourierFull, String>,
        create_result: Result<i64, String>,
    }

    impl MockProvider {
        /// Курсор-курьер с минимальными полями (остальные — serde-дефолты).
        fn courier(id: i64) -> CourierFull {
            serde_json::from_value(serde_json::json!({ "id": id, "name": "C" })).unwrap()
        }
        fn available(id: i64) -> CourierAvailable {
            serde_json::from_value(serde_json::json!({ "id": id })).unwrap()
        }
    }

    impl Provider for MockProvider {
        fn id(&self) -> &'static str {
            "mock"
        }
        fn display_name(&self) -> &'static str {
            "Mock"
        }
        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities {
                pay_options: vec!["test".into(), "%".into()],
            }
        }
        fn list_couriers(&self) -> Result<Vec<CourierFull>, String> {
            self.assigned.clone()
        }
        fn list_available_couriers(&self) -> Result<Vec<CourierAvailable>, String> {
            self.available.clone()
        }
        fn add_courier(&self, courier_id: i64) -> Result<CourierFull, String> {
            if courier_id != 7 {
                return Err(format!("mock: unexpected courier #{}", courier_id));
            }
            self.add_result.clone()
        }
        fn list_packages(&self) -> Result<Vec<Package>, String> {
            Ok(vec![])
        }
        fn get_package(&self, _package_id: i64) -> Result<Package, String> {
            serde_json::from_value(serde_json::json!({ "id": 0 })).map_err(|e| e.to_string())
        }
        fn get_labels(&self, _package_id: i64) -> Result<Vec<LabelFile>, String> {
            Ok(vec![])
        }
        fn create_package(&self, package: &PackageInput) -> Result<i64, String> {
            // Тестовый пакет обязан прийти «test» (cap содержит) и на целевого курьера.
            assert_eq!(package.pay_option.as_deref(), Some("test"));
            assert_eq!(package.shop.as_deref(), Some("vaultbase-test"));
            match &self.create_result {
                Ok(id) => Ok(*id),
                Err(e) => Err(e.clone()),
            }
        }
        fn add_track(
            &self,
            _package_id: i64,
            _track: &str,
            _carrier: &str,
        ) -> Result<AddTrackResult, String> {
            Err("mock: add_track not used".into())
        }
    }

    fn steps_as_string(report: &WriteTestReport) -> Vec<(String, String)> {
        report
            .steps
            .iter()
            .map(|s| (s.step.clone(), s.status.clone()))
            .collect()
    }

    #[test]
    fn test_write_skips_add_when_courier_assigned() {
        let p = MockProvider {
            assigned: Ok(vec![MockProvider::courier(42)]),
            available: Err("must not be called".into()),
            add_result: Err("must not be called".into()),
            create_result: Ok(555),
        };
        let r = p.test_write();
        assert!(r.ok);
        assert_eq!(r.provider, "mock");
        assert_eq!(
            steps_as_string(&r),
            vec![
                ("list_couriers".into(), "ok".into()),
                ("add_courier".into(), "skipped".into()),
                ("new_package".into(), "ok".into()),
            ]
        );
        assert!(r.steps[2].detail.contains("#555"));
    }

    #[test]
    fn test_write_attaches_when_none_assigned() {
        let p = MockProvider {
            assigned: Ok(vec![]),
            available: Ok(vec![MockProvider::available(7)]),
            add_result: Ok(MockProvider::courier(7)),
            create_result: Ok(900),
        };
        let r = p.test_write();
        assert!(r.ok);
        assert_eq!(
            steps_as_string(&r),
            vec![
                ("list_couriers".into(), "ok".into()),
                ("add_courier".into(), "ok".into()),
                ("new_package".into(), "ok".into()),
            ]
        );
    }

    #[test]
    fn test_write_fails_when_no_available() {
        let p = MockProvider {
            assigned: Ok(vec![]),
            available: Ok(vec![]),
            add_result: Err("unreachable".into()),
            create_result: Err("unreachable".into()),
        };
        let r = p.test_write();
        assert!(!r.ok);
        assert_eq!(r.steps.len(), 2);
        assert_eq!(r.steps[1].status, "fail");
    }

    #[test]
    fn test_write_reports_create_failure() {
        let p = MockProvider {
            assigned: Ok(vec![MockProvider::courier(1)]),
            available: Err("unreachable".into()),
            add_result: Err("unreachable".into()),
            create_result: Err("Invalid pay_option".into()),
        };
        let r = p.test_write();
        assert!(!r.ok);
        assert_eq!(r.steps[2].status, "fail");
        assert!(r.steps[2].detail.contains("Invalid pay_option"));
    }

    #[test]
    fn test_write_first_step_reports_auth_error() {
        let p = MockProvider {
            assigned: Err("unauthorized".into()),
            available: Err("unreachable".into()),
            add_result: Err("unreachable".into()),
            create_result: Err("unreachable".into()),
        };
        let r = p.test_write();
        assert!(!r.ok);
        assert_eq!(r.steps.len(), 1);
        assert_eq!(r.steps[0].step, "list_couriers");
        assert!(r.steps[0].detail.contains("unauthorized"));
    }
}
