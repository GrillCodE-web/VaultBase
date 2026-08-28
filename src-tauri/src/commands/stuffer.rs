// Tauri commands: stuffer domain.
// Extracted from main.rs during module refactor.

use crate::state::*;
use crate::models::*;
use crate::database::{Database, fetch_bin_info};
use crate::models;
use crate::encryption::{FieldEncryption, PasswordValidation, generate_salt};
use crate::license::LicenseStatus;
use crate::rate_limiter;
use crate::sync;
use crate::imap;
use crate::stuffer;
use crate::smtp;
use crate::tracking;
use crate::ws_sync;
use crate::parser;
use crate::endpoints;
use crate::license;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use tauri::{Manager, Emitter};
use bcrypt;
use chrono;
use serde_json;
use std::collections::HashMap;

#[tauri::command]
pub(crate) fn stuffer_get_config() -> Result<StufferConfigView, String> {
    with_db!(db, {
        let api_key_set = db
            .get_config("stuffer_api_key")
            .map_err(|e| e.to_string())?
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let base_url = db
            .get_config("stuffer_base_url")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| crate::stuffer::DEFAULT_BASE_URL.to_string());
        let provider_id = db
            .get_config("stuffer_provider")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "swat".to_string());
        // Capabilities не требуют кредов: конструируем провайдер пустыми
        // ключами только чтобы отдать фронтенду енумы панели (pay options).
        let pay_options = crate::stuffer::provider_by_id(&provider_id, "", "")?
            .capabilities()
            .pay_options;
        Ok(StufferConfigView {
            api_key_set,
            base_url,
            provider: provider_id,
            pay_options,
        })
    })
}

#[tauri::command]
pub(crate) fn stuffer_set_config(api_key: Option<String>, base_url: String) -> Result<(), String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    with_db!(db, {
        let base = if base_url.trim().is_empty() {
            crate::stuffer::DEFAULT_BASE_URL.to_string()
        } else {
            base_url.trim().to_string()
        };
        db.set_config("stuffer_base_url", &base).map_err(|e| e.to_string())?;
        // Пустой api_key => не трогаем сохранённый ключ (поле оставили пустым).
        if let Some(key) = api_key {
            if !key.trim().is_empty() {
                db.set_config("stuffer_api_key", key.trim()).map_err(|e| e.to_string())?;
            }
        }
        db.log_event("stuffer.config_updated", "Stuffer API config saved", Some("stuffer"), None)?;
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn stuffer_list_couriers() -> Result<Vec<crate::stuffer::CourierFull>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    active_provider()?.list_couriers()
}

#[tauri::command]
pub(crate) fn stuffer_list_available_couriers() -> Result<Vec<crate::stuffer::CourierAvailable>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    active_provider()?.list_available_couriers()
}

#[tauri::command]
pub(crate) fn stuffer_add_courier(courier_id: i64) -> Result<crate::stuffer::CourierFull, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let courier = active_provider()?.add_courier(courier_id)?;
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.courier_added",
            &format!("Courier {} added", courier_id),
            Some("stuffer"),
            Some(&courier_id.to_string()),
        );
    });
    Ok(courier)
}

#[tauri::command]
pub(crate) fn stuffer_list_packages() -> Result<Vec<crate::stuffer::Package>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    active_provider()?.list_packages()
}

#[tauri::command]
pub(crate) fn stuffer_get_labels(package_id: i64) -> Result<Vec<crate::stuffer::LabelFile>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    active_provider()?.get_labels(package_id)
}

#[tauri::command]
pub(crate) fn stuffer_create_package(
    package: crate::stuffer::PackageInput,
    account_id: Option<i64>,
) -> Result<i64, String> {
    require_perm(models::perms::CREATE_PACKAGES)?;
    // FEAT-011: посылка создаётся ключом аккаунта-источника курьера
    // (общий список). Без account_id — легаси-ключ из настроек.
    let provider = match account_id {
        Some(id) if id > 0 => provider_for_account(id)?,
        _ => active_provider()?,
    };
    let package_id = provider.create_package(&package)?;
    // FEAT-009: запоминаем последнюю созданную посылку — stuffer_link_order_package
    // без явного package_id привяжет именно её (сценарий «создал из карточки заказа»).
    if let Ok(mut last) = LAST_CREATED_PACKAGE.lock() {
        *last = Some(package_id);
    }
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.package_created",
            &format!("Package {} created", package_id),
            Some("stuffer"),
            Some(&package_id.to_string()),
        );
    });
    Ok(package_id)
}

/// FEAT-012: live-тест пишущих методов провайдера (add_courier +
/// new_package). Возвращает отчёт по шагам — UI показывает, на каком шаге
/// панель отвалилась. Пишет на панель по-настоящему: тест-пакет с
/// pay_option «test».
#[tauri::command]
pub(crate) fn stuffer_test_write() -> Result<crate::stuffer::WriteTestReport, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let report = active_provider()?.test_write();
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.write_tested",
            &format!(
                "Write test {}: {} step(s)",
                if report.ok { "ok" } else { "failed" },
                report.steps.len()
            ),
            Some("stuffer"),
            None,
        );
    });
    Ok(report)
}

// ── FEAT-009: привязка посылок панели к заказам ──

/// Привязать заказ к посылке. Если `package_id` не передан, берётся последняя
/// созданная этим пользователем посылка (stuffer_create_package) — сценарий
/// «создал посылку из карточки заказа» без ручного ввода номера.
#[tauri::command]
pub(crate) fn stuffer_link_order_package(
    order_id: i64,
    package_id: Option<i64>,
    courier_id: Option<i64>,
    track: Option<String>,
) -> Result<OrderPackageLink, String> {
    require_any_perm(&[models::perms::CREATE_PACKAGES, models::perms::MANAGE_COURIERS])?;
    let pid = match package_id {
        Some(p) => p,
        None => LAST_CREATED_PACKAGE
            .lock()
            .map_err(|_| "stuffer_state_poisoned".to_string())?
            .ok_or_else(|| "no_recent_package".to_string())?,
    };
    let provider = active_provider_id()?;
    let link = with_db!(db, {
        db.link_order_package(order_id, &provider, pid, courier_id, track.as_deref(), None)?
    });
    Ok(link)
}

#[tauri::command]
pub(crate) fn stuffer_unlink_order_package(order_id: i64, link_id: i64) -> Result<(), String> {
    require_any_perm(&[models::perms::CREATE_PACKAGES, models::perms::MANAGE_COURIERS])?;
    with_db!(db, { db.unlink_order_package(order_id, link_id) })
}

#[tauri::command]
pub(crate) fn stuffer_list_order_packages(order_id: i64) -> Result<Vec<OrderPackageLink>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    with_db!(db, { db.list_links_for_order(order_id) })
}

/// Посылки всех заказов профиля — цепочка карта → профиль → заказ → посылка.
#[tauri::command]
pub(crate) fn stuffer_list_profile_packages(profile_id: String) -> Result<Vec<ProfilePackageLink>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    with_db!(db, { db.list_links_for_profile(&profile_id) })
}

/// Обновить снапшоты (status/track/courier) привязанных посылок из живого
/// списка панели. Вызывается после list_packages.
#[tauri::command]
pub(crate) fn stuffer_refresh_package_snapshots() -> Result<u32, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    let provider = active_provider()?;
    let packages = provider.list_packages()?;
    let provider_id = provider.id().to_string();
    with_db!(db, { db.refresh_package_snapshots(&provider_id, &packages) })
}

// ── FEAT-010: теги курьеров ("использован под X"), sync по хешу личности ──
// На сервер уезжают только provider + SHA-256 хеш личности + тег — имена
// и адреса курьеров устройство не покидают.

/// Поставить тег курьеру. Поля личности приходят из CourierFull на фронте.
/// true = тег добавлен (false — уже был). Пуш группе best-effort.
#[tauri::command]
pub(crate) fn stuffer_add_courier_tag(
    courier_id: i64,
    name: String,
    address1: String,
    city: String,
    state: String,
    zip: String,
    tag: String,
) -> Result<bool, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let provider = active_provider_id()?;
    let hash = Database::courier_identity_hash(&provider, &name, &address1, &city, &state, &zip);
    with_db!(db, {
        let added = db.add_courier_tag(&provider, courier_id, &hash, &tag)?;
        if added {
            // оффлайн/не в группе — Ok(false), тег остаётся локальным
            let _ = sync::SyncGroupClient::push_courier_tag(db, &provider, &hash, &tag, "add");
        }
        Ok(added)
    })
}

/// Снять тег с курьера (по хешу — сносит и локальный, и пришедший из группы
/// экземпляр). true = тег был и снят.
#[tauri::command]
pub(crate) fn stuffer_remove_courier_tag(
    name: String,
    address1: String,
    city: String,
    state: String,
    zip: String,
    tag: String,
) -> Result<bool, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let provider = active_provider_id()?;
    let hash = Database::courier_identity_hash(&provider, &name, &address1, &city, &state, &zip);
    with_db!(db, {
        let removed = db.remove_courier_tag(&provider, &hash, &tag)?;
        if removed {
            let _ = sync::SyncGroupClient::push_courier_tag(db, &provider, &hash, &tag, "remove");
        }
        Ok(removed)
    })
}

/// Объединённые теги курьера: свои (по courier_id) + пришедшие из группы
/// (по хешу личности), без дублей, по алфавиту.
#[tauri::command]
pub(crate) fn stuffer_list_courier_tags(
    courier_id: i64,
    name: String,
    address1: String,
    city: String,
    state: String,
    zip: String,
) -> Result<Vec<String>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    let provider = active_provider_id()?;
    let hash = Database::courier_identity_hash(&provider, &name, &address1, &city, &state, &zip);
    with_db!(db, {
        let mut tags = db.list_courier_tags(&provider, courier_id)?;
        for t in db.list_courier_tags_by_hash(&provider, &hash)? {
            if !tags.contains(&t) { tags.push(t); }
        }
        tags.sort();
        Ok(tags)
    })
}

// ── FEAT-011: общий список курьеров по аккаунтам панели ──
// У каждого аккаунта свой API-ключ; список агрегируется со всех настроенных
// аккаунтов (легаси-ключ из настроек = псевдоаккаунт #0 «Default» +
// записи stuffer_accounts). Падение одного аккаунта не роняет весь список.

/// Курьер в общем списке: данные панели + аккаунт-источник.
#[derive(serde::Serialize)]
pub(crate) struct SharedCourier {
    account_id: i64,
    account_label: String,
    #[serde(flatten)]
    courier: crate::stuffer::CourierFull,
}

/// Аккаунт, чей список курьеров не загрузился (сеть/ключ/панель).
#[derive(serde::Serialize)]
pub(crate) struct SharedCourierError {
    account_id: i64,
    account_label: String,
    error: String,
}

#[derive(serde::Serialize)]
pub(crate) struct SharedCourierList {
    couriers: Vec<SharedCourier>,
    errors: Vec<SharedCourierError>,
}

/// Источники общего списка: (account_id, label, provider_id, base_url, api_key).
/// Легаси-ключ из настроек — account_id=0; аккаунт-дубликат легаси-ключа
/// (та же тройка provider+url+key) пропускается, чтобы не плодить дубли.
fn stuffer_account_sources() -> Result<Vec<(i64, String, String, String, String)>, String> {
    with_db!(db, {
        let mut sources: Vec<(i64, String, String, String, String)> = Vec::new();
        if let Some(key) = db.get_config("stuffer_api_key").map_err(|e| e.to_string())? {
            if !key.is_empty() {
                let base = db.get_config("stuffer_base_url").map_err(|e| e.to_string())?
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| crate::stuffer::DEFAULT_BASE_URL.to_string());
                let provider = db.get_config("stuffer_provider").map_err(|e| e.to_string())?
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "swat".to_string());
                sources.push((0, "Default".to_string(), provider, base, key));
            }
        }
        for acc in db.list_stuffer_accounts()? {
            if acc.api_key.is_empty() { continue; }
            let base = if acc.base_url.is_empty() {
                crate::stuffer::DEFAULT_BASE_URL.to_string()
            } else {
                acc.base_url.clone()
            };
            if sources.iter().any(|(_, _, p, b, k)| p == &acc.provider && b == &base && k == &acc.api_key) {
                continue;
            }
            sources.push((acc.id, acc.label, acc.provider, base, acc.api_key));
        }
        Ok(sources)
    })
}

/// Провайдер конкретного аккаунта из реестра (его индивидуальный API-ключ).
fn provider_for_account(account_id: i64) -> Result<Box<dyn stuffer::Provider>, String> {
    let acc = with_db!(db, { db.get_stuffer_account(account_id) })?;
    let base = if acc.base_url.is_empty() {
        crate::stuffer::DEFAULT_BASE_URL.to_string()
    } else {
        acc.base_url
    };
    stuffer::provider_by_id(&acc.provider, &base, &acc.api_key)
}

/// Общий список курьеров со всех аккаунтов. Ошибки по отдельным аккаунтам
/// возвращаются в errors, список остальных при этом отдаётся.
#[tauri::command]
pub(crate) fn stuffer_list_all_couriers() -> Result<SharedCourierList, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    let sources = stuffer_account_sources()?;
    let mut out = SharedCourierList { couriers: Vec::new(), errors: Vec::new() };
    for (account_id, label, provider_id, base_url, api_key) in sources {
        match stuffer::provider_by_id(&provider_id, &base_url, &api_key)
            .and_then(|p| p.list_couriers())
        {
            Ok(cs) => out.couriers.extend(cs.into_iter().map(|courier| SharedCourier {
                account_id,
                account_label: label.clone(),
                courier,
            })),
            Err(e) => out.errors.push(SharedCourierError {
                account_id,
                account_label: label,
                error: e,
            }),
        }
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn stuffer_list_accounts() -> Result<Vec<StufferAccount>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    with_db!(db, { db.list_stuffer_accounts() })
}

#[tauri::command]
pub(crate) fn stuffer_add_account(
    label: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<i64, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let label = label.trim().to_string();
    let base = base_url.as_deref().unwrap_or("").trim().to_string();
    let key = api_key.trim().to_string();
    with_db!(db, {
        let id = db.add_stuffer_account(&label, &base, &key)?;
        let _ = db.log_event(
            "stuffer.account_added",
            &format!("Stuffer account '{}' added", label),
            Some("stuffer"),
            Some(&id.to_string()),
        );
        Ok(id)
    })
}

#[tauri::command]
pub(crate) fn stuffer_delete_account(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    with_db!(db, {
        db.delete_stuffer_account(id)?;
        let _ = db.log_event(
            "stuffer.account_deleted",
            &format!("Stuffer account {} deleted", id),
            Some("stuffer"),
            Some(&id.to_string()),
        );
        Ok(())
    })
}

pub(crate) fn stuffer_creds() -> Result<(String, String), String> {
    with_db!(db, {
        let api_key = db
            .get_config("stuffer_api_key")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "stuffer_not_configured".to_string())?;
        let base_url = db
            .get_config("stuffer_base_url")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| crate::stuffer::DEFAULT_BASE_URL.to_string());
        Ok((base_url, api_key))
    })
}

/// Активный провайдер стаффинга. Сейчас доступен SWAT (панель StockHub);
/// переключение SWAT/CARGO — по конфигу `stuffer_provider` (FEAT-013:
/// CARGO добавляется реализацией trait Provider и регистрацией в
/// provider_by_id, команды и фронтенд при этом не меняются).
fn active_provider() -> Result<Box<dyn stuffer::Provider>, String> {
    let provider_id = active_provider_id()?;
    let (base_url, api_key) = stuffer_creds()?;
    stuffer::provider_by_id(&provider_id, &base_url, &api_key)
}

/// FEAT-009: id активного провайдера без чтения кредов — для записи
/// провайдера в локальные связи заказ↔посылка.
fn active_provider_id() -> Result<String, String> {
    with_db!(db, {
        Ok::<String, String>(db
            .get_config("stuffer_provider")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "swat".to_string()))
    })
}

/// FEAT-009: последняя созданная этим процессом посылка — дефолт для
/// stuffer_link_order_package без явного package_id.
static LAST_CREATED_PACKAGE: Mutex<Option<i64>> = Mutex::new(None);

#[derive(serde::Serialize)]
pub(crate) struct StufferConfigView {
    api_key_set: bool,
    base_url: String,
    provider: String,
    pay_options: Vec<String>,
}
