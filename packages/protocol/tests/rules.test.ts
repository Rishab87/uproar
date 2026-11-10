import { generateKeyPairSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_3_CHAR,
  DEPOSIT_4_CHAR,
  DEPOSIT_DEFAULT,
  UPROAR_PROGRAM_ADDRESS,
  bytesToSignature,
  decodeInstruction,
  handleAddress,
  handleDeposit,
  isValidHandle,
  ix,
  normalizeHandle,
  profileAddress,
  sessionAddress,
  signatureToBytes,
  socialTransactionSize,
} from '../src/index';

const SYSTEM = '11111111111111111111111111111111' as Address;
const fakeSig = (fill: number) => bytesToSignature(new Uint8Array(64).fill(fill));

describe('handles', () => {
  it('accepts only what the program accepts', () => {
    for (const ok of ['abc', 'rishab', 'a_b_c', 'user_123', 'abcdefghijklmno']) expect(isValidHandle(ok)).toBe(true);
    for (const bad of ['', 'ab', 'abcdefghijklmnop', 'Rishab', 'a b', 'a-b', 'a.b', 'rishäb', 'ri​shab']) {
      expect(isValidHandle(bad)).toBe(false);
    }
  });

  it('normalises what people type', () => {
    expect(normalizeHandle('  @Rishab ')).toBe('rishab');
  });

  it('prices deposits from the program constants', () => {
    expect(handleDeposit('abc')).toBe(DEPOSIT_3_CHAR);
    expect(handleDeposit('abcd')).toBe(DEPOSIT_4_CHAR);
    expect(handleDeposit('abcde')).toBe(DEPOSIT_DEFAULT);
    expect(handleDeposit('abcdefghijklmno')).toBe(DEPOSIT_DEFAULT);
  });
});

describe('signature bytes', () => {
  it('round-trips a signature', () => {
    const sig = fakeSig(9);
    expect(bytesToSignature(signatureToBytes(sig))).toBe(sig);
    expect(signatureToBytes(sig)).toHaveLength(64);
  });

  it('rejects anything that is not a 64-byte signature', () => {
    expect(() => signatureToBytes('abc')).toThrow();
    expect(() => signatureToBytes('')).toThrow();
  });
});

describe('addresses', () => {
  it('derives stable, distinct PDAs', async () => {
    const wallet = await generateKeyPairSigner();
    const delegate = await generateKeyPairSigner();
    const p = await profileAddress(wallet.address);
    expect(await profileAddress(wallet.address)).toBe(p);
    expect(await handleAddress('rishab')).not.toBe(await handleAddress('rishab2'));
    expect(await sessionAddress(p, delegate.address)).not.toBe(p);
  });
});

describe('decodeInstruction', () => {
  it('round-trips every instruction builder', async () => {
    const w = await generateKeyPairSigner();
    const w2 = await generateKeyPairSigner();
    const d = await generateKeyPairSigner();
    const p = await profileAddress(w.address);
    const p2 = await profileAddress(w2.address);
    const h = await handleAddress('rishab');
    const s = await sessionAddress(p, d.address);
    const a = fakeSig(1);
    const b = fakeSig(2);

    const cases: [{ data: unknown; accounts: readonly { address: string }[] }, Record<string, unknown>][] = [
      [ix.createProfile({ authority: w, profile: p }), { kind: 'create_profile', authority: w.address, profile: p }],
      [ix.claimHandle({ authority: w, profile: p, handleAccount: h, handle: 'rishab' }), { kind: 'claim_handle', authority: w.address, profile: p, handleAccount: h, handle: 'rishab' }],
      [ix.releaseHandle({ authority: w, profile: p, handleAccount: h }), { kind: 'release_handle', authority: w.address, profile: p, handleAccount: h }],
      [ix.transferHandle({ fromAuthority: w, toAuthority: w2, fromProfile: p, toProfile: p2, handleAccount: h }), { kind: 'transfer_handle', fromProfile: p, toProfile: p2, handleAccount: h }],
      [ix.rotateAuthority({ authority: w, newAuthority: w2, profile: p }), { kind: 'rotate_authority', authority: w.address, newAuthority: w2.address, profile: p }],
      [ix.closeProfile({ authority: w, profile: p }), { kind: 'close_profile', authority: w.address, profile: p }],
      [ix.createSession({ authority: w, profile: p, delegate: d.address, session: s, expiresAt: 1800000000n, fuel: 5n }), { kind: 'create_session', authority: w.address, profile: p, delegate: d.address, session: s, expiresAt: 1800000000, fuel: 5 }],
      [ix.extendSession({ authority: w, profile: p, delegate: d.address, session: s, expiresAt: 1800000001n, fuel: 0n }), { kind: 'extend_session', profile: p, delegate: d.address, session: s, expiresAt: 1800000001, fuel: 0 }],
      [ix.closeSession({ signer: w, session: s, rentPayer: w.address }), { kind: 'close_session', signer: w.address, session: s, rentPayer: w.address }],
      [ix.revokeAllSessions({ authority: w, profile: p }), { kind: 'revoke_all_sessions', authority: w.address, profile: p }],
      [ix.post({ signer: d, profile: p, session: s, text: 'hello नमस्ते' }), { kind: 'post', signer: d.address, profile: p, session: s, text: 'hello नमस्ते', replyTo: null, quoteOf: null }],
      [ix.post({ signer: w, profile: p, text: 'r', replyTo: a, quoteOf: b }), { kind: 'post', signer: w.address, profile: p, session: null, text: 'r', replyTo: a, quoteOf: b }],
      [ix.deletePost({ signer: d, profile: p, session: s, post: a }), { kind: 'delete_post', profile: p, post: a }],
      [ix.like({ signer: d, profile: p, session: s, post: a }), { kind: 'like', profile: p, post: a }],
      [ix.unlike({ signer: d, profile: p, session: s, post: a }), { kind: 'unlike', profile: p, post: a }],
      [ix.repost({ signer: d, profile: p, session: s, post: a }), { kind: 'repost', profile: p, post: a }],
      [ix.unrepost({ signer: d, profile: p, session: s, post: a }), { kind: 'unrepost', profile: p, post: a }],
      [ix.follow({ signer: d, profile: p, session: s, target: p2 }), { kind: 'follow', profile: p, target: p2 }],
      [ix.unfollow({ signer: d, profile: p, session: s, target: p2 }), { kind: 'unfollow', profile: p, target: p2 }],
      [ix.setProfile({ signer: d, profile: p, session: s, name: 'R', bio: 'b', website: 'w', location: 'l', avatarSeed: 3, accent: 1 }), { kind: 'set_profile', profile: p, name: 'R', bio: 'b', website: 'w', location: 'l', avatarSeed: 3, accent: 1 }],
      [ix.pin({ signer: d, profile: p, session: s, post: a }), { kind: 'pin', profile: p, post: a }],
      [ix.pin({ signer: d, profile: p, session: s }), { kind: 'pin', profile: p, post: null }],
    ];

    for (const [built, expected] of cases) {
      const decoded = decodeInstruction({
        data: built.data as Uint8Array,
        accounts: built.accounts.map((m) => m.address),
      });
      expect(decoded).toMatchObject(expected);
    }
  });

  it('returns null for unknown discriminators, truncated and malformed data, and missing accounts, and ignores trailing bytes', async () => {
    const w = await generateKeyPairSigner();
    const p = await profileAddress(w.address);
    const good = ix.post({ signer: w, profile: p, text: 'hi' });
    const accounts = good.accounts.map((m) => m.address);
    const data = good.data as Uint8Array;

    expect(decodeInstruction({ data: new Uint8Array([200]), accounts })).toBeNull();
    expect(decodeInstruction({ data: new Uint8Array(), accounts })).toBeNull();
    expect(decodeInstruction({ data: data.slice(0, 3), accounts })).toBeNull();
    expect(decodeInstruction({ data, accounts: accounts.slice(0, 1) })).toBeNull();

    const badUtf8 = data.slice();
    badUtf8[5] = 0xff;
    badUtf8[6] = 0xfe;
    expect(decodeInstruction({ data: badUtf8, accounts })).toBeNull();

    // Trailing bytes are ignored, because the program ignores them too.
    const trailing = new Uint8Array([...data, 1, 2, 3]);
    expect(decodeInstruction({ data: trailing, accounts })).toMatchObject({ kind: 'post', text: 'hi' });
  });

  it('treats the program address in the session slot as no session', async () => {
    const w = await generateKeyPairSigner();
    const p = await profileAddress(w.address);
    const built = ix.like({ signer: w, profile: p, post: fakeSig(1) });
    expect(built.accounts[2]?.address).toBe(UPROAR_PROGRAM_ADDRESS);
    const decoded = decodeInstruction({ data: built.data as Uint8Array, accounts: built.accounts.map((m) => m.address) });
    expect(decoded).toMatchObject({ kind: 'like', session: null });
  });

  it('has a system-program-free social account list', async () => {
    const w = await generateKeyPairSigner();
    const p = await profileAddress(w.address);
    const built = ix.like({ signer: w, profile: p, post: fakeSig(1) });
    expect(built.accounts.map((m) => m.address)).not.toContain(SYSTEM);
  });
});

describe('socialTransactionSize', () => {
  it('fits the heaviest 280-weighted reply in one transaction', async () => {
    const d = await generateKeyPairSigner();
    const p = await profileAddress(d.address);
    const s = await sessionAddress(p, d.address);
    const hindi = 'न'.repeat(280);
    const size = await socialTransactionSize(ix.post({ signer: d, profile: p, session: s, text: hindi, replyTo: fakeSig(1) }), d);
    expect(size).toBeLessThanOrEqual(1232);
  });

  it('detects a reply-plus-quote that is too large for one transaction', async () => {
    const d = await generateKeyPairSigner();
    const p = await profileAddress(d.address);
    const s = await sessionAddress(p, d.address);
    const hindi = 'न'.repeat(280);
    const size = await socialTransactionSize(
      ix.post({ signer: d, profile: p, session: s, text: hindi, replyTo: fakeSig(1), quoteOf: fakeSig(2) }),
      d,
    );
    expect(size).toBeGreaterThan(1232);
  });
});
