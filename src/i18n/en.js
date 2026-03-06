export const en = {
  // Navigation
  nav_dashboard: "Dashboard", nav_cards: "Cards", nav_profiles: "Profiles",
  nav_drops: "Drops", nav_orders: "Orders", nav_shops: "Shops",
  nav_emails: "Email Pool", nav_proxies: "Proxies", nav_imap: "IMAP",
  nav_activity: "Activity Log", nav_settings: "Settings",

  // Common
  btn_add:"Add", btn_save:"Save", btn_cancel:"Cancel", btn_delete:"Delete",
  btn_edit:"Edit", btn_import:"Import", btn_export:"Export",
  btn_refresh:"Refresh", btn_confirm:"Confirm", btn_search:"Search", btn_close:"Close",

  // Status
  status_free:"Free", status_in_use:"In Use", status_dead:"Dead",
  status_archive:"Archive", status_pending:"Pending", status_success:"Success",
  status_failed:"Failed", status_shipped:"Shipped",
  status_delivered:"Delivered", status_cancelled:"Cancelled",

  // Messages
  msg_loading:"Loading…", msg_no_data:"No data",
  msg_not_implemented:"Not implemented yet",
  msg_confirm_delete:"Are you sure you want to delete this item?",
  msg_saved:"Saved successfully", msg_deleted:"Deleted successfully",
  msg_error:"An error occurred",

  // Auth
  auth_setup_title:"Create Master Password",
  auth_setup_subtitle:"Your password encrypts all data locally. Choose carefully.",
  auth_unlock_title:"CC Manager",
  auth_unlock_subtitle:"Enter your master password to unlock",
  auth_password_label:"Master Password",
  auth_confirm_label:"Confirm Password",
  auth_btn_create:"Create Password", auth_btn_unlock:"Unlock",
  auth_btn_creating:"Creating…", auth_btn_unlocking:"Unlocking…",
  auth_req_title:"Password requirements:",
  auth_req_length:"Minimum 12 characters",
  auth_req_upper:"Uppercase letter (A–Z)",
  auth_req_lower:"Lowercase letter (a–z)",
  auth_req_digit:"One digit (0–9)",
  auth_strength_weak:"Weak", auth_strength_fair:"Fair",
  auth_strength_good:"Good", auth_strength_strong:"Strong",
  auth_warning_no_recovery:"⚠️ If you forget your password, all data will be permanently lost. There is no recovery option.",
  auth_err_mismatch:"Passwords do not match",
  auth_err_too_weak:"Password does not meet requirements",
  auth_err_wrong:"Wrong password. Please try again.",
  auth_err_locked:"Database is locked",
  auth_err_generic:"Authentication error. Please try again.",
  sidebar_lock:"Lock", sidebar_collapse:"Collapse",

  // Cards — columns
  cc_col_number:"Card Number", cc_col_bin:"BIN / Bank", cc_col_type:"Type",
  cc_col_holder:"Holder", cc_col_country:"Country", cc_col_source:"Source",
  cc_col_status:"Status", cc_col_notes:"Notes", cc_col_created:"Added",
  cc_col_actions:"Actions",

  // Cards — filters
  cc_filter_status:"All Statuses", cc_filter_country:"Country",
  cc_filter_bank:"Bank", cc_filter_source:"Source",
  cc_reset_filters:"Reset", cc_columns:"Columns",

  // Cards — actions
  cc_reveal:"Reveal card data", cc_hide:"Hide card data",
  cc_copy_num:"Copy number", cc_copy_full:"Copy full data",
  cc_mark_free:"Mark Free", cc_mark_dead:"Mark Dead",
  cc_confirm_dead:"Mark this card as dead? This cannot be undone.",
  cc_no_cards:"No cards found", cc_import_first:"Import your first dump",

  // Cards — import modal
  cc_import_title:"Import Cards",
  cc_import_step1_hint:"Paste your card dump below. Supported delimiters: | , ; TAB",
  cc_import_step2_hint:"Auto-detected columns are highlighted in green. Review before continuing.",
  cc_import_step3_hint:"Assign each column to the correct field. Set unknown columns to 'skip'.",
  cc_import_source_label:"Source label",
  cc_import_preview:"Preview",
  cc_import_mapping:"Confirm Mapping",
  cc_import_do:"Import",
  cc_import_done:"Import complete",
};
