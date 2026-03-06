//! IMAP polling stub.

use crate::models::{ImapAccount, ImapInput, PaginatedMessages};

pub fn add_imap_account(_input: ImapInput) -> Result<ImapAccount, String> {
    Err("not_implemented".into())
}

pub fn get_imap_accounts() -> Result<Vec<ImapAccount>, String> {
    Err("not_implemented".into())
}

pub fn get_imap_messages(_account_id: i64, _page: u32) -> Result<PaginatedMessages, String> {
    Err("not_implemented".into())
}
