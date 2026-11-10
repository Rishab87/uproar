mod common;

use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::{AccountMeta, Instruction},
};
use common::*;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use uproar::UproarError as E;

#[test]
fn owner_and_delegate_can_do_every_social_action() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_w2, p2) = t.user("friend");
    let (d, s) = t.delegate(&w, &p, 7);
    let post = t.sig();
    let cases = |who: &Pubkey, session: Option<Pubkey>| {
        vec![
            i_post(who, &p, session, "hello"),
            i_post_full(who, &p, session, "reply", Some(post), None),
            i_post_full(who, &p, session, "quote", None, Some(post)),
            i_post_full(who, &p, session, "both", Some(post), Some(post)),
            i_like(who, &p, session, post),
            i_unlike(who, &p, session, post),
            i_repost(who, &p, session, post),
            i_unrepost(who, &p, session, post),
            i_follow(who, &p, session, p2),
            i_unfollow(who, &p, session, p2),
            i_pin(who, &p, session, Some(post)),
            i_pin(who, &p, session, None),
            i_delete(who, &p, session, post),
            i_set_profile(who, &p, session, "Rishab", "bio", "https://a.b", "India"),
        ]
    };
    for i in cases(&w.pubkey(), None) {
        t.send(&[i], &[&w]).unwrap();
    }
    // Deleting is owner-only. Everything else works from a session key.
    for i in cases(&d.pubkey(), Some(s)).into_iter().filter(|i| i.data[0] != 21) {
        t.send(&[i], &[&d]).unwrap();
    }
}

#[test]
fn a_stranger_cannot_do_any_social_action_as_someone_else() {
    let mut t = T::new();
    let (_v, vp) = t.user("victim");
    let (_w2, p2) = t.user("friend");
    let a = t.funded(2);
    let k = a.pubkey();
    let post = t.sig();
    let cases = vec![
        i_post(&k, &vp, None, "forged"),
        i_like(&k, &vp, None, post),
        i_unlike(&k, &vp, None, post),
        i_repost(&k, &vp, None, post),
        i_unrepost(&k, &vp, None, post),
        i_follow(&k, &vp, None, p2),
        i_unfollow(&k, &vp, None, p2),
        i_pin(&k, &vp, None, Some(post)),
        i_delete(&k, &vp, None, post),
        i_set_profile(&k, &vp, None, "Fake", "", "", ""),
    ];
    for bad in cases {
        assert_err(&t.send(&[bad], &[&a]), E::Unauthorized);
    }
}

#[test]
fn an_unsigned_owner_account_cannot_authorize() {
    let mut t = T::new();
    let (w, p) = t.user("victim");
    let payer = t.funded(2);
    let mut bad = i_post(&w.pubkey(), &p, None, "forged");
    bad.accounts[0].is_signer = false;
    assert_code(&t.send(&[bad], &[&payer]), ACCOUNT_NOT_SIGNER);
}

#[test]
fn a_profile_with_no_handle_cannot_act() {
    let mut t = T::new();
    let w = t.funded(2);
    let p = pda_profile(&w.pubkey());
    t.send(&[i_create_profile(&w.pubkey())], &[&w]).unwrap();
    assert_err(&t.send(&[i_post(&w.pubkey(), &p, None, "hi")], &[&w]), E::HandleRequired);
    let post = t.sig();
    assert_err(&t.send(&[i_like(&w.pubkey(), &p, None, post)], &[&w]), E::HandleRequired);
}

#[test]
fn empty_and_whitespace_posts_are_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    for bad in ["", " ", "\n\t  \r\n", "\u{3000}"] {
        assert_err(&t.send(&[i_post(&w.pubkey(), &p, None, bad)], &[&w]), E::TextEmpty);
    }
}

#[test]
fn text_is_capped_by_bytes() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    t.send(&[i_post(&w.pubkey(), &p, None, &"a".repeat(900))], &[&w]).unwrap();
    assert_err(
        &t.send(&[i_post(&w.pubkey(), &p, None, &"a".repeat(901))], &[&w]),
        E::TextTooLong,
    );
}

#[test]
fn invalid_utf8_text_is_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    // Hand-rolled instruction: discriminator, length-prefixed bad bytes, no reply, no quote.
    let mut good = i_post(&w.pubkey(), &p, None, "ab");
    let d = &mut good.data;
    d[5] = 0xff;
    d[6] = 0xfe;
    assert_failed(&t.send(&[good], &[&w]));
}

#[test]
fn a_full_length_hindi_post_fits_in_one_transaction_with_a_reply() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let parent = t.sig();
    let hindi = "न".repeat(280); // 840 bytes, the heaviest 280-weighted post
    let i = i_post_full(&d.pubkey(), &p, Some(s), &hindi, Some(parent), None);
    t.send(&[i], &[&d]).unwrap();
}

#[test]
fn you_cannot_follow_yourself() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    assert_err(&t.send(&[i_follow(&w.pubkey(), &p, None, p)], &[&w]), E::CannotFollowSelf);
}

#[test]
fn profile_fields_are_capped() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let k = w.pubkey();
    let long = |n: usize| "x".repeat(n);
    t.send(&[i_set_profile(&k, &p, None, &long(64), &long(320), &long(120), &long(64))], &[&w]).unwrap();
    assert_err(&t.send(&[i_set_profile(&k, &p, None, &long(65), "", "", "")], &[&w]), E::FieldTooLong);
    assert_err(&t.send(&[i_set_profile(&k, &p, None, "", &long(321), "", "")], &[&w]), E::FieldTooLong);
    assert_err(&t.send(&[i_set_profile(&k, &p, None, "", "", &long(121), "")], &[&w]), E::FieldTooLong);
    assert_err(&t.send(&[i_set_profile(&k, &p, None, "", "", "", &long(65))], &[&w]), E::FieldTooLong);
}

#[test]
fn cpi_calls_are_rejected_on_every_instruction() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_w2, p2) = t.user("friend");
    let post = t.sig();
    let k = w.pubkey();
    let fresh = Keypair::new();
    let exp = t.now() + DAY;
    let s = pda_session(&p, &fresh.pubkey());
    let attempts = vec![
        i_post(&k, &p, None, "cpi"),
        i_delete(&k, &p, None, post),
        i_like(&k, &p, None, post),
        i_unlike(&k, &p, None, post),
        i_repost(&k, &p, None, post),
        i_unrepost(&k, &p, None, post),
        i_follow(&k, &p, None, p2),
        i_unfollow(&k, &p, None, p2),
        i_pin(&k, &p, None, Some(post)),
        i_set_profile(&k, &p, None, "n", "", "", ""),
        i_release(&k, &p, "rishab"),
        i_create_session(&k, &p, &fresh.pubkey(), exp, 0),
        i_revoke_all(&k, &p),
    ];
    for inner in attempts {
        assert_err(&t.send(&[via_cpi(&inner)], &[&w]), E::CpiNotAllowed);
    }
    // Sanity: the same instructions succeed at top level.
    t.send(&[i_post(&k, &p, None, "direct")], &[&w]).unwrap();
    t.send(&[i_create_session(&k, &p, &fresh.pubkey(), exp, 0)], &[&w]).unwrap();
    assert_err(&t.send(&[via_cpi(&i_close_session(&k, &s, &k))], &[&w]), E::CpiNotAllowed);

    let w3 = t.funded(2);
    assert_err(&t.send(&[via_cpi(&i_create_profile(&w3.pubkey()))], &[&w3]), E::CpiNotAllowed);
}

#[test]
fn a_session_account_passed_as_a_profile_is_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let r = t.send(&[i_post(&d.pubkey(), &s, Some(s), "confused")], &[&d]);
    assert_code(&r, DISCRIMINATOR_MISMATCH);
}

#[test]
fn a_profile_account_passed_as_a_session_is_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, _s) = t.delegate(&w, &p, 7);
    let r = t.send(&[i_post(&d.pubkey(), &p, Some(p), "confused")], &[&d]);
    assert_code(&r, DISCRIMINATOR_MISMATCH);
}

#[test]
fn a_forged_profile_owned_by_another_program_is_rejected() {
    let mut t = T::new();
    let (_w, p) = t.user("victim");
    let attacker = t.funded(2);

    // Copy the victim's real account bytes to a new address owned by another program, with the
    // authority set to the attacker. Only the owner check can stop this.
    let mut forged = t.svm.get_account(&p).unwrap();
    let authority_offset = 1 + 32;
    forged.data[authority_offset..authority_offset + 32].copy_from_slice(attacker.pubkey().as_ref());
    forged.owner = cpi_caller_id();
    let fake = Pubkey::new_unique();
    t.svm.set_account(fake, forged).unwrap();

    let r = t.send(&[i_post(&attacker.pubkey(), &fake, None, "forged")], &[&attacker]);
    assert_code(&r, OWNED_BY_WRONG_PROGRAM);
}

#[test]
fn a_forged_session_owned_by_another_program_is_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("victim");
    let attacker = t.funded(2);
    let (_d, s) = t.delegate(&w, &p, 7);

    let mut forged = t.svm.get_account(&s).unwrap();
    let delegate_offset = 1 + 32;
    forged.data[delegate_offset..delegate_offset + 32].copy_from_slice(attacker.pubkey().as_ref());
    forged.owner = cpi_caller_id();
    let fake = Pubkey::new_unique();
    t.svm.set_account(fake, forged).unwrap();

    let r = t.send(&[i_post(&attacker.pubkey(), &p, Some(fake), "forged")], &[&attacker]);
    assert_code(&r, OWNED_BY_WRONG_PROGRAM);
}

#[test]
fn unknown_instructions_are_rejected() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let metas = vec![AccountMeta::new_readonly(w.pubkey(), true), AccountMeta::new_readonly(p, false)];
    let bad = Instruction::new_with_bytes(uproar::id(), &[200u8], metas);
    assert_failed(&t.send(&[bad], &[&w]));
}

#[test]
fn compute_units_and_transaction_sizes_stay_within_budget() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let parent = t.sig();
    let cases = [
        ("post 1 byte", i_post(&d.pubkey(), &p, Some(s), "a")),
        ("post 900 bytes", i_post(&d.pubkey(), &p, Some(s), &"a".repeat(900))),
        ("reply+quote 800 bytes", i_post_full(&d.pubkey(), &p, Some(s), &"न".repeat(266), Some(parent), Some(parent))),
        ("like", i_like(&d.pubkey(), &p, Some(s), parent)),
    ];
    for (name, i) in cases {
        let units = t.send(&[i], &[&d]).unwrap().compute_units_consumed;
        println!("{name}: {units} CU");
        assert!(units < 15_000, "{name} used {units} CU, budget is 15000");
    }
}

#[test]
fn account_sizes_match_published_layout() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (_d, s) = t.delegate(&w, &p, 7);
    assert_eq!(t.svm.get_account(&p).unwrap().data.len(), 98);
    assert_eq!(t.svm.get_account(&pda_handle("rishab")).unwrap().data.len(), 50);
    assert_eq!(t.svm.get_account(&s).unwrap().data.len(), 114);
}

#[test]
fn a_full_post_transaction_serializes_under_the_packet_limit() {
    let mut t = T::new();
    let (w, p) = t.user("rishab");
    let (d, s) = t.delegate(&w, &p, 7);
    let parent = t.sig();
    let text = "न".repeat(266); // 798 bytes
    let i = i_post_full(&d.pubkey(), &p, Some(s), &text, Some(parent), Some(parent));
    let bh = t.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[i], Some(&d.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&d]).unwrap();
    let size = bincode_size(&tx);
    println!("reply+quote 798-byte post: {size} bytes");
    assert!(size <= 1232);
}

fn bincode_size(tx: &VersionedTransaction) -> usize {
    // Signature count (1 byte for small counts), signatures, then the serialized message.
    1 + tx.signatures.len() * 64 + tx.message.serialize().len()
}
