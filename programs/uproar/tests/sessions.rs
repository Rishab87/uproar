mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use uproar::UproarError as E;

#[test]
fn create_session_records_fields_and_sends_fuel() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let d = Keypair::new();
    let exp = t.now() + 7 * DAY;
    t.send(&[i_create_session(&w.pubkey(), &p, &d.pubkey(), exp, 2_000_000)], &[&w]).unwrap();
    let s = t.session(&pda_session(&p, &d.pubkey()));
    assert_eq!(s.profile, p);
    assert_eq!(s.delegate, d.pubkey());
    assert_eq!(s.rent_payer, w.pubkey());
    assert_eq!(s.expires_at, exp);
    assert_eq!(s.epoch, t.profile(&p).session_epoch);
    assert_eq!(t.balance(&d.pubkey()), 2_000_000);
}

#[test]
fn session_length_is_capped_at_30_days() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let d = Keypair::new();
    let too_long = t.now() + 30 * DAY + 1;
    assert_err(
        &t.send(&[i_create_session(&w.pubkey(), &p, &d.pubkey(), too_long, 0)], &[&w]),
        E::SessionTooLong,
    );
    let exact = t.now() + 30 * DAY;
    t.send(&[i_create_session(&w.pubkey(), &p, &d.pubkey(), exact, 0)], &[&w]).unwrap();
}

#[test]
fn session_cannot_start_expired() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let d = Keypair::new();
    let past = t.now();
    assert_err(
        &t.send(&[i_create_session(&w.pubkey(), &p, &d.pubkey(), past, 0)], &[&w]),
        E::SessionExpired,
    );
}

#[test]
fn fuel_is_capped_so_a_leaked_key_loses_little() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let d = Keypair::new();
    let exp = t.now() + DAY;
    assert_err(
        &t.send(&[i_create_session(&w.pubkey(), &p, &d.pubkey(), exp, SOL / 20 + 1)], &[&w]),
        E::FuelTooHigh,
    );
}

#[test]
fn the_owner_wallet_cannot_be_its_own_delegate() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let exp = t.now() + DAY;
    assert_err(
        &t.send(&[i_create_session(&w.pubkey(), &p, &w.pubkey(), exp, 0)], &[&w]),
        E::DelegateIsAuthority,
    );
}

#[test]
fn a_stranger_cannot_open_a_session_on_someone_elses_profile() {
    let mut t = T::new();
    let (_v, vp) = t.user("victim");
    let attacker = t.funded(5);
    let exp = t.now() + DAY;
    let r = t.send(&[i_create_session(&attacker.pubkey(), &vp, &attacker.pubkey(), exp, 0)], &[&attacker]);
    assert_code(&r, HAS_ONE);
}

#[test]
fn a_live_delegate_can_post_without_the_wallet() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let wallet_before = t.balance(&w.pubkey());
    t.send(&[i_post(&d.pubkey(), &p, Some(s), "no popup")], &[&d]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), wallet_before, "wallet untouched: delegate paid its own fee");
}

#[test]
fn an_expired_session_cannot_act() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 1);
    t.warp_time(DAY);
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "late")], &[&d]), E::SessionExpired);
}

#[test]
fn a_delegate_with_no_session_account_cannot_act() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, _s) = t.delegate(&w, &p, 7);
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, None, "hi")], &[&d]), E::Unauthorized);
}

#[test]
fn a_stranger_cannot_use_someone_elses_session_account() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_d, s) = t.delegate(&w, &p, 7);
    let attacker = t.funded(5);
    assert_err(
        &t.send(&[i_post(&attacker.pubkey(), &p, Some(s), "fake")], &[&attacker]),
        E::SessionMismatch,
    );
}

#[test]
fn a_session_on_profile_a_cannot_post_as_profile_b() {
    let mut t = T::new();
    let (wa, pa) = t.user("alice");
    let (_wb, pb) = t.user("bob");
    let (d, sa) = t.delegate(&wa, &pa, 7);
    assert_err(
        &t.send(&[i_post(&d.pubkey(), &pb, Some(sa), "as bob")], &[&d]),
        E::SessionMismatch,
    );
}

#[test]
fn delegates_cannot_do_owner_actions() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, _s) = t.delegate(&w, &p, 7);
    t.svm.airdrop(&d.pubkey(), SOL).unwrap();
    let other = Keypair::new();
    let exp = t.now() + DAY;

    let attempts = [
        i_release(&d.pubkey(), &p, "rishab"),
        i_create_session(&d.pubkey(), &p, &other.pubkey(), exp, 0),
        i_revoke_all(&d.pubkey(), &p),
        i_close_profile(&d.pubkey(), &p),
    ];
    for bad in attempts {
        assert_code(&t.send(&[bad], &[&d]), HAS_ONE);
    }

    // Extending its own session: the same key cannot appear as both the owner and the delegate.
    assert_failed(&t.send(&[i_extend_session(&d.pubkey(), &p, &d.pubkey(), exp, 0)], &[&d]));

    // Rotation to a wallet the delegate controls.
    let r = t.send(&[i_rotate(&d.pubkey(), &other.pubkey(), &p)], &[&d, &other]);
    assert_code(&r, HAS_ONE);
    assert_eq!(t.profile(&p).authority, w.pubkey());

    // Transferring the handle away.
    let thief = t.funded(5);
    let tp = pda_profile(&thief.pubkey());
    t.send(&[i_create_profile(&thief.pubkey())], &[&thief]).unwrap();
    let r = t.send(&[i_transfer(&d.pubkey(), &thief.pubkey(), &p, &tp, "rishab")], &[&d, &thief]);
    assert_failed(&r);
    assert_eq!(t.profile(&p).handle_str(), "rishab");
}

#[test]
fn revoke_all_kills_every_existing_session() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d1, s1) = t.delegate(&w, &p, 7);
    let (d2, s2) = t.delegate(&w, &p, 7);
    t.advance_slot();
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    assert_err(&t.send(&[i_post(&d1.pubkey(), &p, Some(s1), "a")], &[&d1]), E::SessionRevoked);
    assert_err(&t.send(&[i_post(&d2.pubkey(), &p, Some(s2), "b")], &[&d2]), E::SessionRevoked);
    // New sessions work again.
    let (d3, s3) = t.delegate(&w, &p, 7);
    t.send(&[i_post(&d3.pubkey(), &p, Some(s3), "c")], &[&d3]).unwrap();
}

#[test]
fn revoke_all_twice_in_one_slot_still_kills_sessions_created_between_them() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    let (d, s) = t.delegate(&w, &p, 7);
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "a")], &[&d]), E::SessionRevoked);
}

#[test]
fn rotation_kills_sessions_made_by_the_old_wallet() {
    let mut t = T::new();
    let (old, p) = t.user("rishab");
    let (d, s) = t.delegate(&old, &p, 7);
    let new = t.funded(5);
    t.advance_slot();
    t.send(&[i_rotate(&old.pubkey(), &new.pubkey(), &p)], &[&old, &new]).unwrap();
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "stale")], &[&d]), E::SessionRevoked);
}

#[test]
fn closing_and_recreating_a_profile_does_not_revive_revoked_sessions() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    t.advance_slot();
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    t.send(&[i_release(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    t.send(&[i_close_profile(&w.pubkey(), &p)], &[&w]).unwrap();
    t.advance_slot();
    t.send(
        &[i_create_profile(&w.pubkey()), i_claim(&w.pubkey(), &p, "rishab")],
        &[&w],
    )
    .unwrap();
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "back")], &[&d]), E::SessionRevoked);
}

#[test]
fn extend_moves_expiry_tops_up_fuel_and_revalidates_a_stale_session() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 1);
    let before = t.balance(&d.pubkey());
    t.warp_time(2 * DAY);
    let exp = t.now() + 10 * DAY;
    t.send(&[i_extend_session(&w.pubkey(), &p, &d.pubkey(), exp, 1_000_000)], &[&w]).unwrap();
    assert_eq!(t.session(&s).expires_at, exp);
    assert_eq!(t.balance(&d.pubkey()), before + 1_000_000);
    t.send(&[i_post(&d.pubkey(), &p, Some(s), "renewed")], &[&d]).unwrap();

    // Revoked sessions come back only when the owner extends them explicitly.
    t.advance_slot();
    t.send(&[i_revoke_all(&w.pubkey(), &p)], &[&w]).unwrap();
    assert_err(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "dead")], &[&d]), E::SessionRevoked);
    t.send(&[i_extend_session(&w.pubkey(), &p, &d.pubkey(), exp, 0)], &[&w]).unwrap();
    t.send(&[i_post(&d.pubkey(), &p, Some(s), "alive")], &[&d]).unwrap();
}

#[test]
fn extend_is_capped_at_30_days_and_fuel_cap() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, _s) = t.delegate(&w, &p, 1);
    let far = t.now() + 30 * DAY + 1;
    assert_err(
        &t.send(&[i_extend_session(&w.pubkey(), &p, &d.pubkey(), far, 0)], &[&w]),
        E::SessionTooLong,
    );
    let exp = t.now() + DAY;
    assert_err(
        &t.send(&[i_extend_session(&w.pubkey(), &p, &d.pubkey(), exp, SOL)], &[&w]),
        E::FuelTooHigh,
    );
}

#[test]
fn a_delegate_can_sign_itself_out_and_rent_goes_to_the_payer() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let rent = t.balance(&s);
    let before = t.balance(&w.pubkey());
    t.send(&[i_close_session(&d.pubkey(), &s, &w.pubkey())], &[&d]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), before + rent);
    assert!(!t.exists(&s));
    // A closed session is unusable.
    assert_failed(&t.send(&[i_post(&d.pubkey(), &p, Some(s), "gone")], &[&d]));
}

#[test]
fn the_wallet_can_revoke_one_device() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_d, s) = t.delegate(&w, &p, 7);
    t.send(&[i_close_session(&w.pubkey(), &s, &w.pubkey())], &[&w]).unwrap();
    assert!(!t.exists(&s));
}

#[test]
fn a_stranger_can_only_clean_up_expired_sessions() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_d, s) = t.delegate(&w, &p, 1);
    let stranger = t.funded(1);
    assert_err(
        &t.send(&[i_close_session(&stranger.pubkey(), &s, &w.pubkey())], &[&stranger]),
        E::Unauthorized,
    );
    t.warp_time(DAY);
    let rent = t.balance(&s);
    let before = t.balance(&w.pubkey());
    t.send(&[i_close_session(&stranger.pubkey(), &s, &w.pubkey())], &[&stranger]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), before + rent, "refund never goes to the closer");
}

#[test]
fn session_rent_cannot_be_redirected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 1);
    let thief = t.funded(1);
    t.warp_time(DAY);
    assert_failed(&t.send(&[i_close_session(&thief.pubkey(), &s, &thief.pubkey())], &[&thief]));
    assert_failed(&t.send(&[i_close_session(&d.pubkey(), &s, &thief.pubkey())], &[&d]));
    assert!(t.exists(&s));
}
