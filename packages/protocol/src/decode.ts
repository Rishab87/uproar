/**
 * The canonical decoder. Turns one top-level instruction of a successful transaction into a typed
 * event. It never throws: anything malformed is null, because an indexer must survive any bytes
 * that a program accepted or that an upgrade might add later.
 */
import type { ReadonlyUint8Array } from '@solana/kit';
import * as g from './generated';
import { UPROAR_PROGRAM_ADDRESS, bytesToSignature } from './rules';

export type UproarEvent =
  | { kind: 'create_profile'; authority: string; profile: string }
  | { kind: 'claim_handle'; authority: string; profile: string; handleAccount: string; handle: string }
  | { kind: 'release_handle'; authority: string; profile: string; handleAccount: string }
  | { kind: 'transfer_handle'; fromAuthority: string; toAuthority: string; fromProfile: string; toProfile: string; handleAccount: string }
  | { kind: 'rotate_authority'; authority: string; newAuthority: string; profile: string }
  | { kind: 'close_profile'; authority: string; profile: string }
  | { kind: 'create_session'; authority: string; profile: string; delegate: string; session: string; expiresAt: number; fuel: number }
  | { kind: 'extend_session'; authority: string; profile: string; delegate: string; session: string; expiresAt: number; fuel: number }
  | { kind: 'close_session'; signer: string; session: string; rentPayer: string }
  | { kind: 'revoke_all_sessions'; authority: string; profile: string }
  | { kind: 'post'; signer: string; profile: string; session: string | null; text: string; replyTo: string | null; quoteOf: string | null }
  | { kind: 'delete_post'; signer: string; profile: string; session: string | null; post: string }
  | { kind: 'like'; signer: string; profile: string; session: string | null; post: string }
  | { kind: 'unlike'; signer: string; profile: string; session: string | null; post: string }
  | { kind: 'repost'; signer: string; profile: string; session: string | null; post: string }
  | { kind: 'unrepost'; signer: string; profile: string; session: string | null; post: string }
  | { kind: 'follow'; signer: string; profile: string; session: string | null; target: string }
  | { kind: 'unfollow'; signer: string; profile: string; session: string | null; target: string }
  | { kind: 'set_profile'; signer: string; profile: string; session: string | null; name: string; bio: string; website: string; location: string; avatarSeed: number; accent: number }
  | { kind: 'pin'; signer: string; profile: string; session: string | null; post: string | null };

export type EventKind = UproarEvent['kind'];

export type RawInstruction = { data: Uint8Array; accounts: readonly string[] };

const sig = (b: ReadonlyUint8Array) => bytesToSignature(b as Uint8Array);
const optSig = (o: { __option: 'Some'; value: ReadonlyUint8Array } | { __option: 'None' }) =>
  o.__option === 'Some' ? sig(o.value) : null;

/**
 * Decodes the arguments from the start of the data. Bytes after them are ignored, exactly as the
 * program ignores them, so every indexer and explorer reads the same post from the same bytes.
 */
function exact<T>(decoder: { read(bytes: ReadonlyUint8Array, offset: number): [T, number] }, data: Uint8Array): T {
  return decoder.read(data, 0)[0];
}

function need(accounts: readonly string[], count: number) {
  if (accounts.length < count) throw new Error('missing accounts');
}

function socialBase(accounts: readonly string[]) {
  need(accounts, 3);
  const session = accounts[2] as string;
  return {
    signer: accounts[0] as string,
    profile: accounts[1] as string,
    session: session === UPROAR_PROGRAM_ADDRESS ? null : session,
  };
}

function decode(data: Uint8Array, a: readonly string[]): UproarEvent | null {
  switch (data[0]) {
    case 1:
      exact(g.getCreateProfileInstructionDataDecoder(), data);
      need(a, 2);
      return { kind: 'create_profile', authority: a[0]!, profile: a[1]! };
    case 2: {
      const d = exact(g.getClaimHandleInstructionDataDecoder(), data);
      need(a, 3);
      return { kind: 'claim_handle', authority: a[0]!, profile: a[1]!, handleAccount: a[2]!, handle: d.handle };
    }
    case 3:
      exact(g.getReleaseHandleInstructionDataDecoder(), data);
      need(a, 3);
      return { kind: 'release_handle', authority: a[0]!, profile: a[1]!, handleAccount: a[2]! };
    case 4:
      exact(g.getTransferHandleInstructionDataDecoder(), data);
      need(a, 5);
      return { kind: 'transfer_handle', fromAuthority: a[0]!, toAuthority: a[1]!, fromProfile: a[2]!, toProfile: a[3]!, handleAccount: a[4]! };
    case 5:
      exact(g.getRotateAuthorityInstructionDataDecoder(), data);
      need(a, 3);
      return { kind: 'rotate_authority', authority: a[0]!, newAuthority: a[1]!, profile: a[2]! };
    case 6:
      exact(g.getCloseProfileInstructionDataDecoder(), data);
      need(a, 2);
      return { kind: 'close_profile', authority: a[0]!, profile: a[1]! };
    case 10: {
      const d = exact(g.getCreateSessionInstructionDataDecoder(), data);
      need(a, 4);
      return { kind: 'create_session', authority: a[0]!, profile: a[1]!, delegate: a[2]!, session: a[3]!, expiresAt: Number(d.expiresAt), fuel: Number(d.fuel) };
    }
    case 11: {
      const d = exact(g.getExtendSessionInstructionDataDecoder(), data);
      need(a, 4);
      return { kind: 'extend_session', authority: a[0]!, profile: a[1]!, delegate: a[2]!, session: a[3]!, expiresAt: Number(d.expiresAt), fuel: Number(d.fuel) };
    }
    case 12:
      exact(g.getCloseSessionInstructionDataDecoder(), data);
      need(a, 3);
      return { kind: 'close_session', signer: a[0]!, session: a[1]!, rentPayer: a[2]! };
    case 13:
      exact(g.getRevokeAllSessionsInstructionDataDecoder(), data);
      need(a, 2);
      return { kind: 'revoke_all_sessions', authority: a[0]!, profile: a[1]! };
    case 20: {
      const d = exact(g.getPostInstructionDataDecoder(), data);
      return { kind: 'post', ...socialBase(a), text: d.text, replyTo: optSig(d.replyTo), quoteOf: optSig(d.quoteOf) };
    }
    case 21:
      return { kind: 'delete_post', ...socialBase(a), post: sig(exact(g.getDeletePostInstructionDataDecoder(), data).post) };
    case 22:
      return { kind: 'like', ...socialBase(a), post: sig(exact(g.getLikeInstructionDataDecoder(), data).post) };
    case 23:
      return { kind: 'unlike', ...socialBase(a), post: sig(exact(g.getUnlikeInstructionDataDecoder(), data).post) };
    case 24:
      return { kind: 'repost', ...socialBase(a), post: sig(exact(g.getRepostInstructionDataDecoder(), data).post) };
    case 25:
      return { kind: 'unrepost', ...socialBase(a), post: sig(exact(g.getUnrepostInstructionDataDecoder(), data).post) };
    case 26:
      return { kind: 'follow', ...socialBase(a), target: exact(g.getFollowInstructionDataDecoder(), data).target };
    case 27:
      return { kind: 'unfollow', ...socialBase(a), target: exact(g.getUnfollowInstructionDataDecoder(), data).target };
    case 28: {
      const d = exact(g.getSetProfileInstructionDataDecoder(), data);
      return { kind: 'set_profile', ...socialBase(a), name: d.name, bio: d.bio, website: d.website, location: d.location, avatarSeed: d.avatarSeed, accent: d.accent };
    }
    case 29:
      return { kind: 'pin', ...socialBase(a), post: optSig(exact(g.getPinInstructionDataDecoder(), data).post) };
    default:
      return null;
  }
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** Kit's UTF-8 decoder replaces bad bytes, but the chain rejects them, so strict decoding must too. */
function hasValidStrings(event: UproarEvent, data: Uint8Array): boolean {
  if (event.kind !== 'post' && event.kind !== 'claim_handle' && event.kind !== 'set_profile') return true;
  // Each string is length-prefixed. Walk them in declaration order and check the raw bytes.
  const count = event.kind === 'set_profile' ? 4 : 1;
  let offset = 1;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(offset, true);
    offset += 4;
    strictUtf8.decode(data.subarray(offset, offset + len));
    offset += len;
  }
  return true;
}

export function decodeInstruction(raw: RawInstruction): UproarEvent | null {
  if (raw.data.length === 0) return null;
  try {
    const event = decode(raw.data, raw.accounts);
    if (event && !hasValidStrings(event, raw.data)) return null;
    return event;
  } catch {
    return null;
  }
}
