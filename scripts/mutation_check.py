#!/usr/bin/env python3
"""Proves the program's test suite catches each removed security guard.

Each mutant deletes or weakens one guard in a scratch copy of the workspace, rebuilds the SBF binary
and runs the tests. A mutant that survives (tests still pass) means a guard has no real coverage.

Usage: scripts/mutation_check.py <scratch-dir> [label-substring]
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD = "programs/uproar/src/guard.rs"
IDENTITY = "programs/uproar/src/instructions/identity.rs"
SESSION = "programs/uproar/src/instructions/session.rs"
SOCIAL = "programs/uproar/src/instructions/social.rs"
STATE = "programs/uproar/src/state.rs"

MUTANTS = [
    ("CPI allowed", GUARD,
     "get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,", "get_stack_height() >= TRANSACTION_LEVEL_STACK_HEIGHT,"),
    ("session.profile unchecked", GUARD,
     "require_keys_eq!(session.profile, *profile_key, UproarError::SessionMismatch);", ""),
    ("session.delegate unchecked", GUARD,
     "require_keys_eq!(session.delegate, *signer, UproarError::SessionMismatch);", ""),
    ("session epoch unchecked", GUARD,
     "require!(session.epoch == profile.session_epoch, UproarError::SessionRevoked);", ""),
    ("session expiry unchecked", GUARD,
     "Clock::get()?.unix_timestamp < session.expires_at,", "Clock::get()?.unix_timestamp > 0,"),
    ("session length uncapped", GUARD,
     "expires_at <= now.saturating_add(MAX_SESSION_SECONDS),", "expires_at > 0,"),
    ("session may start expired", GUARD,
     "require!(expires_at > now, UproarError::SessionExpired);", ""),
    ("handle charset unchecked", GUARD,
     ".all(|c| matches!(c, b'a'..=b'z' | b'0'..=b'9' | b'_')),", ".all(|_| true),"),
    ("handle length unchecked", GUARD,
     "bytes.len() >= MIN_HANDLE_LEN as usize", "bytes.len() >= 1"),
    ("flat deposit for every handle", GUARD,
     "3 => DEPOSIT_3_CHAR,", "3 => DEPOSIT_DEFAULT,"),
    ("second handle allowed", IDENTITY,
     "ctx.accounts.profile.handle_len == 0,\n        UproarError::ProfileAlreadyHasHandle", "true,\n        UproarError::ProfileAlreadyHasHandle"),
    ("claim for any profile", IDENTITY,
     "#[account(mut, has_one = authority)]\n    pub profile: Account<'info, Profile>,\n    #[account(\n        init,", "#[account(mut)]\n    pub profile: Account<'info, Profile>,\n    #[account(\n        init,"),
    ("release by anyone", IDENTITY,
     "#[account(mut, has_one = authority)]\n    pub profile: Account<'info, Profile>,\n    #[account(\n        mut,\n        close = authority,", "#[account(mut)]\n    pub profile: Account<'info, Profile>,\n    #[account(\n        mut,\n        close = authority,"),
    ("transfer without sender ownership", IDENTITY,
     "#[account(mut, constraint = from_profile.authority == from_authority.key() @ UproarError::Unauthorized)]", "#[account(mut)]"),
    ("transfer without receiver ownership", IDENTITY,
     "#[account(mut, constraint = to_profile.authority == to_authority.key() @ UproarError::Unauthorized)]", "#[account(mut)]"),
    ("transfer overwrites existing handle", IDENTITY,
     "accounts.to_profile.handle_len == 0,", "true,"),
    ("rotation keeps old sessions", IDENTITY,
     "profile.kill_sessions(slot);", ""),
    ("rotate by anyone", IDENTITY,
     "/// Must sign, so ownership can't be pushed to a mistyped or unusable address.\n    pub new_authority: Signer<'info>,\n    #[account(mut, has_one = authority)]", "/// Must sign, so ownership can't be pushed to a mistyped or unusable address.\n    pub new_authority: Signer<'info>,\n    #[account(mut)]"),
    ("close profile while holding a handle", IDENTITY,
     "require!(ctx.accounts.profile.handle_len == 0, UproarError::HandleStillHeld);", ""),
    ("close profile by anyone", IDENTITY,
     "#[account(mut, close = authority, has_one = authority)]", "#[account(mut, close = authority)]"),
    ("epoch not slot-seeded", IDENTITY,
     "session_epoch: clock.slot,", "session_epoch: 1,"),
    ("session on any profile", SESSION,
     "#[account(has_one = authority)]\n    pub profile: Account<'info, Profile>,\n    /// A plain system account", "pub profile: Account<'info, Profile>,\n    /// A plain system account"),
    ("extend on any profile", SESSION,
     "#[account(has_one = authority)]\n    pub profile: Account<'info, Profile>,\n    #[account(mut)]\n    pub delegate", "pub profile: Account<'info, Profile>,\n    #[account(mut)]\n    pub delegate"),
    ("fuel uncapped", SESSION,
     "require!(fuel <= MAX_FUEL_LAMPORTS, UproarError::FuelTooHigh);", ""),
    ("delegate may be owner", SESSION,
     "require_keys_neq!(\n        ctx.accounts.delegate.key(),\n        ctx.accounts.authority.key(),\n        UproarError::DelegateIsAuthority\n    );", ""),
    ("session rent redirectable", SESSION,
     "#[account(mut, close = rent_payer, has_one = rent_payer)]", "#[account(mut, close = rent_payer)]"),
    ("anyone can close a live session", SESSION,
     "signer == session.delegate\n            || signer == session.rent_payer\n            || Clock::get()?.unix_timestamp >= session.expires_at,", "true,"),
    ("revoke-all does nothing", SESSION,
     "ctx.accounts.profile.kill_sessions(slot);", "let _ = slot;"),
    ("revoke-all by anyone", SESSION,
     "pub authority: Signer<'info>,\n    #[account(mut, has_one = authority)]\n    pub profile: Account<'info, Profile>,\n}\n\npub fn handle_revoke_all", "pub authority: Signer<'info>,\n    #[account(mut)]\n    pub profile: Account<'info, Profile>,\n}\n\npub fn handle_revoke_all"),
    ("extend keeps stale epoch", SESSION,
     "session.epoch = epoch;", "let _ = epoch;"),
    ("no handle required", SOCIAL,
     "require!(self.profile.handle_len > 0, UproarError::HandleRequired);", ""),
    ("empty posts allowed", SOCIAL,
     "require!(!text.trim().is_empty(), UproarError::TextEmpty);", ""),
    ("post text uncapped", SOCIAL,
     "require!(text.len() <= MAX_TEXT_BYTES as usize, UproarError::TextTooLong);", ""),
    ("self-follow allowed", SOCIAL,
     "require_keys_neq!(*target, ctx.accounts.profile.key(), UproarError::CannotFollowSelf);", ""),
    ("profile fields uncapped", SOCIAL,
     "name.len() <= MAX_NAME_BYTES as usize\n            && bio.len() <= MAX_BIO_BYTES as usize\n            && website.len() <= MAX_WEBSITE_BYTES as usize\n            && location.len() <= MAX_LOCATION_BYTES as usize,", "true,"),
    ("rotated profile can be closed", IDENTITY,
     "require_keys_eq!(profile.authority, profile.creator, UproarError::CannotCloseRotatedProfile);", ""),
    ("close while epoch leads the slot", IDENTITY,
     "require!(Clock::get()?.slot >= profile.session_epoch, UproarError::CloseTooSoon);", ""),
    ("delegate can delete", "programs/uproar/src/lib.rs",
     "require_keys_eq!(ctx.accounts.signer.key(), ctx.accounts.profile.authority, UproarError::OwnerOnly);", ""),
    ("epoch can move backward", STATE,
     "self.session_epoch = self.session_epoch.saturating_add(1).max(slot);", "self.session_epoch = slot;"),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)


def main() -> int:
    scratch = Path(sys.argv[1]) / "mutants"
    if scratch.exists():
        shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    for name in ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"]:
        shutil.copy(ROOT / name, scratch / name)
    shutil.copytree(ROOT / "programs", scratch / "programs")
    (scratch / "target/deploy").mkdir(parents=True)
    shutil.copy(ROOT / "target/deploy/uproar-keypair.json", scratch / "target/deploy/uproar-keypair.json")

    survived, killed, broken = [], [], []
    only = sys.argv[2] if len(sys.argv) > 2 else ""
    for i, (label, file, old, new) in enumerate(MUTANTS, 1):
        if only not in label:
            continue
        path = scratch / file
        original = path.read_text()
        if original.count(old) < 1:
            print(f"[{i}/{len(MUTANTS)}] NOT APPLICABLE: {label}: pattern missing", flush=True)
            broken.append(label)
            continue
        path.write_text(original.replace(old, new, 1))
        build = run("cargo build-sbf 2>&1", scratch)
        if build.returncode != 0:
            print(f"[{i}/{len(MUTANTS)}] BUILD FAILED: {label}\n{build.stdout[-1500:]}", flush=True)
            broken.append(label)
        else:
            test = run("cargo test -p uproar --no-fail-fast 2>&1", scratch)
            failing = [l.split()[1] for l in test.stdout.splitlines() if l.startswith("test ") and l.endswith("FAILED")]
            if failing:
                killed.append(label)
                print(f"[{i}/{len(MUTANTS)}] caught: {label}  ({len(failing)} tests, e.g. {failing[0]})", flush=True)
            else:
                survived.append(label)
                print(f"[{i}/{len(MUTANTS)}] SURVIVED: {label}", flush=True)
        path.write_text(original)

    print(f"\nRESULT: caught {len(killed)}, survived {len(survived)}, broken {len(broken)}", flush=True)
    for s in survived:
        print("  survived:", s)
    for b in broken:
        print("  broken:", b)
    return 1 if survived or broken else 0


if __name__ == "__main__":
    sys.exit(main())
