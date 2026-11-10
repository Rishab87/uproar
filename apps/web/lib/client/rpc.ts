import { address, createSolanaRpc, type Blockhash } from '@solana/kit';

let client: ReturnType<typeof createSolanaRpc> | null = null;

/** All chain access goes through this app's allowlisted proxy, so no RPC key reaches the browser. */
export function clientRpc() {
  client ??= createSolanaRpc(new URL('/api/rpc', window.location.origin).toString());
  return client;
}

type CachedBlockhash = { value: { blockhash: Blockhash; lastValidBlockHeight: bigint }; at: number };
let cachedHash: CachedBlockhash | null = null;
const BLOCKHASH_TTL_MS = 20_000;

export async function latestBlockhash() {
  if (cachedHash && Date.now() - cachedHash.at < BLOCKHASH_TTL_MS) return cachedHash.value;
  const { value } = await clientRpc().getLatestBlockhash({ commitment: 'confirmed' }).send();
  cachedHash = { value, at: Date.now() };
  return value;
}

export function forgetBlockhash(): void {
  cachedHash = null;
}

let cachedFee: { value: bigint; at: number } | null = null;
const FEE_TTL_MS = 30_000;
const MAX_MICRO_LAMPORTS = 50_000n;

/** A small priority fee when the network is busy, and none when it isn't. */
export async function priorityFee(): Promise<bigint> {
  if (cachedFee && Date.now() - cachedFee.at < FEE_TTL_MS) return cachedFee.value;
  let value = 0n;
  try {
    const fees = await clientRpc().getRecentPrioritizationFees().send();
    const paid = fees.map((f) => BigInt(f.prioritizationFee)).filter((f) => f > 0n).sort((a, b) => (a < b ? -1 : 1));
    if (paid.length > fees.length / 2) value = paid[Math.floor(paid.length * 0.75)] ?? 0n;
  } catch {
    value = 0n;
  }
  if (value > MAX_MICRO_LAMPORTS) value = MAX_MICRO_LAMPORTS;
  cachedFee = { value, at: Date.now() };
  return value;
}

const CLOCK_SYSVAR = address('SysvarC1ock11111111111111111111111111111111');

/**
 * The cluster's own clock. It can run behind the computer's clock, by minutes on a local validator,
 * so anything the program checks against time must be computed from this, not from Date.now().
 */
export async function chainUnixTime(): Promise<number> {
  const { value } = await clientRpc().getAccountInfo(CLOCK_SYSVAR, { encoding: 'base64', dataSlice: { offset: 32, length: 8 } }).send();
  if (!value) throw new Error('Could not read the cluster clock');
  const bytes = Uint8Array.from(atob(value.data[0]), (c) => c.charCodeAt(0));
  return Number(new DataView(bytes.buffer).getBigInt64(0, true));
}
