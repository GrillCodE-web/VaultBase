//! Offline queue and footprint sync stub.

use crate::models::{Footprint, SyncResult};

pub fn get_unsynced_footprints() -> Result<Vec<Footprint>, String> {
    Err("not_implemented".into())
}

pub fn mark_footprints_synced(_ids: Vec<i64>) -> Result<(), String> {
    Err("not_implemented".into())
}

pub fn sync_now() -> Result<SyncResult, String> {
    Err("not_implemented".into())
}
