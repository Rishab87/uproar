import { generateKeyPairSigner, getBase58Decoder, type Address } from '@solana/kit';
import { UPROAR_PROGRAM_ADDRESS, ix, profileAddress, sessionAddress } from '@uproar/protocol';
import { describe, expect, it } from 'vitest';
import { indexTransaction, type RpcTransaction } from '../src/index';
import { fakeSig } from './helpers';

const b58 = getBase58Decoder();
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

type Built = { data: unknown; accounts: readonly { address: string }[]; programAddress: string };

/** Lays out instructions the way getTransaction returns them, with accounts as indexes. */
function rpcTx(built: Built[], opts: { err?: unknown; lookup?: string[]; slot?: number; blockTime?: number | null } = {}): RpcTransaction {
  const keys: string[] = [];
  const indexOf = (k: string) => {
    let i = keys.indexOf(k);
    if (i < 0) i = keys.push(k) - 1;
    return i;
  };
  // Addresses in `lookup` are loaded from a table, so they sit after the static keys.
  const lookup = new Set(opts.lookup ?? []);
  const statics = [...new Set(built.flatMap((b) => [...b.accounts.map((a) => a.address), b.programAddress]))].filter((k) => !lookup.has(k));
  statics.forEach(indexOf);
  const loaded = [...lookup];
  loaded.forEach(indexOf);
  return {
    slot: opts.slot ?? 100,
    blockTime: opts.blockTime === undefined ? 1_800_000_000 : opts.blockTime,
    meta: { err: opts.err ?? null, loadedAddresses: { writable: loaded, readonly: [] } },
    transaction: {
      signatures: [fakeSig('tx')],
      message: {
        accountKeys: statics,
        instructions: built.map((b) => ({
          programIdIndex: indexOf(b.programAddress),
          accounts: b.accounts.map((a) => indexOf(a.address)),
          data: b58.decode(b.data as Uint8Array),
        })),
      },
    },
  };
}

async function fixtures() {
  const w = await generateKeyPairSigner();
  const d = await generateKeyPairSigner();
  const p = await profileAddress(w.address);
  const s = await sessionAddress(p, d.address);
  return { w, d, p, s };
}

describe('indexTransaction', () => {
  it('reads top-level program instructions and keeps their index', async () => {
    const { d, p, s } = await fixtures();
    const budget = { programAddress: COMPUTE_BUDGET, accounts: [], data: new Uint8Array([2, 0, 0, 0, 0]) };
    const raw = rpcTx([budget, ix.post({ signer: d, profile: p, session: s, text: 'hello' })]);
    const out = indexTransaction(raw, UPROAR_PROGRAM_ADDRESS);
    expect(out?.sig).toBe(fakeSig('tx'));
    expect(out?.slot).toBe(100);
    expect(out?.events).toHaveLength(1);
    expect(out?.events[0]).toMatchObject({ ixIndex: 1, event: { kind: 'post', text: 'hello', profile: p, signer: d.address, session: s } });
  });

  it('ignores failed transactions', async () => {
    const { d, p, s } = await fixtures();
    const raw = rpcTx([ix.post({ signer: d, profile: p, session: s, text: 'hello' })], { err: { InstructionError: [0, { Custom: 6001 }] } });
    expect(indexTransaction(raw, UPROAR_PROGRAM_ADDRESS)).toBeNull();
  });

  it('returns null when the transaction never touches the program', async () => {
    const raw = rpcTx([{ programAddress: COMPUTE_BUDGET, accounts: [], data: new Uint8Array([2, 0, 0, 0, 0]) }]);
    expect(indexTransaction(raw, UPROAR_PROGRAM_ADDRESS)).toBeNull();
  });

  it('ignores the same bytes sent to a different program', async () => {
    const { d, p, s } = await fixtures();
    const lookalike = { ...ix.post({ signer: d, profile: p, session: s, text: 'fake' }), programAddress: COMPUTE_BUDGET };
    expect(indexTransaction(rpcTx([lookalike]), UPROAR_PROGRAM_ADDRESS)).toBeNull();
  });

  it('resolves accounts loaded from an address lookup table', async () => {
    const { d, p, s } = await fixtures();
    const raw = rpcTx([ix.post({ signer: d, profile: p, session: s, text: 'hello' })], { lookup: [s] });
    expect(raw.transaction.message.accountKeys).not.toContain(s);
    expect(indexTransaction(raw, UPROAR_PROGRAM_ADDRESS)?.events[0]).toMatchObject({ event: { session: s } });
  });

  it('skips malformed instructions but keeps good ones in the same transaction', async () => {
    const { d, p, s } = await fixtures();
    const bad = { programAddress: UPROAR_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array([200, 1, 2]) };
    const raw = rpcTx([bad, ix.like({ signer: d, profile: p, session: s, post: fakeSig('x') })]);
    const out = indexTransaction(raw, UPROAR_PROGRAM_ADDRESS);
    expect(out?.events).toHaveLength(1);
    expect(out?.events[0]).toMatchObject({ ixIndex: 1, event: { kind: 'like' } });
  });

  it('allows a missing block time', async () => {
    const { d, p, s } = await fixtures();
    const raw = rpcTx([ix.like({ signer: d, profile: p, session: s, post: fakeSig('x') })], { blockTime: null });
    expect(indexTransaction(raw, UPROAR_PROGRAM_ADDRESS)?.blockTime).toBeNull();
  });

  it('never trusts addresses from outside the account table', async () => {
    const { d, p, s } = await fixtures();
    const raw = rpcTx([ix.like({ signer: d, profile: p, session: s, post: fakeSig('x') })]);
    (raw.transaction.message.instructions[0] as { accounts: number[] }).accounts = [999, 998, 997];
    expect(indexTransaction(raw, UPROAR_PROGRAM_ADDRESS)).toBeNull();
    const _: Address | undefined = undefined;
    void _;
  });
});
