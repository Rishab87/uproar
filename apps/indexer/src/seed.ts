/**
 * Fills a test cluster with a believable conversation, using real signed transactions, so the app
 * can be looked at and tried with data in it. Refuses to run against mainnet.
 *
 *   RPC_URL=http://127.0.0.1:8899 DATABASE_URL=postgres://... pnpm --filter @uproar/indexer seed
 */
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
import { Rpc, connect, ingestSignature } from '@uproar/indexer-core';
import { COMPUTE_LIMITS, UPROAR_PROGRAM_ADDRESS, buildMessage, handleAddress, ix, profileAddress, sendWireTransaction, sessionAddress, waitForConfirmation } from '@uproar/protocol';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
if (RPC_URL.includes('mainnet')) throw new Error('The seed script never runs against mainnet');
const rpc = createSolanaRpc(RPC_URL);
const indexRpc = new Rpc([RPC_URL]);
const sql = connect(process.env.DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar', { max: 2 });
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

async function send(feePayer: TransactionSigner, instructions: readonly Instruction[], units: number = COMPUTE_LIMITS.post): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const signed = await signTransactionMessageWithSigners(buildMessage({ feePayer, blockhash, instructions, computeUnits: units }));
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await sendWireTransaction(rpc, wire);
  // A validator that has just started can drop transactions. Resending the same bytes is safe: they
  // carry one signature, so they can only ever land once.
  const resend = setInterval(() => void sendWireTransaction(rpc, wire, { skipPreflight: true }).catch(() => {}), 2_000);
  try {
    await waitForConfirmation(rpc, signature);
  } finally {
    clearInterval(resend);
  }
  await ingestSignature(sql, indexRpc, UPROAR_PROGRAM_ADDRESS as string, signature);
  return signature;
}

async function fund(funder: KeyPairSigner | null, who: string, amount: bigint) {
  if (funder) {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);
    view.setBigUint64(4, amount, true);
    await send(funder, [{ programAddress: SYSTEM_PROGRAM, accounts: [{ address: funder.address, role: 3, signer: funder } as never, { address: address(who), role: 1 }], data }], 10_000);
    return;
  }
  const sig = await rpc.requestAirdrop(address(who), lamports(amount), { commitment: 'confirmed' }).send();
  await waitForConfirmation(rpc, sig);
}

type Person = { handle: string; wallet: KeyPairSigner; delegate: KeyPairSigner; profile: Awaited<ReturnType<typeof profileAddress>>; session: Awaited<ReturnType<typeof sessionAddress>> };

async function person(funder: KeyPairSigner | null, handle: string, name: string, bio: string, website: string, location: string, accent: number): Promise<Person> {
  const wallet = await generateKeyPairSigner();
  const delegate = await generateKeyPairSigner();
  await fund(funder, wallet.address, 40_000_000n);
  const profile = await profileAddress(wallet.address);
  const session = await sessionAddress(profile, delegate.address);
  await send(
    wallet,
    [
      ix.createProfile({ authority: wallet, profile }),
      ix.claimHandle({ authority: wallet, profile, handleAccount: await handleAddress(handle), handle }),
      ix.createSession({ authority: wallet, profile, delegate: delegate.address, session, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 29 * 86_400), fuel: 4_000_000n }),
    ],
    COMPUTE_LIMITS.onboarding,
  );
  const p = { handle, wallet, delegate, profile, session };
  await send(delegate, [ix.setProfile({ ...auth(p), name, bio, website, location, avatarSeed: handle.length * 7, accent })]);
  return p;
}

const auth = (p: Person) => ({ signer: p.delegate, profile: p.profile, session: p.session });
const post = (p: Person, text: string, extra: { replyTo?: string; quoteOf?: string } = {}) => send(p.delegate, [ix.post({ ...auth(p), text, ...extra })]);
const like = (p: Person, sig: string) => send(p.delegate, [ix.like({ ...auth(p), post: sig })], COMPUTE_LIMITS.social);
const repost = (p: Person, sig: string) => send(p.delegate, [ix.repost({ ...auth(p), post: sig })], COMPUTE_LIMITS.social);
const follow = (a: Person, b: Person) => send(a.delegate, [ix.follow({ ...auth(a), target: b.profile })], COMPUTE_LIMITS.social);

async function main() {
  const funderPath = process.env.FUNDER_KEYPAIR?.replace(/^~/, homedir());
  const funder = funderPath ? await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(funderPath, 'utf8')))) : null;
  const s = Math.random().toString(36).slice(2, 5);
  const riya = await person(funder, `riya_${s}`, 'Riya Menon', 'Backend engineer. Bad at sleeping. Good at Postgres.', 'https://example.com/riya', 'Bengaluru', 0);
  const kabir = await person(funder, `kabir_${s}`, 'Kabir', 'Building things on Solana from a very small flat.', '', 'Mumbai', 1);
  const ananya = await person(funder, `ananya_${s}`, 'Ananya Rao', 'Reporter. Tips welcome. Nothing here is off the record.', '', 'Delhi', 3);
  const dev = await person(funder, `devon_${s}`, 'Devon', 'Validator operator. Ask me about vote latency, or don\'t.', '', 'Lisbon', 4);
  const neon = await person(funder, `neonbazaar_${s}`, 'Neon Bazaar', 'A street food stall that posts too much.', '', 'Hyderabad', 2);
  console.log('people ready');

  await follow(kabir, riya);
  await follow(ananya, riya);
  await follow(dev, riya);
  await follow(riya, kabir);
  await follow(neon, ananya);

  const first = await post(riya, 'first post on chain. strange feeling knowing i can hide this but never actually erase it. choosing my words a bit more carefully already #uproar');
  await like(kabir, first);
  await like(ananya, first);
  await like(dev, first);
  await repost(kabir, first);
  const r1 = await post(kabir, `@riya_${s} that's the whole point though. you stop posting things you'd want to take back`, { replyTo: first });
  await like(riya, r1);
  await post(dev, `@kabir_${s} or you just post worse things under a second name. deposits only slow that down`, { replyTo: r1 });

  const costs = await post(kabir, 'claimed my name, signed one transaction, and now likes and replies don\'t pop up a wallet. session keys are the only reason this feels like a normal app #solana');
  await like(riya, costs);
  await repost(dev, costs);
  await post(ananya, 'कल रात बारिश में पूरा शहर चमक रहा था। #mumbai #monsoon');
  const q = await post(ananya, 'the part i care about: every takedown goes in a public log, with the reason. i\'ve never had that from any platform i\'ve reported on', { quoteOf: first });
  await like(riya, q);
  await like(kabir, q);
  await like(neon, q);
  await repost(riya, q);
  await post(neon, 'biryani update: sold out by 8pm again. we did not plan for this. #hyderabad');
  await post(dev, 'for you is literally one formula on a public page. first time i\'ve been able to read why i\'m seeing a post #uproar');
  await post(riya, 'muted the word "airdrop" and my feed got about 40% better');
  const long = await post(kabir, 'small thing i like: reading doesn\'t need a wallet at all. you only connect when you want to say something. https://example.com/why-reading-should-be-free');
  await like(ananya, long);
  await post(neon, 'अगले हफ्ते से दिल्ली में भी। #biryani');
  await post(dev, 'ran the indexer from scratch against my own node last night. same state hash as the public app. that\'s the whole pitch, really #solana');
  console.log('conversation ready');
  await sql.end();
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
