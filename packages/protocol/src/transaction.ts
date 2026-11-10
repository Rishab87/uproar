/**
 * Transaction assembly. Compute limits are explicit so fees stay flat and priority fees are cheap.
 * Reads never lock accounts for writing, so social transactions don't compete for write locks.
 */
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionSize,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';

const COMPUTE_BUDGET = address('ComputeBudget111111111111111111111111111111');

/** Measured with the test suite: the heaviest post uses about 13,000 units. */
export const COMPUTE_LIMITS = { post: 20_000, social: 8_000, owner: 60_000, onboarding: 120_000 } as const;

export const MAX_TRANSACTION_BYTES = 1232;

export function setComputeUnitLimit(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET, data };
}

export function setComputeUnitPrice(microLamports: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, microLamports, true);
  return { programAddress: COMPUTE_BUDGET, data };
}

export type BuildOptions = {
  feePayer: TransactionSigner;
  blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
  instructions: readonly Instruction[];
  computeUnits: number;
  microLamportsPerUnit?: bigint;
};

export function buildMessage({ feePayer, blockhash, instructions, computeUnits, microLamportsPerUnit = 0n }: BuildOptions) {
  const budget = [setComputeUnitLimit(computeUnits), ...(microLamportsPerUnit > 0n ? [setComputeUnitPrice(microLamportsPerUnit)] : [])];
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([...budget, ...instructions], m),
  );
}

const SIZING_BLOCKHASH = {
  blockhash: '11111111111111111111111111111111' as Blockhash,
  lastValidBlockHeight: 0n,
};

/**
 * The exact wire size of a social transaction with both compute-budget instructions, so clients can
 * reject a post that would not fit before asking anyone to sign it.
 */
export async function socialTransactionSize(instruction: Instruction, feePayer: TransactionSigner): Promise<number> {
  const message = buildMessage({
    feePayer,
    blockhash: SIZING_BLOCKHASH,
    instructions: [instruction],
    computeUnits: COMPUTE_LIMITS.post,
    microLamportsPerUnit: 1n,
  });
  return getTransactionSize(compileTransaction(message));
}

export type { Address };
