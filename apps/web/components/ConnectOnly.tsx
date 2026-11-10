'use client';
import { useEffect, useState } from 'react';
import { CLUSTER, IS_MAINNET } from '@/lib/client/config';
import { ConnectWalletRow, useViewer } from '@/lib/client/viewer';
import { Modal } from './Modal';
import { Toasts } from './Toasts';

/** The connect dialog and toasts, for pages that sit outside the main app shell. */
export function ConnectOnly() {
  const v = useViewer();
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  useEffect(() => {
    if (v.connectOpen && /iPhone|iPad|Android/i.test(navigator.userAgent)) setPhoneUrl(window.location.href);
  }, [v.connectOpen]);
  return (
    <>
      {v.connectOpen ? (
        <Modal title="Connect a wallet" onClose={v.closeConnect}>
          {v.wallets.length ? (
            <div className="wallet-list">
              {v.wallets.map((w) => <ConnectWalletRow key={w.name} wallet={w} onConnected={() => v.selectWallet(w.name)} />)}
            </div>
          ) : phoneUrl ? (
            <div className="stack">
              <p>On a phone, open this page inside your wallet app.</p>
              <a className="btn btn-loud btn-block" href={`https://phantom.app/ul/browse/${encodeURIComponent(phoneUrl)}?ref=${encodeURIComponent(new URL(phoneUrl).origin)}`}>Open in Phantom</a>
              <a className="btn btn-block" href={`https://solflare.com/ul/v1/browse/${encodeURIComponent(phoneUrl)}?ref=${encodeURIComponent(new URL(phoneUrl).origin)}`}>Open in Solflare</a>
            </div>
          ) : (
            <div className="stack">
              <p>No Solana wallet found in this browser.</p>
              <ul className="plain-links">
                <li><a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Get Phantom</a></li>
                <li><a href="https://solflare.com/download" target="_blank" rel="noopener noreferrer">Get Solflare</a></li>
                <li><a href="https://backpack.app/download" target="_blank" rel="noopener noreferrer">Get Backpack</a></li>
              </ul>
            </div>
          )}
          <p className="dim small">Connecting shares your public address. It can&apos;t move your funds.</p>
          {!IS_MAINNET ? <p className="dim small">This beta runs on Solana {CLUSTER}. Set your wallet to devnet first: in Phantom, Settings, Developer Settings, Testnet Mode.</p> : null}
        </Modal>
      ) : null}
      <Toasts />
    </>
  );
}
