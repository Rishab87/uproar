#![allow(dead_code)]
//! Test harness: a thin driver around LiteSVM that builds real UPROAR instructions and signs
//! real transactions against the compiled SBF binary.
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        clock::Clock,
        instruction::{error::InstructionError, AccountMeta, Instruction},
        system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use solana_transaction_error::TransactionError;
use uproar::{accounts as acc, instruction as ix, Handle, Profile, Session};

pub const SOL: u64 = 1_000_000_000;
pub const DAY: i64 = 86_400;

pub type Res = Result<TransactionMetadata, TransactionError>;

pub struct T {
    pub svm: LiteSVM,
    pub nonce: u64,
}

pub fn cpi_caller_id() -> Pubkey {
    Pubkey::new_from_array([7u8; 32])
}

impl T {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            uproar::id(),
            include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/uproar.so")),
        )
        .unwrap();
        svm.add_program(
            cpi_caller_id(),
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/cpi_caller.so"
            )),
        )
        .unwrap();
        // Start from a realistic clock: LiteSVM begins at slot 0 and timestamp 0.
        let mut clock = svm.get_sysvar::<Clock>();
        clock.slot = 1_000;
        clock.unix_timestamp = 1_800_000_000;
        svm.set_sysvar::<Clock>(&clock);
        T { svm, nonce: 0 }
    }

    pub fn funded(&mut self, sol: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), sol * SOL).unwrap();
        k
    }

    /// Sends a transaction. The harness expires the blockhash each call so identical
    /// transactions are not rejected as duplicates.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Res {
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let payer = signers[0].pubkey();
        let msg = Message::new_with_blockhash(ixs, Some(&payer), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm.send_transaction(tx).map_err(|e| e.err)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp_time(&mut self, seconds: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp += seconds;
        c.slot += 1;
        self.svm.set_sysvar::<Clock>(&c);
    }

    pub fn advance_slot(&mut self) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.slot += 1;
        self.svm.set_sysvar::<Clock>(&c);
    }

    pub fn balance(&self, k: &Pubkey) -> u64 {
        self.svm.get_balance(k).unwrap_or(0)
    }

    pub fn exists(&self, k: &Pubkey) -> bool {
        self.svm.get_account(k).map(|a| a.lamports > 0).unwrap_or(false)
    }

    pub fn profile(&self, k: &Pubkey) -> Profile {
        let a = self.svm.get_account(k).expect("profile account");
        Profile::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn handle(&self, k: &Pubkey) -> Handle {
        let a = self.svm.get_account(k).expect("handle account");
        Handle::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn session(&self, k: &Pubkey) -> Session {
        let a = self.svm.get_account(k).expect("session account");
        Session::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    /// Creates a wallet with a profile and a handle. Returns (wallet, profile address).
    pub fn user(&mut self, handle: &str) -> (Keypair, Pubkey) {
        let w = self.funded(10);
        let p = pda_profile(&w.pubkey());
        self.send(
            &[i_create_profile(&w.pubkey()), i_claim(&w.pubkey(), &p, handle)],
            &[&w],
        )
        .expect("onboard user");
        (w, p)
    }

    /// Creates a delegate session lasting `days` days with 0.01 SOL of fuel for fees.
    pub fn delegate(&mut self, w: &Keypair, p: &Pubkey, days: i64) -> (Keypair, Pubkey) {
        let d = Keypair::new();
        let exp = self.now() + days * DAY;
        self.send(
            &[i_create_session(&w.pubkey(), p, &d.pubkey(), exp, SOL / 100)],
            &[w],
        )
        .expect("create session");
        let s = pda_session(p, &d.pubkey());
        (d, s)
    }

    /// A unique 64-byte fake post id.
    pub fn sig(&mut self) -> [u8; 64] {
        self.nonce += 1;
        let mut b = [0u8; 64];
        b[..8].copy_from_slice(&self.nonce.to_le_bytes());
        b
    }
}

pub fn pda_profile(creator: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"profile", creator.as_ref()], &uproar::id()).0
}
pub fn pda_handle(h: &str) -> Pubkey {
    Pubkey::find_program_address(&[b"handle", h.as_bytes()], &uproar::id()).0
}
pub fn pda_session(profile: &Pubkey, delegate: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"session", profile.as_ref(), delegate.as_ref()],
        &uproar::id(),
    )
    .0
}

fn build(data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction::new_with_bytes(uproar::id(), &data, accounts)
}

pub fn i_create_profile(w: &Pubkey) -> Instruction {
    build(
        ix::CreateProfile {}.data(),
        acc::CreateProfile {
            authority: *w,
            profile: pda_profile(w),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn i_claim(w: &Pubkey, p: &Pubkey, h: &str) -> Instruction {
    build(
        ix::ClaimHandle { handle: h.to_string() }.data(),
        acc::ClaimHandle {
            authority: *w,
            profile: *p,
            handle_account: pda_handle(h),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn i_release(w: &Pubkey, p: &Pubkey, h: &str) -> Instruction {
    build(
        ix::ReleaseHandle {}.data(),
        acc::ReleaseHandle {
            authority: *w,
            profile: *p,
            handle_account: pda_handle(h),
        }
        .to_account_metas(None),
    )
}

pub fn i_transfer(from_w: &Pubkey, to_w: &Pubkey, from_p: &Pubkey, to_p: &Pubkey, h: &str) -> Instruction {
    build(
        ix::TransferHandle {}.data(),
        acc::TransferHandle {
            from_authority: *from_w,
            to_authority: *to_w,
            from_profile: *from_p,
            to_profile: *to_p,
            handle_account: pda_handle(h),
        }
        .to_account_metas(None),
    )
}

pub fn i_rotate(w: &Pubkey, new_w: &Pubkey, p: &Pubkey) -> Instruction {
    build(
        ix::RotateAuthority {}.data(),
        acc::RotateAuthority {
            authority: *w,
            new_authority: *new_w,
            profile: *p,
        }
        .to_account_metas(None),
    )
}

pub fn i_close_profile(w: &Pubkey, p: &Pubkey) -> Instruction {
    build(
        ix::CloseProfile {}.data(),
        acc::CloseProfile { authority: *w, profile: *p }.to_account_metas(None),
    )
}

pub fn i_create_session(w: &Pubkey, p: &Pubkey, d: &Pubkey, expires_at: i64, fuel: u64) -> Instruction {
    build(
        ix::CreateSession { expires_at, fuel }.data(),
        acc::CreateSession {
            authority: *w,
            profile: *p,
            delegate: *d,
            session: pda_session(p, d),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn i_extend_session(w: &Pubkey, p: &Pubkey, d: &Pubkey, expires_at: i64, fuel: u64) -> Instruction {
    build(
        ix::ExtendSession { expires_at, fuel }.data(),
        acc::ExtendSession {
            authority: *w,
            profile: *p,
            delegate: *d,
            session: pda_session(p, d),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn i_close_session(signer: &Pubkey, session: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    build(
        ix::CloseSession {}.data(),
        acc::CloseSession {
            signer: *signer,
            session: *session,
            rent_payer: *rent_payer,
        }
        .to_account_metas(None),
    )
}

pub fn i_revoke_all(w: &Pubkey, p: &Pubkey) -> Instruction {
    build(
        ix::RevokeAllSessions {}.data(),
        acc::RevokeAllSessions { authority: *w, profile: *p }.to_account_metas(None),
    )
}

pub fn social_metas(signer: &Pubkey, p: &Pubkey, session: Option<Pubkey>) -> Vec<AccountMeta> {
    acc::Social {
        signer: *signer,
        profile: *p,
        session,
    }
    .to_account_metas(None)
}

pub fn i_post(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, text: &str) -> Instruction {
    i_post_full(signer, p, s, text, None, None)
}

pub fn i_post_full(
    signer: &Pubkey,
    p: &Pubkey,
    s: Option<Pubkey>,
    text: &str,
    reply_to: Option<[u8; 64]>,
    quote_of: Option<[u8; 64]>,
) -> Instruction {
    build(
        ix::Post { text: text.to_string(), reply_to, quote_of }.data(),
        social_metas(signer, p, s),
    )
}

pub fn i_delete(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: [u8; 64]) -> Instruction {
    build(ix::DeletePost { post }.data(), social_metas(signer, p, s))
}
pub fn i_like(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: [u8; 64]) -> Instruction {
    build(ix::Like { post }.data(), social_metas(signer, p, s))
}
pub fn i_unlike(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: [u8; 64]) -> Instruction {
    build(ix::Unlike { post }.data(), social_metas(signer, p, s))
}
pub fn i_repost(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: [u8; 64]) -> Instruction {
    build(ix::Repost { post }.data(), social_metas(signer, p, s))
}
pub fn i_unrepost(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: [u8; 64]) -> Instruction {
    build(ix::Unrepost { post }.data(), social_metas(signer, p, s))
}
pub fn i_follow(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, target: Pubkey) -> Instruction {
    build(ix::Follow { target }.data(), social_metas(signer, p, s))
}
pub fn i_unfollow(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, target: Pubkey) -> Instruction {
    build(ix::Unfollow { target }.data(), social_metas(signer, p, s))
}
pub fn i_pin(signer: &Pubkey, p: &Pubkey, s: Option<Pubkey>, post: Option<[u8; 64]>) -> Instruction {
    build(ix::Pin { post }.data(), social_metas(signer, p, s))
}
pub fn i_set_profile(
    signer: &Pubkey,
    p: &Pubkey,
    s: Option<Pubkey>,
    name: &str,
    bio: &str,
    website: &str,
    location: &str,
) -> Instruction {
    build(
        ix::SetProfile {
            name: name.to_string(),
            bio: bio.to_string(),
            website: website.to_string(),
            location: location.to_string(),
            avatar_seed: 7,
            accent: 1,
        }
        .data(),
        social_metas(signer, p, s),
    )
}

/// Wraps an instruction so it reaches UPROAR through the attacker program, by CPI.
pub fn via_cpi(inner: &Instruction) -> Instruction {
    let mut metas = vec![AccountMeta::new_readonly(inner.program_id, false)];
    metas.extend(inner.accounts.iter().cloned());
    Instruction::new_with_bytes(cpi_caller_id(), &inner.data, metas)
}

// ---- assertions --------------------------------------------------------------------------

pub fn custom_code(r: &Res) -> Option<u32> {
    match r {
        Err(TransactionError::InstructionError(_, InstructionError::Custom(c))) => Some(*c),
        _ => None,
    }
}

#[track_caller]
pub fn assert_err(r: &Res, e: uproar::UproarError) {
    let want: u32 = e.into();
    assert_eq!(custom_code(r), Some(want), "wanted {want}, got {r:?}");
}

/// Anchor framework errors, listed by name so tests read as intent.
pub const HAS_ONE: u32 = 2001;
pub const CONSTRAINT_SIGNER: u32 = 2002;
pub const CONSTRAINT_SEEDS: u32 = 2006;
pub const CONSTRAINT_DUPLICATE_MUT: u32 = 2040;
pub const DISCRIMINATOR_MISMATCH: u32 = 3002;
pub const OWNED_BY_WRONG_PROGRAM: u32 = 3007;
pub const ACCOUNT_NOT_INITIALIZED: u32 = 3012;
pub const ACCOUNT_NOT_SIGNER: u32 = 3010;

#[track_caller]
pub fn assert_code(r: &Res, code: u32) {
    assert_eq!(custom_code(r), Some(code), "wanted {code}, got {r:?}");
}

#[track_caller]
pub fn assert_failed(r: &Res) {
    assert!(r.is_err(), "expected failure, got success");
}
