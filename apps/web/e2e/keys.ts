import { createPrivateKey, createPublicKey } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export type TestKey = { pkcs8: string; publicKey: string; address: string };

/** A deterministic Ed25519 wallet, so the operator's address is known before the server starts. */
export function keyFromSeed(seedHex: string): TestKey {
  const seed = Buffer.from(seedHex.padEnd(64, '0').slice(0, 64), 'hex');
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { pkcs8: der.toString('base64'), publicKey: raw.toString('base64'), address: getBase58Decoder().decode(raw) };
}

export const OPERATOR_KEY = keyFromSeed('a1'.repeat(32));

/** The app's test-SOL tap in end-to-end runs. Global setup funds it. */
export const FAUCET_KEY = keyFromSeed('fa'.repeat(32));

/** A key's 64 secret bytes (seed, then public key) as JSON, the Solana CLI keypair format FAUCET_SECRET takes. */
export const secretJson = (key: TestKey) => JSON.stringify([...Buffer.from(key.pkcs8, 'base64').subarray(PKCS8_PREFIX.length), ...Buffer.from(key.publicKey, 'base64')]);
