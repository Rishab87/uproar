import { transparency } from '@uproar/safety';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { getSql } from '@/lib/server/db';

export const metadata: Metadata = { title: 'Transparency', description: 'Every moderation action taken on the UPROAR app, and every legal order received.' };

const ACTION: Record<string, string> = { hide: 'Hidden', unhide: 'Restored', withhold: 'Withheld', unwithhold: 'Withholding lifted', label: 'Labelled', unlabel: 'Label removed' };

export default async function TransparencyPage() {
  const t = await transparency(getSql());
  const empty = t.counts.length === 0 && t.actions.length === 0 && t.orders.length === 0;
  return (
    <>
      <LegalHead title="Transparency" />
      <article className="page" style={{ maxWidth: 'none' }}>
        <p className="lede">What this app has hidden, restored or withheld, and why. Reporter details and complaint text are never published, and neither are links to child safety or intimate content.</p>
        {empty ? <p style={{ marginTop: 16 }}>Nothing yet. Every action will appear here as it happens.</p> : null}

        {t.counts.length ? (
          <>
            <h2>Reports by reason</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Reason</th><th className="num">Received</th><th className="num">Hidden</th><th className="num">Withheld</th><th className="num">Restored</th><th className="num">No action</th><th className="num">Open</th></tr></thead>
                <tbody>
                  {t.counts.map((c) => (
                    <tr key={c.category}><td>{c.label}</td><td className="num">{c.total}</td><td className="num">{c.removed}</td><td className="num">{c.withheld}</td><td className="num">{c.restored}</td><td className="num">{c.noAction}</td><td className="num">{c.open}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <h2>Legal requests</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>Data requests received</td><td className="num">{t.dataRequests.received}</td></tr>
              <tr><td>Data requests answered</td><td className="num">{t.dataRequests.responded}</td></tr>
              <tr><td>Data requests refused</td><td className="num">{t.dataRequests.rejected}</td></tr>
              <tr><td>Orders we were told not to publish</td><td className="num">{t.ordersWithheldFromPublication}</td></tr>
              <tr><td>Appeals received</td><td className="num">{t.appeals.received}</td></tr>
              <tr><td>Appeals that overturned a decision</td><td className="num">{t.appeals.overturned}</td></tr>
            </tbody>
          </table>
        </div>

        {t.orders.length ? (
          <>
            <h2>Orders</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Received</th><th>From</th><th>Reference</th><th>Scope</th><th>Outcome</th><th className="num">Items</th></tr></thead>
                <tbody>
                  {t.orders.map((o) => (
                    <tr key={`${o.reference}${o.receivedAt.toISOString()}`}><td>{o.receivedAt.toISOString().slice(0, 10)}</td><td>{o.authority}</td><td>{o.reference}</td><td>{o.countries.length ? o.countries.join(', ') : 'Worldwide'}</td><td>{o.status}</td><td className="num">{o.targets.length}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {t.actions.length ? (
          <>
            <h2>Recent actions</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Action</th><th>Reason</th><th>Basis</th><th>Scope</th><th>Item</th></tr></thead>
                <tbody>
                  {t.actions.map((a, i) => (
                    <tr key={i}>
                      <td>{a.at.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                      <td>{ACTION[a.action] ?? a.action}</td>
                      <td>{a.reasonCode.replaceAll('_', ' ')}</td>
                      <td>{a.legalBasis ?? ''}</td>
                      <td>{a.countries.length ? a.countries.join(', ') : a.action.includes('withhold') ? '' : 'This app'}</td>
                      <td>{a.target ? (a.targetType === 'post' ? <Link prefetch={false} href={`/post/${a.target}`}>{a.target.slice(0, 10)}</Link> : a.target.slice(0, 10)) : 'Not published'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </article>
    </>
  );
}
