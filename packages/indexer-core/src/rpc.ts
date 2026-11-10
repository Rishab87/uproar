import type { RpcTransaction } from './parse';

export type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
};

export type SignatureStatus = { slot: number; err: unknown; confirmationStatus?: string | null } | null;

export class RpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/** A plain JSON-RPC client that retries transient failures and fails over between endpoints. */
export class Rpc {
  private next = 0;

  constructor(
    private readonly urls: readonly string[],
    private readonly options: { retries?: number; timeoutMs?: number; fetch?: typeof fetch } = {},
  ) {
    if (urls.length === 0) throw new Error('At least one RPC URL is required');
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const retries = this.options.retries ?? 4;
    const doFetch = this.options.fetch ?? fetch;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const url = this.urls[(this.next + attempt) % this.urls.length] as string;
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 12_000),
        });
        if (RETRYABLE_HTTP.has(res.status)) throw new RpcError(`HTTP ${res.status} from RPC`);
        if (!res.ok) throw new RpcError(`HTTP ${res.status} from RPC`, res.status);
        const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
        if (body.error) {
          // -32005: node behind, -32004: block not available yet. Both pass.
          if (body.error.code === -32005 || body.error.code === -32004 || body.error.code === 429) throw new RpcError(body.error.message);
          throw new RpcError(body.error.message, body.error.code);
        }
        this.next = (this.next + attempt) % this.urls.length;
        return body.result as T;
      } catch (error) {
        lastError = error;
        if (error instanceof RpcError && error.code !== undefined) throw error;
        if (attempt < retries) await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** attempt, 2_000)));
      }
    }
    throw lastError instanceof Error ? lastError : new RpcError('RPC call failed');
  }

  getTransaction(signature: string, commitment: 'confirmed' | 'finalized' = 'confirmed'): Promise<RpcTransaction | null> {
    return this.call('getTransaction', [signature, { encoding: 'json', commitment, maxSupportedTransactionVersion: 0 }]);
  }

  getSignaturesForAddress(address: string, options: { before?: string; until?: string; limit?: number; commitment?: 'confirmed' | 'finalized' }): Promise<SignatureInfo[]> {
    return this.call('getSignaturesForAddress', [address, { commitment: 'confirmed', ...options }]);
  }

  async getSignatureStatuses(signatures: readonly string[]): Promise<SignatureStatus[]> {
    const res = await this.call<{ value: SignatureStatus[] }>('getSignatureStatuses', [signatures, { searchTransactionHistory: true }]);
    return res.value;
  }

  getSlot(commitment: 'confirmed' | 'finalized' = 'finalized'): Promise<number> {
    return this.call('getSlot', [{ commitment }]);
  }
}
