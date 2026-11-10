mod common;

use common::*;
use solana_signer::Signer;
use uproar::UproarError as E;

#[test]
fn create_profile_sets_owner_and_creator() {
    let mut t = T::new();
    let w = t.funded(5);
    let p = pda_profile(&w.pubkey());
    t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
    let got = t.profile(&p);
    assert_eq!(got.creator, w.pubkey());
    assert_eq!(got.authority, w.pubkey());
    assert_eq!(got.handle_len, 0);
    assert!(got.session_epoch > 0, "epoch is seeded from the slot");
}

#[test]
fn a_wallet_cannot_create_the_same_profile_twice() {
    let mut t = T::new();
    let w = t.funded(5);
    t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
    assert_failed(&t.send(&[i_create_profile(&w.pubkey())], &[&w]));
}

#[test]
fn nobody_can_create_a_profile_under_someone_elses_wallet() {
    let mut t = T::new();
    let attacker = t.funded(5);
    let victim = t.funded(5);
    // The seed uses the signer, so pointing the instruction at the victim's PDA must fail.
    let mut bad = i_create_profile(&attacker.pubkey());
    bad.accounts[1].pubkey = pda_profile(&victim.pubkey());
    assert_failed(&t.send(&[bad], &[&attacker]));
}

#[test]
fn claim_charges_the_tiered_refundable_deposit() {
    for (handle, deposit) in [
        ("abc", SOL),
        ("abcd", SOL / 4),
        ("abcde", SOL / 100),
        ("abcdefghijklmno", SOL / 100),
    ] {
        let mut t = T::new();
        let w = t.funded(5);
        let p = pda_profile(&w.pubkey());
        t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
        t.send(&[i_claim(&w.pubkey(), &p, handle)], &[&w]).unwrap();

        let h = pda_handle(handle);
        let acct = t.svm.get_account(&h).unwrap();
        let rent = t.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(acct.lamports, rent + deposit, "{handle}: rent plus deposit");
        assert_eq!(t.handle(&h).deposit, deposit);
        assert_eq!(t.handle(&h).profile, p);
        assert_eq!(t.profile(&p).handle_str(), handle);
    }
}

#[test]
fn claim_rejects_every_malformed_handle() {
    let mut t = T::new();
    let w = t.funded(5);
    let p = pda_profile(&w.pubkey());
    t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
    for bad in ["ab", "", "abcdefghijklmnop"] {
        assert_failed(&t.send(&[i_claim(&w.pubkey(), &p, bad)], &[&w]));
    }
    for bad in ["Rishab", "rish ab", "rish-ab", "rish.ab", "rishäb", "ri\u{200b}shab", "ＲＩＳＨ"] {
        let r = t.send(&[i_claim(&w.pubkey(), &p, bad)], &[&w]);
        assert_err(&r, E::HandleInvalid);
    }
}

#[test]
fn a_taken_handle_cannot_be_claimed() {
    let mut t = T::new();
    t.user("rishab");
    let w2 = t.funded(5);
    let p2 = pda_profile(&w2.pubkey());
    t.send(&[i_create_profile(&w2.pubkey())], &[&w2]).unwrap();
    assert_failed(&t.send(&[i_claim(&w2.pubkey(), &p2, "rishab")], &[&w2]));
}

#[test]
fn a_profile_can_hold_only_one_handle() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let r = t.send(&[i_claim(&w.pubkey(), &p, "second")], &[&w]);
    assert_err(&r, E::ProfileAlreadyHasHandle);
}

#[test]
fn a_stranger_cannot_claim_for_someone_elses_profile() {
    let mut t = T::new();
    let victim = t.funded(5);
    let vp = pda_profile(&victim.pubkey());
    t.send(&[i_create_profile(&victim.pubkey())], &[&victim]).unwrap();
    let attacker = t.funded(5);
    let r = t.send(&[i_claim(&attacker.pubkey(), &vp, "stolen")], &[&attacker]);
    assert_code(&r, HAS_ONE);
}

#[test]
fn release_refunds_rent_and_deposit_and_frees_the_name() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let h = pda_handle("rishab");
    let locked = t.balance(&h);
    let before = t.balance(&w.pubkey());
    t.send(&[i_release(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), before + locked - 5_000, "everything back minus the fee");
    assert!(!t.exists(&h));
    assert_eq!(t.profile(&p).handle_len, 0);

    // Someone else can now take it, and the old profile cannot act until it has a handle again.
    let w2 = t.funded(5);
    let p2 = pda_profile(&w2.pubkey());
    t.send(
        &[i_create_profile(&w2.pubkey()), i_claim(&w2.pubkey(), &p2, "rishab")],
        &[&w2],
    )
    .unwrap();
    assert_eq!(t.handle(&h).profile, p2);
    let r = t.send(&[i_post(&w.pubkey(), &p, None, "still me")], &[&w]);
    assert_err(&r, E::HandleRequired);
}

#[test]
fn a_stranger_cannot_release_someone_elses_handle() {
    let mut t = T::new();
    let (_victim, vp) = t.user("victim");
    let attacker = t.funded(5);
    let before = t.balance(&pda_handle("victim"));
    let r = t.send(&[i_release(&attacker.pubkey(), &vp, "victim")], &[&attacker]);
    assert_code(&r, HAS_ONE);
    assert_eq!(t.balance(&pda_handle("victim")), before);
}

#[test]
fn release_with_a_different_handle_account_fails() {
    let mut t = T::new();
    let (w, p) = t.user("mine");
    t.user("other");
    let r = t.send(&[i_release(&w.pubkey(), &p, "other")], &[&w]);
    assert_failed(&r);
    assert!(t.exists(&pda_handle("other")));
    assert!(t.exists(&pda_handle("mine")));
}

#[test]
fn transfer_needs_both_owners_and_moves_the_refund_claim() {
    let mut t = T::new();
    let (a, ap) = t.user("rishab");
    let b = t.funded(5);
    let bp = pda_profile(&b.pubkey());
    t.send(&[i_create_profile(&b.pubkey())], &[&b]).unwrap();
    t.send(&[i_transfer(&a.pubkey(), &b.pubkey(), &ap, &bp, "rishab")], &[&a, &b]).unwrap();

    assert_eq!(t.handle(&pda_handle("rishab")).profile, bp);
    assert_eq!(t.profile(&ap).handle_len, 0);
    assert_eq!(t.profile(&bp).handle_str(), "rishab");

    // The old owner has no claim any more.
    assert_failed(&t.send(&[i_release(&a.pubkey(), &ap, "rishab")], &[&a]));

    // The new owner gets the deposit on release.
    let locked = t.balance(&pda_handle("rishab"));
    let before = t.balance(&b.pubkey());
    t.send(&[i_release(&b.pubkey(), &bp, "rishab")], &[&b]).unwrap();
    assert_eq!(t.balance(&b.pubkey()), before + locked - 5_000);
}

#[test]
fn transfer_fails_without_the_receivers_signature() {
    let mut t = T::new();
    let (a, ap) = t.user("rishab");
    let b = t.funded(5);
    let bp = pda_profile(&b.pubkey());
    t.send(&[i_create_profile(&b.pubkey())], &[&b]).unwrap();
    let mut bad = i_transfer(&a.pubkey(), &b.pubkey(), &ap, &bp, "rishab");
    bad.accounts[1].is_signer = false;
    assert_code(&t.send(&[bad], &[&a]), ACCOUNT_NOT_SIGNER);
}

#[test]
fn transfer_fails_without_the_senders_signature() {
    let mut t = T::new();
    let (a, ap) = t.user("rishab");
    let b = t.funded(5);
    let bp = pda_profile(&b.pubkey());
    t.send(&[i_create_profile(&b.pubkey())], &[&b]).unwrap();
    let mut bad = i_transfer(&a.pubkey(), &b.pubkey(), &ap, &bp, "rishab");
    bad.accounts[0].is_signer = false;
    assert_code(&t.send(&[bad], &[&b]), ACCOUNT_NOT_SIGNER);
}

#[test]
fn a_handle_cannot_be_pushed_onto_someone_elses_profile() {
    let mut t = T::new();
    let (a, ap) = t.user("offensive");
    let victim = t.funded(5);
    let vp = pda_profile(&victim.pubkey());
    t.send(&[i_create_profile(&victim.pubkey())], &[&victim]).unwrap();

    // The attacker signs as the receiver with a throwaway key, but doesn't own the target profile.
    let helper = t.funded(1);
    let r = t.send(&[i_transfer(&a.pubkey(), &helper.pubkey(), &ap, &vp, "offensive")], &[&a, &helper]);
    assert_err(&r, E::Unauthorized);
    assert_eq!(t.profile(&vp).handle_len, 0);
    assert_eq!(t.profile(&ap).handle_str(), "offensive");
}

#[test]
fn transfer_into_a_profile_that_already_has_a_handle_fails() {
    let mut t = T::new();
    let (a, ap) = t.user("first");
    let (b, bp) = t.user("second");
    let r = t.send(&[i_transfer(&a.pubkey(), &b.pubkey(), &ap, &bp, "first")], &[&a, &b]);
    assert_err(&r, E::ProfileAlreadyHasHandle);
}

#[test]
fn transfer_to_self_fails() {
    let mut t = T::new();
    let (a, ap) = t.user("first");
    let r = t.send(&[i_transfer(&a.pubkey(), &a.pubkey(), &ap, &ap, "first")], &[&a]);
    assert_failed(&r);
    assert_eq!(t.profile(&ap).handle_str(), "first");
}

#[test]
fn rotation_needs_both_wallets_and_moves_ownership() {
    let mut t = T::new();
    let (old, p) = t.user("rishab");
    let new = t.funded(5);

    let mut one_sig = i_rotate(&old.pubkey(), &new.pubkey(), &p);
    one_sig.accounts[1].is_signer = false;
    assert_code(&t.send(&[one_sig], &[&old]), ACCOUNT_NOT_SIGNER);

    t.send(&[i_rotate(&old.pubkey(), &new.pubkey(), &p)], &[&old, &new]).unwrap();
    assert_eq!(t.profile(&p).authority, new.pubkey());
    assert_eq!(t.profile(&p).creator, old.pubkey(), "address stays the same");

    assert_err(&t.send(&[i_post(&old.pubkey(), &p, None, "hi")], &[&old]), E::Unauthorized);
    t.send(&[i_post(&new.pubkey(), &p, None, "hi")], &[&new]).unwrap();
}

#[test]
fn a_stranger_cannot_rotate_someone_elses_profile() {
    let mut t = T::new();
    let (_v, vp) = t.user("victim");
    let attacker = t.funded(5);
    let helper = t.funded(5);
    let r = t.send(&[i_rotate(&attacker.pubkey(), &helper.pubkey(), &vp)], &[&attacker, &helper]);
    assert_code(&r, HAS_ONE);
}

#[test]
fn close_profile_refunds_rent_only_without_a_handle() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    assert_err(&t.send(&[i_close_profile(&w.pubkey(), &p)], &[&w]), E::HandleStillHeld);
    t.send(&[i_release(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    let locked = t.balance(&p);
    let before = t.balance(&w.pubkey());
    t.send(&[i_close_profile(&w.pubkey(), &p)], &[&w]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), before + locked - 5_000);
    assert!(!t.exists(&p));
}

#[test]
fn a_stranger_cannot_close_someone_elses_profile() {
    let mut t = T::new();
    let v = t.funded(5);
    let vp = pda_profile(&v.pubkey());
    t.send(&[i_create_profile(&v.pubkey())], &[&v]).unwrap();
    let attacker = t.funded(5);
    assert_code(&t.send(&[i_close_profile(&attacker.pubkey(), &vp)], &[&attacker]), HAS_ONE);
}

#[test]
fn prefunding_a_handle_address_does_not_block_or_steal_the_claim() {
    let mut t = T::new();
    let target = pda_handle("rishab");
    t.svm.airdrop(&target, SOL / 2).unwrap();
    let (w, p) = t.user("rishab");
    assert_eq!(t.handle(&target).profile, p);
    // The owner keeps whatever sits on the account when releasing it.
    let locked = t.balance(&target);
    let before = t.balance(&w.pubkey());
    t.send(&[i_release(&w.pubkey(), &p, "rishab")], &[&w]).unwrap();
    assert_eq!(t.balance(&w.pubkey()), before + locked - 5_000);
}

#[test]
fn wallet_with_too_little_sol_cannot_claim_a_short_handle() {
    let mut t = T::new();
    let w = t.funded(1);
    let p = pda_profile(&w.pubkey());
    t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
    assert_failed(&t.send(&[i_claim(&w.pubkey(), &p, "abc")], &[&w]));
    assert_eq!(t.profile(&p).handle_len, 0);
}
