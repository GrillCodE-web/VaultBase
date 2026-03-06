// ============================================================
// PATCH — merge these keys into i18n/en.js and i18n/ru.js
// ============================================================

// ── en.js additions ──────────────────────────────────────────
export const LICENSE_KEYS_EN = {
  // Activate screen
  activate_title:          "Activation Required",
  activate_subtitle:       "This copy of CC Manager must be activated.",
  activate_your_code:      "Your installation code:",
  activate_instruction:    "Send this code to your administrator to receive an activation key.",
  activate_key_label:      "Activation Key",
  activate_key_invalid:    "Enter a complete 16-character activation key.",
  activate_btn:            "Activate",
  activating:              "Activating…",
  activate_success:        "Activated! Loading…",
  activate_success_btn:    "✓ Activated",
  activate_err_invalid_key:"Invalid activation key.",
  activate_err_already:    "Already activated on this device.",
  activate_err_network:    "Network error. Check your connection and try again.",
  activate_err_unknown:    "Error",

  // Revoked screen
  license_revoked_title:   "License Revoked",
  license_revoked_body:    "Your license has been revoked. Please contact your administrator.",

  // Settings — License section
  settings_license:        "License",
  settings_license_status: "Status",
  settings_installation_id:"Installation ID",
  license_active:          "Active",
  license_revoked:         "Revoked",
  license_offline:         "Offline",
  license_none:            "Not Activated",
  license_retry:           "Retry Connection",
  license_retrying:        "Retrying…",
  license_verified:        "License verified successfully.",

  // Misc
  offline_mode:            "Offline",
};

// ── ru.js additions ──────────────────────────────────────────
export const LICENSE_KEYS_RU = {
  // Activate screen
  activate_title:          "Требуется активация",
  activate_subtitle:       "Эта копия CC Manager должна быть активирована.",
  activate_your_code:      "Ваш код установки:",
  activate_instruction:    "Отправьте этот код администратору, чтобы получить ключ активации.",
  activate_key_label:      "Ключ активации",
  activate_key_invalid:    "Введите полный 16-символьный ключ активации.",
  activate_btn:            "Активировать",
  activating:              "Активация…",
  activate_success:        "Активировано! Загрузка…",
  activate_success_btn:    "✓ Активировано",
  activate_err_invalid_key:"Неверный ключ активации.",
  activate_err_already:    "Уже активировано на этом устройстве.",
  activate_err_network:    "Ошибка сети. Проверьте соединение и попробуйте снова.",
  activate_err_unknown:    "Ошибка",

  // Revoked screen
  license_revoked_title:   "Лицензия отозвана",
  license_revoked_body:    "Ваша лицензия отозвана. Обратитесь к администратору.",

  // Settings — License section
  settings_license:        "Лицензия",
  settings_license_status: "Статус",
  settings_installation_id:"ID установки",
  license_active:          "Активна",
  license_revoked:         "Отозвана",
  license_offline:         "Офлайн",
  license_none:            "Не активирована",
  license_retry:           "Повторить подключение",
  license_retrying:        "Подключение…",
  license_verified:        "Лицензия успешно проверена.",

  // Misc
  offline_mode:            "Офлайн",
};
