use anchor_lang::prelude::*;

#[error_code]
pub enum UproarError {
    #[msg("This instruction must be called at the top level of a transaction, not by CPI")]
    CpiNotAllowed,
    #[msg("The signer is neither the profile owner nor a live delegate")]
    Unauthorized,
    #[msg("Handles are 3 to 15 characters of a-z, 0-9 and underscore")]
    HandleInvalid,
    #[msg("This profile already holds a handle")]
    ProfileAlreadyHasHandle,
    #[msg("Claim a handle before using this profile")]
    HandleRequired,
    #[msg("Release the handle before closing the profile")]
    HandleStillHeld,
    #[msg("This session has expired")]
    SessionExpired,
    #[msg("This session was revoked")]
    SessionRevoked,
    #[msg("This session does not belong to this signer and profile")]
    SessionMismatch,
    #[msg("Sessions can last at most 30 days")]
    SessionTooLong,
    #[msg("Session fuel is above the safety cap")]
    FuelTooHigh,
    #[msg("The owner wallet cannot be its own delegate")]
    DelegateIsAuthority,
    #[msg("Post text cannot be empty")]
    TextEmpty,
    #[msg("Post text is too long")]
    TextTooLong,
    #[msg("A profile field is too long")]
    FieldTooLong,
    #[msg("You cannot follow yourself")]
    CannotFollowSelf,
    #[msg("Wait a few seconds before closing this profile")]
    CloseTooSoon,
    #[msg("A profile that changed wallets can't be closed")]
    CannotCloseRotatedProfile,
    #[msg("Only the wallet that owns this profile can do this")]
    OwnerOnly,
}
