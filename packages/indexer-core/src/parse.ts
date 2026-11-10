import { getBase58Encoder } from '@solana/kit';
import { decodeInstruction, type UproarEvent } from '@uproar/protocol';

/** The fields of getTransaction (encoding: json) that indexing depends on. */
export type RpcTransaction = {
  slot: number;
  blockTime?: number | null;
  meta: { err: unknown; loadedAddresses?: { writable: string[]; readonly: string[] } | null } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: string[];
      instructions: { programIdIndex: number; accounts: number[]; data: string }[];
    };
  };
};

export type IndexedEvent = { ixIndex: number; event: UproarEvent };
export type IndexedTx = { sig: string; slot: number; blockTime: number | null; events: IndexedEvent[] };

const base58 = getBase58Encoder();

/**
 * Turns a confirmed transaction into events. Returns null when there is nothing to index. Only
 * top-level instructions can count: the program rejects CPI, so inner instructions never matter.
 */
export function indexTransaction(raw: RpcTransaction, programId: string): IndexedTx | null {
  if (!raw.meta || raw.meta.err !== null) return null;
  const sig = raw.transaction.signatures[0];
  if (!sig) return null;

  const loaded = raw.meta.loadedAddresses;
  const keys = [...raw.transaction.message.accountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  const events: IndexedEvent[] = [];

  raw.transaction.message.instructions.forEach((instruction, ixIndex) => {
    if (keys[instruction.programIdIndex] !== programId) return;
    const accounts = instruction.accounts.map((i) => keys[i]);
    if (accounts.some((a) => a === undefined)) return;
    let data: Uint8Array;
    try {
      data = base58.encode(instruction.data) as Uint8Array;
    } catch {
      return;
    }
    const event = decodeInstruction({ data, accounts: accounts as string[] });
    if (event) events.push({ ixIndex, event });
  });

  if (events.length === 0) return null;
  return { sig, slot: raw.slot, blockTime: raw.blockTime ?? null, events };
}
