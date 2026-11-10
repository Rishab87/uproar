use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{constants::*, error::UproarError, guard::*, state::*};

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Profile::DISCRIMINATOR.len() + Profile::INIT_SPACE,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_profile(ctx: Context<CreateProfile>) -> Result<()> {
    no_cpi()?;
    let clock = Clock::get()?;
    ctx.accounts.profile.set_inner(Profile {
        creator: ctx.accounts.authority.key(),
        authority: ctx.accounts.authority.key(),
        handle: [0u8; 15],
        handle_len: 0,
        session_epoch: clock.slot,
        created_at: clock.unix_timestamp,
        bump: ctx.bumps.profile,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(handle: String)]
pub struct ClaimHandle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub profile: Account<'info, Profile>,
    #[account(
        init,
        payer = authority,
        space = Handle::DISCRIMINATOR.len() + Handle::INIT_SPACE,
        seeds = [HANDLE_SEED, handle.as_bytes()],
        bump
    )]
    pub handle_account: Account<'info, Handle>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_handle(ctx: Context<ClaimHandle>, handle: String) -> Result<()> {
    no_cpi()?;
    validate_handle(&handle)?;
    require!(
        ctx.accounts.profile.handle_len == 0,
        UproarError::ProfileAlreadyHasHandle
    );
    let deposit = deposit_for(handle.len());
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.handle_account.to_account_info(),
            },
        ),
        deposit,
    )?;
    let profile_key = ctx.accounts.profile.key();
    ctx.accounts.handle_account.set_inner(Handle {
        profile: profile_key,
        deposit,
        claimed_at: Clock::get()?.unix_timestamp,
        bump: ctx.bumps.handle_account,
    });
    ctx.accounts.profile.set_handle(handle.as_bytes());
    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseHandle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub profile: Account<'info, Profile>,
    #[account(
        mut,
        close = authority,
        has_one = profile,
        seeds = [HANDLE_SEED, profile.handle_bytes()],
        bump = handle_account.bump
    )]
    pub handle_account: Account<'info, Handle>,
}

pub fn handle_release_handle(ctx: Context<ReleaseHandle>) -> Result<()> {
    no_cpi()?;
    ctx.accounts.profile.clear_handle();
    Ok(())
}

#[derive(Accounts)]
pub struct TransferHandle<'info> {
    pub from_authority: Signer<'info>,
    pub to_authority: Signer<'info>,
    #[account(mut, constraint = from_profile.authority == from_authority.key() @ UproarError::Unauthorized)]
    pub from_profile: Account<'info, Profile>,
    #[account(mut, constraint = to_profile.authority == to_authority.key() @ UproarError::Unauthorized)]
    pub to_profile: Account<'info, Profile>,
    #[account(
        mut,
        constraint = handle_account.profile == from_profile.key() @ UproarError::Unauthorized,
        seeds = [HANDLE_SEED, from_profile.handle_bytes()],
        bump = handle_account.bump
    )]
    pub handle_account: Account<'info, Handle>,
}

pub fn handle_transfer_handle(ctx: Context<TransferHandle>) -> Result<()> {
    no_cpi()?;
    let accounts = ctx.accounts;
    require!(
        accounts.to_profile.handle_len == 0,
        UproarError::ProfileAlreadyHasHandle
    );
    let mut name = [0u8; 15];
    let len = accounts.from_profile.handle_len as usize;
    name[..len].copy_from_slice(accounts.from_profile.handle_bytes());
    accounts.to_profile.set_handle(&name[..len]);
    accounts.from_profile.clear_handle();
    accounts.handle_account.profile = accounts.to_profile.key();
    Ok(())
}

#[derive(Accounts)]
pub struct RotateAuthority<'info> {
    pub authority: Signer<'info>,
    /// Must sign, so ownership can't be pushed to a mistyped or unusable address.
    pub new_authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub profile: Account<'info, Profile>,
}

pub fn handle_rotate_authority(ctx: Context<RotateAuthority>) -> Result<()> {
    no_cpi()?;
    let slot = Clock::get()?.slot;
    let new_authority = ctx.accounts.new_authority.key();
    let profile = &mut ctx.accounts.profile;
    profile.authority = new_authority;
    profile.kill_sessions(slot);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, close = authority, has_one = authority)]
    pub profile: Account<'info, Profile>,
}

pub fn handle_close_profile(ctx: Context<CloseProfile>) -> Result<()> {
    no_cpi()?;
    let profile = &ctx.accounts.profile;
    require!(profile.handle_len == 0, UproarError::HandleStillHeld);
    // The address is derived from the creator. If anyone else could close it, the creator key could
    // recreate the same address and inherit its history, so a rotated profile stays open.
    require_keys_eq!(profile.authority, profile.creator, UproarError::CannotCloseRotatedProfile);
    // A recreated profile starts at the current slot's epoch. Closing only once the slot has caught up
    // with this epoch means a recreated profile can never match a session revoked before the close.
    require!(Clock::get()?.slot >= profile.session_epoch, UproarError::CloseTooSoon);
    Ok(())
}
