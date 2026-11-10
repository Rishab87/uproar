import { airdrop } from './helpers';
import { FAUCET_KEY } from './keys';

/** The local validator must already be running: scripts/dev-chain.sh */
const rpc = (method: string) =>
  fetch('http://127.0.0.1:8899', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  })
    .then((r) => r.json() as Promise<{ result?: unknown }>)
    .catch(() => null);

export default async function globalSetup() {
  const health = await rpc('getHealth');
  if (health?.result !== 'ok') throw new Error('Start the local validator first: scripts/dev-chain.sh');
  // A validator that has just started reports healthy at slot 0, before it makes blocks. Wait for blocks.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const slot = (await rpc('getSlot'))?.result;
    if (typeof slot === 'number' && slot >= 10) {
      // The app's test-SOL tap pays out of this wallet, as it does on devnet.
      await airdrop(FAUCET_KEY.address, 20);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('The local validator is not making blocks: see its log');
}
