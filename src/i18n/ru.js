export const ru = {
  // Navigation
  nav_dashboard:"Дашборд", nav_cards:"Карты", nav_profiles:"Профили",
  nav_drops:"Дропы", nav_orders:"Заказы", nav_shops:"Магазины",
  nav_emails:"Email-пул", nav_proxies:"Прокси", nav_imap:"IMAP",
  nav_activity:"Лог активности", nav_settings:"Настройки",

  // Common
  btn_add:"Добавить", btn_save:"Сохранить", btn_cancel:"Отмена",
  btn_delete:"Удалить", btn_edit:"Редактировать", btn_import:"Импорт",
  btn_export:"Экспорт", btn_refresh:"Обновить", btn_confirm:"Подтвердить",
  btn_search:"Поиск", btn_close:"Закрыть",

  // Status
  status_free:"Свободна", status_in_use:"В работе", status_dead:"Мёртвая",
  status_archive:"Архив", status_pending:"Ожидание", status_success:"Успех",
  status_failed:"Ошибка", status_shipped:"Отправлен",
  status_delivered:"Доставлен", status_cancelled:"Отменён",

  // Messages
  msg_loading:"Загрузка…", msg_no_data:"Нет данных",
  msg_not_implemented:"Ещё не реализовано",
  msg_confirm_delete:"Вы уверены, что хотите удалить этот элемент?",
  msg_saved:"Успешно сохранено", msg_deleted:"Успешно удалено",
  msg_error:"Произошла ошибка",

  // Auth
  auth_setup_title:"Создать мастер-пароль",
  auth_setup_subtitle:"Пароль шифрует все данные локально. Выбирайте осторожно.",
  auth_unlock_title:"CC Manager",
  auth_unlock_subtitle:"Введите мастер-пароль для разблокировки",
  auth_password_label:"Мастер-пароль",
  auth_confirm_label:"Подтверждение пароля",
  auth_btn_create:"Создать пароль", auth_btn_unlock:"Разблокировать",
  auth_btn_creating:"Создание…", auth_btn_unlocking:"Разблокировка…",
  auth_req_title:"Требования к паролю:",
  auth_req_length:"Минимум 12 символов",
  auth_req_upper:"Заглавная буква (A–Z)",
  auth_req_lower:"Строчная буква (a–z)",
  auth_req_digit:"Цифра (0–9)",
  auth_strength_weak:"Слабый", auth_strength_fair:"Средний",
  auth_strength_good:"Хороший", auth_strength_strong:"Надёжный",
  auth_warning_no_recovery:"⚠️ Если вы забудете пароль, все данные будут безвозвратно утеряны. Восстановление невозможно.",
  auth_err_mismatch:"Пароли не совпадают",
  auth_err_too_weak:"Пароль не соответствует требованиям",
  auth_err_wrong:"Неверный пароль. Попробуйте снова.",
  auth_err_locked:"База данных заблокирована",
  auth_err_generic:"Ошибка аутентификации. Попробуйте снова.",
  sidebar_lock:"Заблокировать", sidebar_collapse:"Свернуть",

  // Cards — columns
  cc_col_number:"Номер карты", cc_col_bin:"BIN / Банк", cc_col_type:"Тип",
  cc_col_holder:"Держатель", cc_col_country:"Страна", cc_col_source:"Источник",
  cc_col_status:"Статус", cc_col_notes:"Заметки", cc_col_created:"Добавлена",
  cc_col_actions:"Действия",

  // Cards — filters
  cc_filter_status:"Все статусы", cc_filter_country:"Страна",
  cc_filter_bank:"Банк", cc_filter_source:"Источник",
  cc_reset_filters:"Сбросить", cc_columns:"Колонки",

  // Cards — actions
  cc_reveal:"Показать данные", cc_hide:"Скрыть данные",
  cc_copy_num:"Копировать номер", cc_copy_full:"Копировать всё",
  cc_mark_free:"Отметить свободной", cc_mark_dead:"Отметить мёртвой",
  cc_confirm_dead:"Отметить карту как мёртвую? Это нельзя отменить.",
  cc_no_cards:"Карты не найдены", cc_import_first:"Импортируйте первый дамп",

  // Cards — import modal
  cc_import_title:"Импорт карт",
  cc_import_step1_hint:"Вставьте дамп ниже. Поддерживаемые разделители: | , ; TAB",
  cc_import_step2_hint:"Автоопределённые колонки подсвечены зелёным. Проверьте перед продолжением.",
  cc_import_step3_hint:"Назначьте каждой колонке правильное поле. Неизвестные — установите 'skip'.",
  cc_import_source_label:"Метка источника",
  cc_import_preview:"Предпросмотр",
  cc_import_mapping:"Подтвердить маппинг",
  cc_import_do:"Импортировать",
  cc_import_done:"Импорт завершён",
};
