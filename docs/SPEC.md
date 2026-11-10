# UPROAR: design spec

An X-style social network whose posts live on Solana. The chain holds the speech. The reference
app and indexer are an ordinary Indian intermediary that follows the law. Anyone can run another.

Date: 2026-11-09. Operator: Rishab Kumar Jha, independent developer, India.

## 1. Layers

| Layer | What | Who controls it |
|---|---|---|
| L0 Program | `programs/uproar`: identity PDAs, signature checks, no admin logic | Nobody once the upgrade key is frozen; the operator during beta |
| L1 Indexer | `packages/indexer-core`: Postgres projection, rebuildable from chain | Anyone can run one |
| L2 Floor | Hide or country-withhold in this app, API, search and share cards, with reason, audit log and appeal | Operator, required by law |
| L3 User | Labels hide/warn/show, private block/mute/muted words, chronological Following, open For You formula | The user |
| L4 Exit | Open protocol, open source, other frontends and indexers | Anyone |

Non-negotiable marketing rule: never say "uncensorable", "no rules" or "can't be stopped". Say:
"the protocol is open; this app follows the law; run your own if you disagree."

## 2. Protocol

Event-sourced. Post text lives in instruction data, not in accounts: about 650x cheaper than a post
account. PDAs exist only where the chain must enforce something.

### Accounts

- `Profile` seeds `["profile", creator]`: creator, authority, handle, session_epoch, created_at, bump.
  The address is the permanent identity. A released handle never drags old posts onto a new owner.
- `Handle` seeds `["handle", handle]`: profile, deposit, claimed_at, bump. Holds rent plus a refundable deposit.
- `Session` seeds `["session", profile, delegate]`: profile, delegate, rent_payer, expires_at, epoch, bump.

### Instructions

Owner only (wallet signs):
`create_profile`, `claim_handle`, `release_handle`, `transfer_handle` (both owners sign),
`rotate_authority` (both sign), `create_session`, `extend_session`, `revoke_all_sessions`, `close_profile`.

The delegate, the wallet that paid its rent, or anyone once it has expired: `close_session`.

Social (owner or a live delegate, profile must hold a handle):
`post`, `like`, `unlike`, `repost`, `unrepost`, `follow`, `unfollow`, `set_profile`, `pin`.
`delete_post` is owner only, so a leaked session key can't wipe someone's history.

### Rules the program enforces

- Handles: 3 to 15 chars of `[a-z0-9_]`. Lowercase only on chain, so `Rishab` and `rishab` can't both exist.
- Refundable deposits: 3 chars 1 SOL, 4 chars 0.25 SOL, 5+ chars 0.01 SOL. The deposit is the spam wall.
- Sessions: at most 30 days. Delegates can do social actions only; they can never touch wallet funds,
  handles, the profile owner or other sessions. Delegate fuel is capped.
- Rotation and revoke-all kill every older session (epoch check). Epochs are slot-seeded, and a profile
  can only close once the slot has caught up with its epoch, so recreating it can't revive a revoked
  session. A rotated profile can't be closed at all, so its creator key can't take the address back.
- Every instruction rejects CPI (stack height 1). Indexers only ever parse top-level instructions, so
  there are no inner-instruction or log-parsing edge cases.
- No fees, no treasury, no token. Rent and deposits return to the owner.

### Canonical IDs and ordering

- Post ID = transaction signature. Known client-side before sending. Only the first `post` in a
  transaction counts; later ones in the same transaction are ignored by rule.
- Event ID = (signature, top-level instruction index). Failed transactions are ignored.
- Event order = (slot, signature in bytewise base58, instruction index). This is a deterministic tie-break,
  not execution order. Ownership chains are resolved by in/out balance, which is order-independent.
- `delete_post` only counts when signed for the post's author profile.

## 3. Indexer

- `events` is the raw log. Everything else is a projection that is a pure function of `events`.
- Live ingest paths: client hint (`/api/ingest?sig=`, server re-fetches from RPC and never trusts the client),
  Helius webhook, reconcile job (walks `getSignaturesForAddress`).
- Arrival order must not matter. Proofs in the test suite: shuffled arrival equals sorted arrival equals
  wipe-and-replay, compared by a canonical state hash.
- Rollback handling: events are marked finalized by the reconcile job. An event that never finalizes
  raises an alarm and triggers a rebuild.

## 4. Moderation and law

Primary sources: IT Rules 2021 as amended by G.S.R. 120(E) of 2026.

| Trigger | Clock | App action |
|---|---|---|
| Court or authorised government order, Rule 3(1)(d) | 3 hours | Alarm, one-click withhold scoped to the order, transparency entry where allowed |
| Complaint by or for the person, Rule 3(2)(b): private area, nudity, sexual act, impersonation, morphed images | 2 hours | Auto-hide on signed declaration, review after, restore if false; repeat false filers lose auto-hide |
| Sexual content involving a minor, POCSO | Immediately | Auto-hide, alarm, preserve, report to cybercrime.gov.in |
| Removal requests under Rule 3(1)(b) other than (i), (iv), (xi) | 36 hours | Queue, written decision. Stays up unless floor, manifestly illegal or ordered |
| Other grievances, Rule 3(2)(a)(i) | Ack 24 hours, resolve 7 days | Queue |
| Data order, Rule 3(1)(j) | 72 hours | Tracked request, minimal data |
| Removed content and records, Rule 3(1)(g) | Keep 180 days | Automatic |
| Security incidents, CERT-In directions | 6 hours | Runbook, logs 180 days |
| Rule 3(1)(c) | Every 3 months | Quarterly notice banner |

Floor categories hidden without a complaint when the operator sees them: child sexual material, credible
threats of violence against a named person, non-consensual intimate content, doxxing with intent to harm,
and anything a court or authorised authority orders.

Everything else (opinion, politics, religion, insults, satire) stays up by default and is filtered by users.
Hiding never touches the chain. Tombstones never link to chain content for floor categories.

Holds: every reason something is hidden or withheld is a separate hold owned by its report, order or
operator action. A decision releases only its own hold, and only an explicit lift ends a legal order.

Undo table: post delete hides in compliant apps but text stays on chain; like/repost/follow undo with an
opposite event; handle release refunds deposit and rent, or transfer; session revoke any time; block, mute,
bookmark and reports are private and undoable; app removal is appealable to the Grievance Officer and then
the Grievance Appellate Committee within 30 days.

Nobody can erase chain text, edit a post, post as you, or take your handle on chain.

Launch constraints that lower risk: text only, no uploads, no DMs, no tips, no token, no paid reach, no
manual picks. 18+. First-post consent: posts are permanent.

## 5. App

Next.js on Vercel (`apps/web`), Postgres (Supabase Mumbai in production, plain SQL migrations, no vendor
features required), read-only without a wallet. Wallet Standard connect, one popup for onboarding, then a
non-extractable WebCrypto delegate key signs everything.

v1 features: handle claim, profile with generated neon avatar and banner, 280-weighted posts, threads, quotes,
reposts, likes, follows, For You and Following, notifications, mentions, hashtags, trends, search, private
bookmarks, block and mute, muted words, pin, delete, share cards, who to follow, installable PWA.

Not in v1: images, video, DMs, Spaces, Communities, edit, polls, lists, view counts, tips, link previews.

For You formula is public on `/algorithm`. No manual picks, no paid boosts.

Private preferences (bookmarks, block, mute, muted words, label prefs) are stored off-chain and every request
is signed by the wallet or delegate. There are no accounts or passwords.

## 6. Look

madebyhuman's art direction: ink `#05070C`, neon `#FF2D95`, cyan `#2DF0FF`, white `#F1F3F7`. Anybody 900 wide
for shouts, Tomorrow for UI. Notched corners, torn edges, glitch as an event only. Live city on the landing
page (a still image without GPU acceleration) and dim in desktop gutters, none behind the mobile feed. Opaque readable panels. X's layout, none of its
name, logo or copy.

Never: camcorder HUDs, date stamps, fake terminals, dot grids, sound, levers, clever copy.

Signature feature: every claimed handle becomes a neon sign in the city, with a shareable image.

## 7. Build gates

1. Program: tests for every attack path, deployed to devnet.
2. Indexer: wipe and replay gives an identical state hash; shuffled order gives the same hash.
3. Safety: reports, console, legal pages, timed drills of every clock.
4. UI: Chromium and WebKit, local validator, mock Wallet Standard wallet.
5. Hardening: rate limits, strict CSP, RPC allowlist, load test, independent review agents.
6. Devnet beta: Rishab tests with Phantom.
7. Launch, only with his go: lawyer review, verified mainnet deploy, domain, handle claims, then feed.

Distribution gate: name the first 100 people before mainnet. Launch metric: 100 weekly posters in 30 days.
