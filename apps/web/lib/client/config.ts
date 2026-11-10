export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'localnet';

const CHAINS: Record<string, `solana:${string}`> = {
  'mainnet-beta': 'solana:mainnet',
  devnet: 'solana:devnet',
  localnet: 'solana:localnet',
};
export const CHAIN = CHAINS[CLUSTER] ?? 'solana:localnet';
export const IS_MAINNET = CLUSTER === 'mainnet-beta';

export const SESSION_DAYS = 30;
/** Fees paid by a session key, as a count of actions. The rent-exempt reserve comes from the chain. */
export const SESSION_FUEL_ACTIONS = 200n;
export const LAMPORTS_PER_ACTION = 5_000n;

export function explorerUrl(signature: string): string {
  const cluster = IS_MAINNET ? '' : `?cluster=${CLUSTER === 'localnet' ? `custom&customUrl=${encodeURIComponent('http://127.0.0.1:8899')}` : CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

export function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac.slice(0, 5)}` : `${whole}`;
}
