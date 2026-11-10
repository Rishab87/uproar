use anchor_lang::prelude::*;

/// A permanent identity. Its address never changes, so a released handle can never drag
/// someone's old posts onto a new owner.
#[account(discriminator = 1)]
#[derive(InitSpace)]
pub struct Profile {
    /// The wallet that created this profile. Immutable, and the PDA seed.
    pub creator: Pubkey,
    /// The wallet that controls this profile now.
    pub authority: Pubkey,
    pub handle: [u8; 15],
    /// Zero means no handle.
    pub handle_len: u8,
    /// Sessions from any other epoch are dead. Seeded from the slot and only ever moves forward,
    /// so closing and recreating a profile cannot revive a revoked session.
    pub session_epoch: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Profile {
    pub fn handle_bytes(&self) -> &[u8] {
        &self.handle[..self.handle_len as usize]
    }

    pub fn handle_str(&self) -> &str {
        core::str::from_utf8(self.handle_bytes()).unwrap_or("")
    }

    pub fn set_handle(&mut self, bytes: &[u8]) {
        self.handle = [0u8; 15];
        self.handle[..bytes.len()].copy_from_slice(bytes);
        self.handle_len = bytes.len() as u8;
    }

    pub fn clear_handle(&mut self) {
        self.handle = [0u8; 15];
        self.handle_len = 0;
    }

    pub fn kill_sessions(&mut self, slot: u64) {
        self.session_epoch = self.session_epoch.saturating_add(1).max(slot);
    }
}

/// A claimed name. Holds its rent plus the refundable deposit.
#[account(discriminator = 2)]
#[derive(InitSpace)]
pub struct Handle {
    pub profile: Pubkey,
    pub deposit: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

/// Lets a delegate key perform social actions for a profile until it expires.
#[account(discriminator = 3)]
#[derive(InitSpace)]
pub struct Session {
    pub profile: Pubkey,
    pub delegate: Pubkey,
    /// Receives the rent back when the session closes, whoever closes it.
    pub rent_payer: Pubkey,
    pub expires_at: i64,
    pub epoch: u64,
    pub bump: u8,
}
