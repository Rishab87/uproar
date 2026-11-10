# UPROAR protocol

One Solana program. Anyone can read its history and rebuild the same state. This file is the contract
between the program and every indexer.

Program id: `2BgbuMAkSP1QwCcCc955i7Bhqv6fwRTqtVZzQU3WqKD1` (localnet and devnet; mainnet uses the same
keypair unless a new one is generated before launch).

## Accounts

The chain only stores what it must enforce. Discriminators are one byte.

| Account | Seeds | Size | Fields |
|---|---|---|---|
| Profile (1) | `["profile", creator]` | 98 bytes | creator, authority, handle[15], handle_len, session_epoch, created_at, bump |
| Handle (2) | `["handle", name]` | 50 bytes | profile, deposit, claimed_at, bump |
| Session (3) | `["session", profile, delegate]` | 114 bytes | profile, delegate, rent_payer, expires_at, epoch, bump |

- A profile address never changes. Rotating the wallet changes `authority`, not the address.
- A handle account holds its rent plus a refundable deposit: 1 SOL for 3 characters, 0.25 SOL for 4,
  0.01 SOL for 5 to 15. Releasing returns both to the profile's authority.
- A session lets `delegate` act for `profile` until `expires_at`, if `epoch` equals the profile's
  `session_epoch`. Rotation and revoke-all raise the epoch to at least the current slot, which kills
  every older session. A profile can only be closed once the slot has caught up with its epoch, and a
  recreated profile starts at the current slot, so a revoked session can never match it again.
- A profile whose wallet was rotated can't be closed. Its address comes from the creator wallet, so
  closing it would let that old key recreate the same address and inherit its history.

## Instructions

| # | Name | Signers | Notes |
|---|---|---|---|
| 1 | create_profile | wallet | |
| 2 | claim_handle(handle) | owner | 3 to 15 of `[a-z0-9_]`, one per profile |
| 3 | release_handle | owner | refunds deposit and rent |
| 4 | transfer_handle | both owners | receiver must hold no handle |
| 5 | rotate_authority | old and new wallet | kills sessions |
| 6 | close_profile | owner | only without a handle, only if the creator wallet still owns it, only once the slot has reached the session epoch |
| 10 | create_session(expires_at, fuel) | owner | at most 30 days, fuel at most 0.05 SOL |
| 11 | extend_session(expires_at, fuel) | owner | revalidates the epoch |
| 12 | close_session | delegate, rent payer, or anyone after expiry | rent goes to the recorded payer |
| 13 | revoke_all_sessions | owner | |
| 20 | post(text, reply_to?, quote_of?) | owner or delegate | text 1 to 900 bytes, not blank |
| 21 | delete_post(post) | owner only | a leaked session key can't wipe a history |
| 22, 23 | like, unlike(post) | owner or delegate | |
| 24, 25 | repost, unrepost(post) | owner or delegate | |
| 26, 27 | follow, unfollow(target) | owner or delegate | no self-follow |
| 28 | set_profile(name, bio, website, location, avatar_seed, accent) | owner or delegate | 64, 320, 120, 64 bytes |
| 29 | pin(post?) | owner or delegate | none clears |

Social instructions take `[signer, profile, session?]`. The optional session slot is filled with the
program id when absent. Every instruction rejects CPI, so only top-level instructions can ever count.

`post`, `reply_to` and `quote_of` are 64-byte transaction signatures. A post's id is the signature of
the transaction that carried it.

## Indexing rules

1. Read top-level instructions of successful transactions whose program id is this program. Ignore
   inner instructions, failed transactions and anything that doesn't decode (invalid UTF-8 or unknown
   discriminators). Bytes after an instruction's arguments are ignored, exactly as the program
   ignores them, so every reader sees the same post for the same bytes.
2. An event's id is `(signature, instruction index)`. Applying an event twice changes nothing.
3. Order events by slot, then signature (bytewise, base58), then instruction index.
4. Only the first `post` in a transaction counts. Later ones are ignored.
5. Likes, reposts, follows, pins and profile edits are last-write-wins in that order.
6. A `delete_post` counts only when its profile is the post's author, whenever it arrives.
7. Handle ownership: across all known claims, releases and transfers of a handle, the holder is the
   profile with one more move in than out. This doesn't depend on order inside a slot, where
   signature order isn't execution order.
8. Profile authority follows the same balance over creates, rotations and closes.
9. Hashtags and mentions follow `packages/protocol/src/text.ts`.

`packages/indexer-core` implements these rules. Its test suite proves that shuffled arrival, batched
arrival and a full rebuild produce the same state hash, and `apps/indexer/src/chain-proof.ts` proves
the same against a real cluster. Compare two indexers with `uproar-indexer hash`.

## What the program doesn't do

It has no admin logic, no fees, no treasury and no token. It can't hide, edit or delete anything.
Moderation exists only in apps that read the chain.

While the upgrade authority is held, the operator could deploy new rules for future transactions.
Indexers trust that a successful transaction was authorised, so a malicious upgrade could also forge
events, including deletes, from then on. The reference app raises an alarm whenever the program is
redeployed. The upgrade key belongs in a multisig until the program is frozen after the beta.

Because every instruction rejects CPI, smart-contract wallets (multisigs, passkey wallets) can't own
a profile. Use an ordinary wallet.
