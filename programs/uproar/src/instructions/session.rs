use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{constants::*, error::UproarError, guard::*, state::*};

fn send_fuel<'info>(
    system_program: &Program<'info, System>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    fuel: u64,
) -> Result<()> {
    require!(fuel <= MAX_FUEL_LAMPORTS, UproarError::FuelTooHigh);
    if fuel == 0 {
        return Ok(());
    }
    transfer(CpiContext::new(system_program.key(), Transfer { from, to }), fuel)
}

#[derive(Accounts)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority)]
    pub profile: Account<'info, Profile>,
    /// A plain system account: it pays its own fees from the fuel and can do nothing else.
    #[account(mut)]
    pub delegate: SystemAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = Session::DISCRIMINATOR.len() + Session::INIT_SPACE,
        seeds = [SESSION_SEED, profile.key().as_ref(), delegate.key().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_session(ctx: Context<CreateSession>, expires_at: i64, fuel: u64) -> Result<()> {
    no_cpi()?;
    require_keys_neq!(
        ctx.accounts.delegate.key(),
        ctx.accounts.authority.key(),
        UproarError::DelegateIsAuthority
    );
    check_expiry(expires_at, Clock::get()?.unix_timestamp)?;
    let session = Session {
        profile: ctx.accounts.profile.key(),
        delegate: ctx.accounts.delegate.key(),
        rent_payer: ctx.accounts.authority.key(),
        expires_at,
        epoch: ctx.accounts.profile.session_epoch,
        bump: ctx.bumps.session,
    };
    ctx.accounts.session.set_inner(session);
    send_fuel(
        &ctx.accounts.system_program,
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.delegate.to_account_info(),
        fuel,
    )
}

#[derive(Accounts)]
pub struct ExtendSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority)]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub delegate: SystemAccount<'info>,
    #[account(
        mut,
        has_one = profile,
        has_one = delegate,
        seeds = [SESSION_SEED, profile.key().as_ref(), delegate.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, Session>,
    pub system_program: Program<'info, System>,
}

pub fn handle_extend_session(ctx: Context<ExtendSession>, expires_at: i64, fuel: u64) -> Result<()> {
    no_cpi()?;
    check_expiry(expires_at, Clock::get()?.unix_timestamp)?;
    let epoch = ctx.accounts.profile.session_epoch;
    let session = &mut ctx.accounts.session;
    session.expires_at = expires_at;
    session.epoch = epoch;
    send_fuel(
        &ctx.accounts.system_program,
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.delegate.to_account_info(),
        fuel,
    )
}

#[derive(Accounts)]
pub struct CloseSession<'info> {
    pub signer: Signer<'info>,
    #[account(mut, close = rent_payer, has_one = rent_payer)]
    pub session: Account<'info, Session>,
    /// CHECK: `has_one` pins this to the recorded payer, so the refund can't be redirected.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn handle_close_session(ctx: Context<CloseSession>) -> Result<()> {
    no_cpi()?;
    let signer = ctx.accounts.signer.key();
    let session = &ctx.accounts.session;
    require!(
        signer == session.delegate
            || signer == session.rent_payer
            || Clock::get()?.unix_timestamp >= session.expires_at,
        UproarError::Unauthorized
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeAllSessions<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub profile: Account<'info, Profile>,
}

pub fn handle_revoke_all_sessions(ctx: Context<RevokeAllSessions>) -> Result<()> {
    no_cpi()?;
    let slot = Clock::get()?.slot;
    ctx.accounts.profile.kill_sessions(slot);
    Ok(())
}
