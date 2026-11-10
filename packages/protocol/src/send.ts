/** Sending and confirming, shared by the browser client and the command-line tools. */
import type { Base64EncodedWireTransaction, Rpc, GetSignatureStatusesApi, SendTransactionApi, Signature } from '@solana/kit';

type SendRpc = Rpc<SendTransactionApi & GetSignatureStatusesApi>;

export class TransactionFailed extends Error {
  constructor(readonly signature: string, readonly detail: unknown) {
    super(`Transaction ${signature} failed: ${JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  }
}

export class TransactionTimedOut extends Error {
  constructor(readonly signature: string) {
    super(`Transaction ${signature} was not confirmed in time`);
  }
}

export async function waitForConfirmation(
  rpc: Rpc<GetSignatureStatusesApi>,
  signature: Signature,
  { timeoutMs = 60_000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status) {
      if (status.err) throw new TransactionFailed(signature, status.err);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new TransactionTimedOut(signature);
}

export async function sendWireTransaction(
  rpc: SendRpc,
  wire: Base64EncodedWireTransaction,
  { skipPreflight = false }: { skipPreflight?: boolean } = {},
): Promise<Signature> {
  return rpc
    .sendTransaction(wire, { encoding: 'base64', skipPreflight, preflightCommitment: 'confirmed', maxRetries: 3n })
    .send();
}
