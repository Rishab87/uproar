//! Regression tests from the independent review. Each one is an attack that used to work.
mod common;

use anchor_lang::solana_program::clock::Clock;
use common::*;
use solana_signer::Signer;
use uproar::UproarError as E;

#[test]
fn a_revoked_session_cannot_be_revived_by_closing_and_recreating_in_the_same_slot() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    // The epoch is now ahead of the slot, so the profile can't be closed in this slot.
    let r = t.send(&[i_release(&w.pubkey(), &p, "rishab"), i_close_profile(&w.pubkey(), &p)], &[&w]);
    assert_err(&r, E::CloseTooSoon);
    // Once the slot catches up, closing and recreating gives a fresh epoch the old session can't match.
    t.advance_slot();
    t.send(&[i_release(&w.pubkey(), &p, "rishab"), i_close_profile(&w.pubkey(), &p)], &[&w]).unwrap();
    t.send(&[i_create_profile(&w.pubkey()), i_claim(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "revived")], &[&d]), E::SessionRevoked);
}

#[test]
fn a_revoked_session_cannot_be_revived_when_the_epoch_ran_ahead_of_the_slot() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    t.send(&[i_revoke_all(&w.pubkey(), &p), i_revoke_all(&w.pubkey(), &p), i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    let (d, s) = t.delegate(&w, &p, 7);
    let session_epoch = t.session(&s).epoch;
    t.advance_slot();
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    assert_err(
        &t.send(&[i_release(&w.pubkey(), &p, "rishab"), i_close_profile(&w.pubkey(), &p)], &[&w]),
        E::CloseTooSoon,
    );
    let epoch = t.profile(&p).session_epoch;
    while t.svm.get_sysvar::<Clock>().slot < epoch {
        t.advance_slot();
    }
    t.send(&[i_release(&w.pubkey(), &p, "rishab"), i_close_profile(&w.pubkey(), &p)], &[&w]).unwrap();
    while t.svm.get_sysvar::<Clock>().slot < session_epoch {
        t.advance_slot();
    }
    t.send(&[i_create_profile(&w.pubkey()), i_claim(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    assert!(t.profile(&p).session_epoch > session_epoch);
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "revived")], &[&d]), E::SessionRevoked);
}

#[test]
fn a_profile_that_changed_wallets_cannot_be_closed_so_the_creator_cannot_take_it_back() {
    let mut t = T::new();
    let (old, p) = t.user("alice");
    let new = t.funded(5);
    t.send(&[i_rotate(&old.pubkey(), &new.pubkey(), &p)], &[&old, &new]).unwrap();
    t.advance_slot();
    t.advance_slot();
    t.send(&[i_release(&new.pubkey(), &p, "alice")], &[&new]).unwrap();
    assert_err(&t.send(&[i_close_profile(&new.pubkey(), &p)], &[&new]), E::CannotCloseRotatedProfile);
    assert!(t.exists(&p));
    // The address still exists, so the old creator key can't recreate it.
    assert_failed(&t.send(&[i_create_profile(&old.pubkey())], &[&old]));
    assert_eq!(t.profile(&p).authority, new.pubkey());
}

#[test]
fn only_the_owner_wallet_can_delete_posts_so_a_leaked_session_key_cannot_wipe_a_history() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let post = t.sig();
    assert_err(&t.send(&[i_delete(&d.pubkey(), &p, Some(s), post)], &[&d]), E::OwnerOnly);
    t.send(&[i_delete(&w.pubkey(), &p, None, post)], &[&w]).unwrap();
}

#[test]
fn trailing_bytes_after_the_arguments_are_ignored_by_the_program() {
    // Indexers must decode the argument prefix and ignore the rest, exactly as the program does.
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let mut a = i_post(&w.pubkey(), &p, None, "first");
    a.data.extend_from_slice(&[0xAA]);
    assert!(t.send(&[a], &[&w]).is_ok());
}
