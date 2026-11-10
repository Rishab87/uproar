import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { OPERATOR, POLICY_DATE } from '@/lib/operator';

export const metadata: Metadata = { title: 'Privacy', description: 'What the UPROAR app stores, why, and for how long.' };

export default function PrivacyPage() {
  return (
    <>
      <LegalHead title="Privacy" subtitle={`Last updated ${POLICY_DATE}`} />
      <article className="page">
        <p className="lede">We collect as little as this app can run on. No email or phone number is needed to use it. There are no ad trackers and no analytics cookies.</p>

        <h2>What is public by design</h2>
        <p>Everything you do on chain is public and permanent: your wallet address, profile, posts, likes, reposts and follows. We copy this into our database so the app can show it quickly. We can&apos;t delete it from the chain, and neither can you.</p>

        <h2>What we hold that is not on chain</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Why</th><th>Kept for</th></tr></thead>
            <tbody>
              <tr><td>Bookmarks, mutes, blocks, muted words, label choices</td><td>To run the features you asked for</td><td>Until you remove them</td></tr>
              <tr><td>Access logs for write and safety requests: time, route, IP address, browser, country, profile if signed in</td><td>Security, and the log-keeping that CERT-In directions require</td><td>180 days</td></tr>
              <tr><td>Reports: what you wrote, your name and email if you gave them, IP address, country</td><td>To handle your complaint and preserve records as the IT Rules require</td><td>Contact details and IP are erased 180 days after the report closes. The decision is kept</td></tr>
              <tr><td>Appeals, legal orders and data requests</td><td>Legal record-keeping</td><td>Contact details and IP are erased 180 days after closing, where the law allows. The decision is kept</td></tr>
              <tr><td>Your acceptance of the Terms</td><td>Proof of consent</td><td>As long as your profile exists</td></tr>
            </tbody>
          </table>
        </div>
        <p>Your browser stores your session key, your wallet choice and small preferences such as dismissed notices. They stay on your device. The operator console uses one strictly necessary cookie, only for the operator. Regular visitors get no cookies.</p>
        <p>Hosting providers process technical request data, including your IP address, to deliver the site. Their logs are kept under their own policies.</p>

        <h2>Who we share it with</h2>
        <ul className="list">
          <li><strong>Service providers</strong> that run the app: Vercel for hosting, Supabase for the database, and a Solana RPC provider for chain access. Alert messages to the operator carry a reference number, not the content of a complaint.</li>
          <li><strong>Authorities</strong>, when a lawful order requires it, or when the law requires us to report an offence. See <Link prefetch={false} href="/law-enforcement">law enforcement</Link>.</li>
          <li>We publish what we did in the <Link prefetch={false} href="/transparency">transparency log</Link>, without reporter details.</li>
        </ul>
        <p>We never sell data, and there is nothing to sell it for: this app has no ads.</p>

        <h2>Your choices and rights</h2>
        <p>Under the Digital Personal Data Protection Act, 2023 and other law, you can ask us for a copy of the off-chain data we hold about you, ask us to correct it, or ask us to erase it where we don&apos;t have to keep it. Write to the <Link prefetch={false} href="/grievance">Grievance Officer</Link>. We can&apos;t erase anything from the chain, because no one can. We can hide it in this app in the cases the Rules describe.</p>

        <h2>Children</h2>
        <p>This app is for people aged 18 and older.</p>

        <h2>Contact</h2>
        <p>{OPERATOR.name}, <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.</p>
      </article>
    </>
  );
}
