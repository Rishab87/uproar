//! UPROAR social protocol.
//!
//! Identity, handles and sessions are accounts, because the chain has to enforce them. Everything
//! else is an event: the text of a post is instruction data, proven authentic by the fact that
//! this program accepted the transaction. There is no admin key in the logic, no fee and no
//! treasury. See docs/PROTOCOL.md for the exact indexing rules.
pub mod constants;
pub mod error;
pub mod guard;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("2BgbuMAkSP1QwCcCc955i7Bhqv6fwRTqtVZzQU3WqKD1");

#[program]
pub mod uproar {
    // Many arguments are never read here. They exist so the signed transaction carries them, and
    // so the IDL documents them, for indexers to read from the ledger.
    #![allow(unused_variables)]
    use super::*;

    // ---- identity: the owner wallet signs ----

    #[instruction(discriminator = 1)]
    pub fn create_profile(ctx: Context<CreateProfile>) -> Result<()> {
        handle_create_profile(ctx)
    }

    #[instruction(discriminator = 2)]
    pub fn claim_handle(ctx: Context<ClaimHandle>, handle: String) -> Result<()> {
        handle_claim_handle(ctx, handle)
    }

    #[instruction(discriminator = 3)]
    pub fn release_handle(ctx: Context<ReleaseHandle>) -> Result<()> {
        handle_release_handle(ctx)
    }

    #[instruction(discriminator = 4)]
    pub fn transfer_handle(ctx: Context<TransferHandle>) -> Result<()> {
        handle_transfer_handle(ctx)
    }

    #[instruction(discriminator = 5)]
    pub fn rotate_authority(ctx: Context<RotateAuthority>) -> Result<()> {
        handle_rotate_authority(ctx)
    }

    #[instruction(discriminator = 6)]
    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        handle_close_profile(ctx)
    }

    // ---- sessions ----

    #[instruction(discriminator = 10)]
    pub fn create_session(ctx: Context<CreateSession>, expires_at: i64, fuel: u64) -> Result<()> {
        handle_create_session(ctx, expires_at, fuel)
    }

    #[instruction(discriminator = 11)]
    pub fn extend_session(ctx: Context<ExtendSession>, expires_at: i64, fuel: u64) -> Result<()> {
        handle_extend_session(ctx, expires_at, fuel)
    }

    #[instruction(discriminator = 12)]
    pub fn close_session(ctx: Context<CloseSession>) -> Result<()> {
        handle_close_session(ctx)
    }

    #[instruction(discriminator = 13)]
    pub fn revoke_all_sessions(ctx: Context<RevokeAllSessions>) -> Result<()> {
        handle_revoke_all_sessions(ctx)
    }

    // ---- social: the owner or a live delegate signs ----

    #[instruction(discriminator = 20)]
    pub fn post(
        ctx: Context<Social>,
        text: String,
        reply_to: Option<[u8; 64]>,
        quote_of: Option<[u8; 64]>,
    ) -> Result<()> {
        handle_post(&ctx, &text)
    }

    /// Owner only: a leaked session key must not be able to wipe someone's history.
    #[instruction(discriminator = 21)]
    pub fn delete_post(ctx: Context<Social>, post: [u8; 64]) -> Result<()> {
        ctx.accounts.check()?;
        require_keys_eq!(ctx.accounts.signer.key(), ctx.accounts.profile.authority, UproarError::OwnerOnly);
        Ok(())
    }

    #[instruction(discriminator = 22)]
    pub fn like(ctx: Context<Social>, post: [u8; 64]) -> Result<()> {
        ctx.accounts.check()
    }

    #[instruction(discriminator = 23)]
    pub fn unlike(ctx: Context<Social>, post: [u8; 64]) -> Result<()> {
        ctx.accounts.check()
    }

    #[instruction(discriminator = 24)]
    pub fn repost(ctx: Context<Social>, post: [u8; 64]) -> Result<()> {
        ctx.accounts.check()
    }

    #[instruction(discriminator = 25)]
    pub fn unrepost(ctx: Context<Social>, post: [u8; 64]) -> Result<()> {
        ctx.accounts.check()
    }

    #[instruction(discriminator = 26)]
    pub fn follow(ctx: Context<Social>, target: Pubkey) -> Result<()> {
        handle_follow(&ctx, &target)
    }

    #[instruction(discriminator = 27)]
    pub fn unfollow(ctx: Context<Social>, target: Pubkey) -> Result<()> {
        ctx.accounts.check()
    }

    #[instruction(discriminator = 28)]
    pub fn set_profile(
        ctx: Context<Social>,
        name: String,
        bio: String,
        website: String,
        location: String,
        avatar_seed: u16,
        accent: u8,
    ) -> Result<()> {
        handle_set_profile(&ctx, &name, &bio, &website, &location)
    }

    #[instruction(discriminator = 29)]
    pub fn pin(ctx: Context<Social>, post: Option<[u8; 64]>) -> Result<()> {
        ctx.accounts.check()
    }
}
