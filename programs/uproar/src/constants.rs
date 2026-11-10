use anchor_lang::prelude::*;

#[constant]
pub const PROFILE_SEED: &[u8] = b"profile";
#[constant]
pub const HANDLE_SEED: &[u8] = b"handle";
#[constant]
pub const SESSION_SEED: &[u8] = b"session";

#[constant]
pub const MIN_HANDLE_LEN: u8 = 3;
#[constant]
pub const MAX_HANDLE_LEN: u8 = 15;

/// Refundable handle deposits, in lamports. The deposit is the spam wall: it costs nothing to keep
/// an honest name and it makes farming thousands of names expensive.
#[constant]
pub const DEPOSIT_3_CHAR: u64 = 1_000_000_000;
#[constant]
pub const DEPOSIT_4_CHAR: u64 = 250_000_000;
#[constant]
pub const DEPOSIT_DEFAULT: u64 = 10_000_000;

#[constant]
pub const MAX_SESSION_SECONDS: i64 = 30 * 86_400;
/// Caps what a leaked delegate key can lose.
#[constant]
pub const MAX_FUEL_LAMPORTS: u64 = 50_000_000;

/// On-chain ceiling for post text. Reference clients also enforce a weighted 280-character limit.
#[constant]
pub const MAX_TEXT_BYTES: u32 = 900;
#[constant]
pub const MAX_NAME_BYTES: u32 = 64;
#[constant]
pub const MAX_BIO_BYTES: u32 = 320;
#[constant]
pub const MAX_WEBSITE_BYTES: u32 = 120;
#[constant]
pub const MAX_LOCATION_BYTES: u32 = 64;
