/**
 * Instruction builders with one simple shape: post IDs are base58 signature strings, and the
 * optional session slot is simply left out when the owner wallet signs.
 */
import type { Address, TransactionSigner } from '@solana/kit';
import * as g from './generated';
import { signatureToBytes } from './rules';

type Social = { signer: TransactionSigner; profile: Address; session?: Address };
type OnPost = Social & { post: string };
type OnTarget = Social & { target: Address };

const social = ({ signer, profile, session }: Social) => ({ signer, profile, ...(session ? { session } : {}) });

export const ix = {
  createProfile: ({ authority, profile }: { authority: TransactionSigner; profile: Address }) =>
    g.getCreateProfileInstruction({ authority, profile }),

  claimHandle: (a: { authority: TransactionSigner; profile: Address; handleAccount: Address; handle: string }) =>
    g.getClaimHandleInstruction(a),

  releaseHandle: (a: { authority: TransactionSigner; profile: Address; handleAccount: Address }) =>
    g.getReleaseHandleInstruction(a),

  transferHandle: (a: {
    fromAuthority: TransactionSigner;
    toAuthority: TransactionSigner;
    fromProfile: Address;
    toProfile: Address;
    handleAccount: Address;
  }) => g.getTransferHandleInstruction(a),

  rotateAuthority: (a: { authority: TransactionSigner; newAuthority: TransactionSigner; profile: Address }) =>
    g.getRotateAuthorityInstruction(a),

  closeProfile: (a: { authority: TransactionSigner; profile: Address }) => g.getCloseProfileInstruction(a),

  createSession: (a: {
    authority: TransactionSigner;
    profile: Address;
    delegate: Address;
    session: Address;
    expiresAt: bigint;
    fuel: bigint;
  }) => g.getCreateSessionInstruction(a),

  extendSession: (a: {
    authority: TransactionSigner;
    profile: Address;
    delegate: Address;
    session: Address;
    expiresAt: bigint;
    fuel: bigint;
  }) => g.getExtendSessionInstruction(a),

  closeSession: (a: { signer: TransactionSigner; session: Address; rentPayer: Address }) => g.getCloseSessionInstruction(a),

  revokeAllSessions: (a: { authority: TransactionSigner; profile: Address }) => g.getRevokeAllSessionsInstruction(a),

  post: (a: Social & { text: string; replyTo?: string | null; quoteOf?: string | null }) =>
    g.getPostInstruction({
      ...social(a),
      text: a.text,
      replyTo: a.replyTo ? signatureToBytes(a.replyTo) : null,
      quoteOf: a.quoteOf ? signatureToBytes(a.quoteOf) : null,
    }),

  deletePost: (a: OnPost) => g.getDeletePostInstruction({ ...social(a), post: signatureToBytes(a.post) }),
  like: (a: OnPost) => g.getLikeInstruction({ ...social(a), post: signatureToBytes(a.post) }),
  unlike: (a: OnPost) => g.getUnlikeInstruction({ ...social(a), post: signatureToBytes(a.post) }),
  repost: (a: OnPost) => g.getRepostInstruction({ ...social(a), post: signatureToBytes(a.post) }),
  unrepost: (a: OnPost) => g.getUnrepostInstruction({ ...social(a), post: signatureToBytes(a.post) }),
  follow: (a: OnTarget) => g.getFollowInstruction({ ...social(a), target: a.target }),
  unfollow: (a: OnTarget) => g.getUnfollowInstruction({ ...social(a), target: a.target }),

  setProfile: (a: Social & { name: string; bio: string; website: string; location: string; avatarSeed: number; accent: number }) =>
    g.getSetProfileInstruction({
      ...social(a),
      name: a.name,
      bio: a.bio,
      website: a.website,
      location: a.location,
      avatarSeed: a.avatarSeed,
      accent: a.accent,
    }),

  pin: (a: Social & { post?: string | null }) =>
    g.getPinInstruction({ ...social(a), post: a.post ? signatureToBytes(a.post) : null }),
};
