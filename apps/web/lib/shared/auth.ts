/** The message a private API request signs. Shared by the browser and the server. */
export const AUTH_HEADER = 'x-uproar-auth';
export const AUTH_MAX_SKEW_SECONDS = 120;

export function authMessage(p: { host: string; method: string; path: string; profile: string; timestamp: number; bodyHash: string }): Uint8Array {
  return new TextEncoder().encode(['uproar-auth:v1', p.host, p.method.toUpperCase(), p.path, p.profile, String(p.timestamp), p.bodyHash].join('\n'));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const CONSENT_VERSION = '2026-11-09';
