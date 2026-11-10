use anchor_lang::{
    prelude::*,
    solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT},
};

use crate::{constants::*, error::UproarError, state::*};

/// Indexers only parse top-level instructions, so nothing is allowed to reach this program by CPI.
/// That removes a whole class of inner-instruction and log-parsing bugs from every indexer.
pub fn no_cpi() -> Result<()> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        UproarError::CpiNotAllowed
    );
    Ok(())
}

/// The signer must be the profile owner or a live delegate of this profile.
pub fn authorize(
    signer: &Pubkey,
    profile_key: &Pubkey,
    profile: &Profile,
    session: Option<&Session>,
) -> Result<()> {
    if *signer == profile.authority {
        return Ok(());
    }
    let session = session.ok_or(UproarError::Unauthorized)?;
    require_keys_eq!(session.profile, *profile_key, UproarError::SessionMismatch);
    require_keys_eq!(session.delegate, *signer, UproarError::SessionMismatch);
    require!(session.epoch == profile.session_epoch, UproarError::SessionRevoked);
    require!(
        Clock::get()?.unix_timestamp < session.expires_at,
        UproarError::SessionExpired
    );
    Ok(())
}

pub fn check_expiry(expires_at: i64, now: i64) -> Result<()> {
    require!(expires_at > now, UproarError::SessionExpired);
    require!(
        expires_at <= now.saturating_add(MAX_SESSION_SECONDS),
        UproarError::SessionTooLong
    );
    Ok(())
}

pub fn validate_handle(handle: &str) -> Result<()> {
    let bytes = handle.as_bytes();
    require!(
        bytes.len() >= MIN_HANDLE_LEN as usize
            && bytes.len() <= MAX_HANDLE_LEN as usize
            && bytes
                .iter()
                .all(|c| matches!(c, b'a'..=b'z' | b'0'..=b'9' | b'_')),
        UproarError::HandleInvalid
    );
    Ok(())
}

pub fn deposit_for(len: usize) -> u64 {
    match len {
        3 => DEPOSIT_3_CHAR,
        4 => DEPOSIT_4_CHAR,
        _ => DEPOSIT_DEFAULT,
    }
}
