/**
 * A real Wallet Standard wallet for tests. It holds an Ed25519 key, signs real transactions and
 * sends them to the chain. Only the human approval step is automatic, and it counts each approval.
 * It's injected by Playwright and is never part of the app bundle.
 */
(({ pkcs8, publicKey, address, chains, name, autoConnect }) => {
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (b) => btoa(String.fromCharCode(...b));
  const FEATURES = ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage'];
  const account = { address, publicKey: fromB64(publicKey), chains, features: FEATURES, label: 'Test' };
  const listeners = new Set();
  let accounts = [];
  let key = null;
  const state = (window.__mockWallet = { approvals: 0, messages: 0, rejectNext: false, address });

  const signingKey = async () => {
    key ??= await crypto.subtle.importKey('pkcs8', fromB64(pkcs8), 'Ed25519', false, ['sign']);
    return key;
  };
  const sign = async (bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', await signingKey(), bytes));

  const shortvec = (bytes, offset) => {
    let value = 0;
    let shift = 0;
    let size = 0;
    for (;;) {
      const b = bytes[offset + size];
      value |= (b & 0x7f) << shift;
      size += 1;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return { value, size };
  };

  const approve = () => {
    state.approvals += 1;
    if (state.rejectNext) {
      state.rejectNext = false;
      throw new Error('User rejected the request');
    }
  };

  const signWire = async (transaction) => {
    const out = new Uint8Array(transaction);
    const { value: count, size } = shortvec(out, 0);
    const messageStart = size + count * 64;
    const message = out.subarray(messageStart);
    // Skip the version byte if there is one, then the 3-byte header, to reach the account list.
    const first = message[0];
    const headerAt = first & 0x80 ? 1 : 0;
    const keysAt = headerAt + 3;
    const { value: keyCount, size: keySize } = shortvec(message, keysAt);
    const mine = fromB64(publicKey);
    let index = -1;
    for (let i = 0; i < keyCount; i++) {
      const candidate = message.subarray(keysAt + keySize + i * 32, keysAt + keySize + (i + 1) * 32);
      if (candidate.every((b, j) => b === mine[j])) {
        index = i;
        break;
      }
    }
    if (index < 0 || index >= count) throw new Error('This wallet is not a required signer');
    const signature = await sign(message);
    out.set(signature, size + index * 64);
    return { signed: out, signature };
  };

  const rpc = async (method, params) => {
    const res = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };

  const emit = () => listeners.forEach((l) => l({ accounts }));

  // Real wallets keep resending until the network confirms. The same bytes can only ever land once.
  const keepSending = (wire, signature) => {
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const status = (await rpc('getSignatureStatuses', [[signature]])).value[0];
        const settled = status && (status.err || status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized');
        if (settled || tries > 20) return clearInterval(timer);
        await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: true }]);
      } catch {}
    }, 2000);
  };

  // Opaque frames (about:blank, data:) can't use storage. A real wallet doesn't care, so neither does this.
  const store = {
    get: () => { try { return sessionStorage.getItem('mock.connected'); } catch { return null; } },
    set: (v) => { try { sessionStorage.setItem('mock.connected', v); } catch {} },
    clear: () => { try { sessionStorage.removeItem('mock.connected'); } catch {} },
  };

  const wallet = {
    version: '1.0.0',
    name,
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMmRmMGZmIi8+PC9zdmc+',
    chains,
    // Like real extensions, a fresh copy of each account on every read. The app must not depend on
    // the objects staying the same: once, that re-rendered forever and froze the page.
    get accounts() {
      return accounts.map((a) => ({ ...a }));
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async ({ silent } = {}) => {
          if (silent && !state.connectedBefore && !autoConnect) return { accounts };
          state.connectedBefore = true;
          store.set('1');
          accounts = [account];
          emit();
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          accounts = [];
          store.clear();
          emit();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event, listener) => {
          if (event !== 'change') return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            approve();
            const { signed, signature } = await signWire(input.transaction);
            const wire = toB64(signed);
            keepSending(wire, await rpc('sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]));
            results.push({ signature });
          }
          return results;
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            approve();
            const { signed } = await signWire(input.transaction);
            results.push({ signedTransaction: signed });
          }
          return results;
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            state.messages += 1;
            approve();
            results.push({ signedMessage: input.message, signature: await sign(input.message) });
          }
          return results;
        },
      },
    },
  };

  state.connectedBefore = store.get() === '1';

  const register = ({ register: r }) => r(wallet);
  window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
})(__MOCK_WALLET_CONFIG__);
