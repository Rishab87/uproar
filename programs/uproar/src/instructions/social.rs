use anchor_lang::prelude::*;

use crate::{constants::*, error::UproarError, guard::*, state::*};

/// Every social action has the same shape. The program only proves the signer may speak for the
/// profile. The action itself lives in the instruction data, which indexers read from the ledger.
#[derive(Accounts)]
pub struct Social<'info> {
    pub signer: Signer<'info>,
    pub profile: Account<'info, Profile>,
    pub session: Option<Account<'info, Session>>,
}

impl Social<'_> {
    pub fn check(&self) -> Result<()> {
        no_cpi()?;
        authorize(
            &self.signer.key(),
            &self.profile.key(),
            &self.profile,
            self.session.as_ref().map(|s| &**s),
        )?;
        require!(self.profile.handle_len > 0, UproarError::HandleRequired);
        Ok(())
    }
}

pub fn handle_post(ctx: &Context<Social>, text: &str) -> Result<()> {
    ctx.accounts.check()?;
    require!(!text.trim().is_empty(), UproarError::TextEmpty);
    require!(text.len() <= MAX_TEXT_BYTES as usize, UproarError::TextTooLong);
    Ok(())
}

pub fn handle_follow(ctx: &Context<Social>, target: &Pubkey) -> Result<()> {
    ctx.accounts.check()?;
    require_keys_neq!(*target, ctx.accounts.profile.key(), UproarError::CannotFollowSelf);
    Ok(())
}

pub fn handle_set_profile(
    ctx: &Context<Social>,
    name: &str,
    bio: &str,
    website: &str,
    location: &str,
) -> Result<()> {
    ctx.accounts.check()?;
    require!(
        name.len() <= MAX_NAME_BYTES as usize
            && bio.len() <= MAX_BIO_BYTES as usize
            && website.len() <= MAX_WEBSITE_BYTES as usize
            && location.len() <= MAX_LOCATION_BYTES as usize,
        UproarError::FieldTooLong
    );
    Ok(())
}
