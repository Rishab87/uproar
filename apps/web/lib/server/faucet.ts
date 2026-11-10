import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type AccountSignerMeta,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import type { Sql } from '@uproar/indexer-core';
import { buildMessage } from '@uproar/protocol';
import { checkRateLimit } from '@uproar/safety';
import { getRpc } from './db';
import { env } from './env';

/**
 * 0.02 test SOL per new wallet. A name of five or more letters needs about 0.0164: the 0.01 deposit,
 * rent for its accounts, and fees for 200 actions. Shorter names cost more than the tap gives.
 */
export const DRIP_LAMPORTS = 20_000_000n;
const DAY = 86_400;

export type DripResult =
  | { status: 'sent'; signature: string; lamports: string }
  | { status: 'not_needed' | 'already_sent' | 'limited' | 'dry' | 'unavailable' | 'failed' };

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/** The System Program's transfer: instruction 2, then the amount as a little-endian u64. */
function transfer(from: TransactionSigner, to: Address, amount: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);
  const payer: AccountSignerMeta = { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from };
  return { programAddress: SYSTEM_PROGRAM, accounts: [payer, { address: to, role: AccountRole.WRITABLE }], data };
}

const balanceOf = async (who: string) => BigInt((await getRpc().call<{ value: number }>('getBalance', [who, { commitment: 'confirmed' }])).value);

/**
 * Sends a new wallet enough test SOL to claim a name, from the tap key in FAUCET_SECRET. Test clusters
 * only: once per wallet, three a day per network address, three hundred a day in all. A script can
 * still drain it, slowly, and then the claim page points people to faucet.solana.com.
 */
export async function drip(sql: Sql, wallet: string, ipKey: string): Promise<DripResult> {
  if (env.cluster === 'mainnet-beta') return { status: 'unavailable' };
  const rpc = getRpc();
  if (!(await checkRateLimit(sql, `faucet-ask:${ipKey}`, 30, 3_600))) return { status: 'limited' };
  const secret = env.faucetSecret;
  if (!secret) {
    // A local validator still has its own airdrop. The public clusters have closed theirs.
    if (env.cluster !== 'localnet') return { status: 'unavailable' };
    const signature = await rpc.call<string>('requestAirdrop', [wallet, 1_000_000_000]);
    return { status: 'sent', signature, lamports: '1000000000' };
  }
  if ((await balanceOf(wallet)) >= DRIP_LAMPORTS) return { status: 'not_needed' };
  // The row goes in first, so two requests for one wallet can't both send.
  const fresh = await sql`insert into faucet_drips (address, lamports) values (${wallet}, ${DRIP_LAMPORTS.toString()}) on conflict do nothing returning address`;
  if (fresh.length === 0) return { status: 'already_sent' };
  const release = () => sql`delete from faucet_drips where address = ${wallet} and signature is null`;
  try {
    if (!(await checkRateLimit(sql, `faucet:${ipKey}`, 3, DAY)) || !(await checkRateLimit(sql, 'faucet:all', 300, DAY))) {
      await release();
      return { status: 'limited' };
    }
    const tap = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret) as number[]));
    const left = await balanceOf(tap.address);
    if (left < DRIP_LAMPORTS + 1_000_000n) {
      console.error(`The test SOL tap ${tap.address} is dry: ${left} lamports left`);
      await release();
      return { status: 'dry' };
    }
    const latest = await rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const blockhash = { blockhash: latest.value.blockhash as Blockhash, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) };
    const signed = await signTransactionMessageWithSigners(buildMessage({ feePayer: tap, blockhash, instructions: [transfer(tap, address(wallet), DRIP_LAMPORTS)], computeUnits: 1_000 }));
    const signature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);
    await rpc.call('sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    // Wait for it to land, resending meanwhile. One that never lands frees the wallet to ask again.
    for (let i = 1; i <= 30; i++) {
      await new Promise((r) => setTimeout(r, 1_000));
      const [status] = await rpc.getSignatureStatuses([signature]);
      if (status?.err) break;
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        await sql`update faucet_drips set signature = ${signature} where address = ${wallet}`;
        return { status: 'sent', signature, lamports: DRIP_LAMPORTS.toString() };
      }
      if (i % 3 === 0) await rpc.call('sendTransaction', [wire, { encoding: 'base64', skipPreflight: true }]).catch(() => {});
    }
    await release();
    return { status: 'failed' };
  } catch (error) {
    await release();
    throw error;
  }
}
