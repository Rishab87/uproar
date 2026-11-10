/**
 * The chain-is-the-source-of-truth proof, run against a real cluster.
 *
 * It drives a full social history with real signed transactions, indexes it live in shuffled order,
 * then wipes everything and rebuilds from the ledger alone. The two states must hash identically.
 *
 *   RPC_URL=http://127.0.0.1:8899 DATABASE_URL=postgres://... pnpm --filter @uproar/indexer proof
 *   RPC_URL=https://api.devnet.solana.com FUNDER_KEYPAIR=~/.config/solana/uproar/deployer.json ...
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from '@solana/kit';
import { Rpc, applyTransactions, connect, indexTransaction, ingestSignature, markFinalized, rebuild, reconcile, stateHash, type Sql } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';
import {
  COMPUTE_LIMITS,
  TransactionFailed,
  UPROAR_PROGRAM_ADDRESS,
  buildMessage,
  handleAddress,
  ix,
  profileAddress,
  sendWireTransaction,
  sessionAddress,
  waitForConfirmation,
} from '@uproar/protocol';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar';
const rpc = createSolanaRpc(RPC_URL);
const indexRpc = new Rpc([RPC_URL]);
const PROGRAM = UPROAR_PROGRAM_ADDRESS as string;
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(`PROOF FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

const allSigs: string[] = [];

async function send(feePayer: TransactionSigner, instructions: readonly Instruction[], computeUnits: number = COMPUTE_LIMITS.owner, options: { skipPreflight?: boolean; track?: boolean } = {}) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = buildMessage({ feePayer, blockhash, instructions, computeUnits });
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await sendWireTransaction(rpc, getBase64EncodedWireTransaction(signed), options);
  await waitForConfirmation(rpc, signature);
  if (options.track !== false) allSigs.push(signature);
  return signature as string;
}

function transferIx(from: TransactionSigner, to: string, amount: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from.address, role: 3, signer: from } as never,
      { address: address(to), role: 1 },
    ],
    data,
  };
}

async function fund(funder: KeyPairSigner | null, who: string, sol: number) {
  const amount = BigInt(Math.floor(sol * 1e9));
  if (funder) {
    await send(funder, [transferIx(funder, who, amount)], 10_000, { track: false });
    return;
  }
  const signature = await rpc.requestAirdrop(address(who), lamports(amount), { commitment: 'confirmed' }).send();
  await waitForConfirmation(rpc, signature);
}

type Person = { wallet: KeyPairSigner; delegate: KeyPairSigner; profile: Awaited<ReturnType<typeof profileAddress>>; session: Awaited<ReturnType<typeof sessionAddress>>; handle: string };

async function onboard(funder: KeyPairSigner | null, handle: string): Promise<Person> {
  const wallet = await generateKeyPairSigner();
  const delegate = await generateKeyPairSigner();
  await fund(funder, wallet.address, 0.05);
  const profile = await profileAddress(wallet.address);
  const session = await sessionAddress(profile, delegate.address);
  const handleAccount = await handleAddress(handle);
  // The whole onboarding is one transaction, so a person signs once.
  await send(
    wallet,
    [
      ix.createProfile({ authority: wallet, profile }),
      ix.claimHandle({ authority: wallet, profile, handleAccount, handle }),
      ix.createSession({
        authority: wallet,
        profile,
        delegate: delegate.address,
        session,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400),
        fuel: 3_000_000n,
      }),
    ],
    COMPUTE_LIMITS.onboarding,
  );
  return { wallet, delegate, profile, session, handle };
}

const s = (p: Person) => ({ signer: p.delegate, profile: p.profile, session: p.session });

async function history(funder: KeyPairSigner | null) {
  const tag = randomBytes(3).toString('hex');
  console.log('driving real transactions');
  const alice = await onboard(funder, `alice_${tag}`);
  const bob = await onboard(funder, `bob_${tag}`);
  const carol = await onboard(funder, `carol_${tag}`);

  const social = (p: Person, instruction: Instruction) => send(p.delegate, [instruction], COMPUTE_LIMITS.post);

  const first = await social(alice, ix.post({ ...s(alice), text: `hello from the chain #uproar${tag} @${bob.handle}` }));
  const reply = await social(bob, ix.post({ ...s(bob), text: 'replying नमस्ते', replyTo: first }));
  await social(carol, ix.post({ ...s(carol), text: 'quoting this', quoteOf: first }));
  const doomed = await social(alice, ix.post({ ...s(alice), text: 'this one gets deleted' }));
  await social(bob, ix.like({ ...s(bob), post: first }));
  await social(carol, ix.like({ ...s(carol), post: first }));
  await social(carol, ix.unlike({ ...s(carol), post: first }));
  await social(carol, ix.repost({ ...s(carol), post: first }));
  await social(bob, ix.follow({ ...s(bob), target: alice.profile }));
  await social(carol, ix.follow({ ...s(carol), target: alice.profile }));
  await social(carol, ix.unfollow({ ...s(carol), target: alice.profile }));
  await social(alice, ix.setProfile({ ...s(alice), name: 'Alice', bio: 'bio', website: 'https://a.example', location: 'Delhi', avatarSeed: 7, accent: 1 }));
  await social(alice, ix.pin({ ...s(alice), post: first }));
  // Deleting is owner-only, so it's signed by the wallet, not the session key.
  await send(alice.wallet, [ix.deletePost({ signer: alice.wallet, profile: alice.profile, post: doomed })], COMPUTE_LIMITS.social);
  let delegateDelete = false;
  try {
    await send(alice.delegate, [ix.deletePost({ ...s(alice), post: first })], COMPUTE_LIMITS.social, { skipPreflight: true, track: false });
  } catch (error) {
    if (!(error instanceof TransactionFailed)) throw error;
    delegateDelete = true;
  }
  check(delegateDelete, 'a session key cannot delete posts');

  // A delete of someone else's post lands on chain (Bob owns his profile), and must change nothing.
  await send(bob.wallet, [ix.deletePost({ signer: bob.wallet, profile: bob.profile, post: first })], COMPUTE_LIMITS.social);

  // A transaction that fails on chain must never appear in the index.
  const stranger = await generateKeyPairSigner();
  await fund(funder, stranger.address, 0.01);
  let failed: string | null = null;
  try {
    await send(stranger, [ix.post({ signer: stranger, profile: alice.profile, text: 'forged' })], COMPUTE_LIMITS.post, { skipPreflight: true, track: false });
  } catch (error) {
    if (!(error instanceof TransactionFailed)) throw error;
    failed = error.signature;
  }
  check(failed, 'a forged post is rejected on chain');

  // Handle lifecycle: Bob releases his name, Carol takes it over from nothing, and rotation works.
  const bobHandle = await handleAddress(bob.handle);
  await send(bob.wallet, [ix.releaseHandle({ authority: bob.wallet, profile: bob.profile, handleAccount: bobHandle })]);
  const carolHandle = await handleAddress(carol.handle);
  await send(carol.wallet, [ix.releaseHandle({ authority: carol.wallet, profile: carol.profile, handleAccount: carolHandle })]);
  await send(carol.wallet, [ix.claimHandle({ authority: carol.wallet, profile: carol.profile, handleAccount: bobHandle, handle: bob.handle })]);
  const newWallet = await generateKeyPairSigner();
  await fund(funder, newWallet.address, 0.01);
  await send(alice.wallet, [ix.rotateAuthority({ authority: alice.wallet, newAuthority: newWallet, profile: alice.profile })]);

  return { alice, bob, carol, newWallet, first, reply, doomed, failed: failed as string, tag };
}

async function expectState(sql: Sql, h: Awaited<ReturnType<typeof history>>) {
  const post = (await sql<{ like_count: number; repost_count: number; reply_count: number; quote_count: number; deleted: boolean }[]>`select * from posts where sig = ${h.first}`)[0];
  check(post?.like_count === 1, 'like and unlike net to one like');
  check(post?.repost_count === 1, 'repost counted');
  check(post?.reply_count === 1, 'reply counted');
  check(post?.quote_count === 1, 'quote counted');
  check(post?.deleted === false, "a non-author's delete has no effect");
  const doomed = (await sql<{ deleted: boolean }[]>`select deleted from posts where sig = ${h.doomed}`)[0];
  check(doomed?.deleted === true, "the author's delete hides the post");
  const forged = await sql`select 1 from events where sig = ${h.failed}`;
  check(forged.length === 0, 'the failed transaction was not indexed');
  const alice = (await sql<{ authority: string; follower_count: number; name: string; pinned_post: string }[]>`select * from profiles where address = ${h.alice.profile}`)[0];
  check(alice?.authority === h.newWallet.address, 'rotation moved the authority');
  check(alice?.follower_count === 1, 'follow and unfollow net to one follower');
  check(alice?.name === 'Alice', 'set_profile applied');
  check(alice?.pinned_post === h.first, 'pin applied');
  const bob = (await sql<{ handle: string | null }[]>`select handle from profiles where address = ${h.bob.profile}`)[0];
  const carol = (await sql<{ handle: string | null }[]>`select handle from profiles where address = ${h.carol.profile}`)[0];
  check(bob?.handle === null, 'release removed the handle');
  check(carol?.handle === h.bob.handle, 'a released name can be claimed by someone else');
  const tagged = await sql`select 1 from post_tags where post = ${h.first} and tag = ${`uproar${h.tag}`}`;
  check(tagged.length === 1, 'hashtag extracted');
  const mentioned = await sql`select 1 from post_mentions where post = ${h.first} and handle = ${h.bob.handle}`;
  check(mentioned.length === 1, 'mention extracted');
}

async function scratchSchema(name: string) {
  const schema = `proof_${name}_${randomBytes(4).toString('hex')}`;
  const admin = connect(DATABASE_URL, { max: 1 });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  const sql = connect(DATABASE_URL, { max: 3, schema });
  await migrate(sql);
  return {
    sql,
    drop: async () => {
      await sql.unsafe(`drop schema ${schema} cascade`);
      await sql.end();
    },
  };
}

async function main() {
  const funderPath = process.env.FUNDER_KEYPAIR?.replace(/^~/, homedir());
  const funder = funderPath ? await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(funderPath, 'utf8')))) : null;

  const live = await scratchSchema('live');
  const replay = await scratchSchema('replay');
  try {
    const h = await history(funder);

    console.log(`indexing ${allSigs.length} transactions live, in shuffled order`);
    const shuffled = [...allSigs].sort(() => Math.random() - 0.5);
    for (const sig of shuffled) {
      const result = await ingestSignature(live.sql, indexRpc, PROGRAM, sig);
      if (result === 'not_found') throw new Error(`RPC never returned ${sig}`);
    }
    await expectState(live.sql, h);
    const liveHash = await stateHash(live.sql);
    console.log(`  live state hash: ${liveHash}`);

    console.log('re-ingesting a real signature must change nothing');
    const sig0 = allSigs[0] as string;
    const raw = await indexRpc.getTransaction(sig0);
    const tx = raw && indexTransaction(raw, PROGRAM);
    await applyTransactions(live.sql, tx ? [tx] : []);
    check((await stateHash(live.sql)) === liveHash, 'replay is a no-op');

    console.log('rebuilding the projection from the event log');
    await rebuild(live.sql);
    check((await stateHash(live.sql)) === liveHash, 'rebuild matches');

    if (!process.env.PROOF_SKIP_REPLAY) {
      console.log('empty database, using nothing but the ledger');
      const result = await reconcile(replay.sql, indexRpc, PROGRAM, { budgetMs: 600_000 });
      console.log(`  listed ${result.listed}, fetched ${result.missing}, applied ${result.applied}`);
      await expectState(replay.sql, h);
      // A shared cluster can hold other people's transactions, so compare only this run's rows.
      const scope = async (sql: Sql) => {
        const rows = await sql<{ sig: string; ix_index: number; kind: string; data: unknown }[]>`
          select sig, ix_index, kind, data from events where sig = any(${allSigs}) order by sig, ix_index`;
        return JSON.stringify(rows);
      };
      check((await scope(replay.sql)) === (await scope(live.sql)), "this run's events match the live index exactly");
      const total = await replay.sql<{ n: number }[]>`select count(*)::int as n from events`;
      const liveTotal = await live.sql<{ n: number }[]>`select count(*)::int as n from events`;
      if (total[0]?.n === liveTotal[0]?.n) {
        const replayHash = await stateHash(replay.sql);
        console.log(`  replay state hash: ${replayHash}`);
        check(replayHash === liveHash, 'wipe-and-replay state hash is identical to the live state hash');
      } else {
        console.log(`  cluster holds other history (${total[0]?.n} vs ${liveTotal[0]?.n} events), so the full-hash comparison does not apply`);
        // Bring the live index up to the same history, then the hashes must agree.
        await reconcile(live.sql, indexRpc, PROGRAM, { budgetMs: 600_000 });
        const again = await stateHash(live.sql);
        const replayHash = await stateHash(replay.sql);
        check(again === replayHash, 'after catching up, live and replay state hashes are identical');
      }
    }

    const finalize = await markFinalized(live.sql, indexRpc);
    console.log(`  marked ${finalize.finalized} finalized so far, ${finalize.orphaned.length} orphaned`);
    console.log('\nPROOF PASSED');
  } finally {
    await live.drop();
    await replay.drop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
