// Tauri command modules, grouped by domain.
// Each submodule holds `pub(crate) fn` commands; they are re-exported here so
// that `use commands::*;` in main.rs brings every command into scope for
// `tauri::generate_handler![...]`.

pub(crate) mod auth;
pub(crate) mod automation;
pub(crate) mod cards;
pub(crate) mod catalog;
pub(crate) mod chat;
pub(crate) mod config;
pub(crate) mod dashboard;
pub(crate) mod desktop;
pub(crate) mod group_panel;
pub(crate) mod imap;
pub(crate) mod license;
pub(crate) mod misc;
pub(crate) mod orders;
pub(crate) mod pool;
pub(crate) mod smtp;
pub(crate) mod slices;
pub(crate) mod stuffer;
pub(crate) mod sync;
pub(crate) mod telemetry;
pub(crate) mod upanel;

pub(crate) use auth::*;
pub(crate) use automation::*;
pub(crate) use cards::*;
pub(crate) use catalog::*;
pub(crate) use chat::*;
pub(crate) use config::*;
pub(crate) use dashboard::*;
pub(crate) use desktop::*;
pub(crate) use group_panel::*;
pub(crate) use imap::*;
pub(crate) use license::*;
pub(crate) use misc::*;
pub(crate) use orders::*;
pub(crate) use pool::*;
pub(crate) use smtp::*;
pub(crate) use slices::*;
pub(crate) use stuffer::*;
pub(crate) use sync::*;
pub(crate) use telemetry::*;
pub(crate) use upanel::*;
