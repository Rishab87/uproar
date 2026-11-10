import type { Metadata } from 'next';
import { LegalHead } from '@/components/LegalHead';
import { DataRequestForm, OrderForm } from '@/components/LegalForms';
import { OPERATOR, POLICY_DATE } from '@/lib/operator';

export const metadata: Metadata = { title: 'Law enforcement', description: 'How courts and authorised agencies can send orders and data requests to the UPROAR app.' };

export default function LawEnforcementPage() {
  return (
    <>
      <LegalHead title="Law enforcement" subtitle={`Last updated ${POLICY_DATE}`} />
      <article className="page">
        <p className="lede">For courts and authorised government agencies. Anyone else should use the report form.</p>

        <h2>What we can do</h2>
        <ul className="list">
          <li>Disable access to a post or account in this app, its search and its share cards, worldwide or for specific countries, within 3 hours of an order from a court or an authorised officer.</li>
          <li>Provide the limited data we hold, within 72 hours of a lawful written order.</li>
        </ul>

        <h2>What we can&apos;t do</h2>
        <p>We can&apos;t remove anything from the Solana blockchain, stop it from being recorded, or change it. Nobody can. We don&apos;t control the program&apos;s data, other apps, or the validators that run the network.</p>

        <h2>What we hold</h2>
        <ul className="list">
          <li>Public chain data, which anyone can also read: wallet addresses, profiles, posts and social actions.</li>
          <li>Access logs for write and safety requests, for 180 days: time, route, IP address, browser and country, with the profile if signed in. We don&apos;t log ordinary page views.</li>
          <li>Details people gave when filing reports and appeals.</li>
          <li>Private preferences: bookmarks, mutes, blocks and muted words.</li>
        </ul>
        <p>We don&apos;t hold names, phone numbers, emails or payment details of ordinary users, and we never hold their keys. There are no direct messages.</p>

        <h2>Send an order to disable content</h2>
        <p>Orders are verified before we act. Content is disabled only as far as the order requires.</p>
        <OrderForm />

        <h2>Request data</h2>
        <DataRequestForm />

        <h2>Other contact</h2>
        <p>Officers can also write to {OPERATOR.name} at <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. The forms above start the legal clock straight away and raise an alarm, so they are faster.</p>
      </article>
    </>
  );
}
