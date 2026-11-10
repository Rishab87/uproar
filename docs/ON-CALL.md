# On call

The console is at `/admin`. Sign in with an operator wallet listed in `ADMIN_WALLETS`. Every alarm
names a reference. Open it in the queue, which is sorted by deadline.

The law sets the clocks below. They start when the item is received, not when you see it. Alarms
repeat every 15 minutes for P0 and P1 until you acknowledge them.

## Child sexual material (P0, immediately)

The post is already hidden for everyone.

1. Open the item. Read the text only as far as you need to confirm it. Never download, screenshot,
   copy or forward the material.
2. Report it at https://cybercrime.gov.in under "Report child pornography / rape content". Record the
   acknowledgement number in the item's "cybercrime.gov.in reference" field.
3. Choose "Hide it" with a short reason. The record is kept for 180 days.
4. If police ask for it, send what the console's export holds for that account. Don't send the
   content by email.

If it was not child sexual material, choose "Restore" and tick "This complaint was false" if it was
filed in bad faith.

## Nudity, sexual content, morphed images or impersonation (P1, 2 hours)

The post is hidden while you review. Decide within 2 hours of filing:
- It is what the complaint says: "Hide it".
- It isn't: "Restore". Tick "false" if it was filed in bad faith. Three false complaints from the same
  email or IP address stop that person's complaints from hiding anything automatically.

## Court or government order (P0, 3 hours)

Nothing changes until you act, so a forged form can't censor anything.

1. Verify. Courts: check the case number on the court's site, or call the registry. Government: the
   notification must come from an agency authorised under Section 79(3)(b). Police: the officer must
   be at least a Deputy Inspector General, authorised in writing (Rule 3(1)(d), as amended in 2026).
2. Valid: "Verified: act on it". It is disabled only in the countries the order names, or worldwide if
   it names none. Court orders are published in the transparency log by default. Government and police
   orders are not, because blocking orders under Section 69A are confidential. Change it only if you
   know the order allows it.
3. Not valid: "Reject", with the reason. Unsure and the clock is running: act on it and note that
   you'll challenge it. A lawyer can then challenge it. Rejecting a real order loses safe harbour.
4. Reply to the officer's email with the reference.

## Data request (P1, 72 hours)

1. Verify the officer and the legal basis as above.
2. "Export what we hold" gives the profile, sessions, consents, the 180-day access log and posts for
   that account. Send only what the order covers.
3. "Mark answered", with a note of what you sent.

## Other complaints (36 hours or 7 days)

Read the post in context. The rules on `/rules` say what stays up. A complaint gets a written decision,
not automatically a removal. Choose:
- "No action" for lawful speech, with a one-line reason the reporter will see.
- "Add label" when people should be able to filter it but it's lawful.
- "Withhold" when it's unlawful only in some countries.
- "Hide it" when it breaks the rules everywhere.

## Appeals (7 days)

"Overturn and restore" or "Uphold", with a reason. An overturn never lifts a legal order. To end an
order after a court sets it aside, use "Orders in force > Lift" in the console, with the ruling as the
reason.

Every reason something is hidden is kept separately. Restoring after one report, or an appeal, never
undoes a removal made for another reason, and never touches a legal order.

## Program redeployed (P0)

The app raises this whenever the program's code changes on chain. If you deployed it, acknowledge it.
If you didn't, the upgrade key is compromised: treat it as a security incident.

## Security incident (CERT-In, 6 hours)

Examples include a leaked database credential, a defaced site, unauthorised console access or a
compromised wallet. Report to incident@cert-in.org.in within 6 hours of noticing it, with what you
know. Then rotate every secret listed in `docs/LAUNCH.md`.

## If you'll be unreachable

Name a second operator before launch. Add their wallet to `ADMIN_WALLETS` and their Telegram to the
alarm chat. Nobody being reachable for 3 hours is the single biggest legal risk of running this app.
