import { getProgramDerivedAddress, getAddressEncoder, getBase58Decoder, getBase58Encoder, getUtf8Encoder, type Address } from '@solana/kit';
import { DEPOSIT_3_CHAR, DEPOSIT_4_CHAR, DEPOSIT_DEFAULT, MAX_HANDLE_LEN, MIN_HANDLE_LEN } from './constants.generated';
import { UPROAR_PROGRAM_ADDRESS } from './generated';

export { UPROAR_PROGRAM_ADDRESS };

const HANDLE_RE = /^[a-z0-9_]+$/;

export function isValidHandle(handle: string): boolean {
  return handle.length >= MIN_HANDLE_LEN && handle.length <= MAX_HANDLE_LEN && HANDLE_RE.test(handle);
}

/** What someone typed into what the chain stores: no @, no surrounding space, lowercase. */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** The refundable deposit for a handle, read from the program's own constants. */
export function handleDeposit(handle: string): bigint {
  if (handle.length === 3) return DEPOSIT_3_CHAR;
  if (handle.length === 4) return DEPOSIT_4_CHAR;
  return DEPOSIT_DEFAULT;
}

const addressEncoder = getAddressEncoder();
const utf8 = getUtf8Encoder();

async function pda(seeds: (string | Address)[], program: Address): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: seeds.map((s, i) => (i === 0 || !isAddressSeed(s) ? utf8.encode(s) : addressEncoder.encode(s as Address))),
  });
  return address;
}

// Handles are at most 15 characters; addresses are at least 32. No ambiguity between the two.
function isAddressSeed(seed: string): boolean {
  return seed.length >= 32;
}

export function profileAddress(creator: Address, program: Address = UPROAR_PROGRAM_ADDRESS): Promise<Address> {
  return pda(['profile', creator], program);
}

export function handleAddress(handle: string, program: Address = UPROAR_PROGRAM_ADDRESS): Promise<Address> {
  return pda(['handle', handle], program);
}

export function sessionAddress(profile: Address, delegate: Address, program: Address = UPROAR_PROGRAM_ADDRESS): Promise<Address> {
  return pda(['session', profile, delegate], program);
}

const base58ToBytes = getBase58Encoder();
const bytesToBase58 = getBase58Decoder();

export function signatureToBytes(signature: string): Uint8Array {
  const bytes = base58ToBytes.encode(signature);
  if (bytes.length !== 64) throw new Error('A signature must decode to 64 bytes');
  return bytes as Uint8Array;
}

export function bytesToSignature(bytes: Uint8Array | ArrayLike<number>): string {
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as ArrayLike<number>);
  if (array.length !== 64) throw new Error('A signature must be 64 bytes');
  return bytesToBase58.decode(array);
}
