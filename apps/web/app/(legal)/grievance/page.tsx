import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { GAC_PORTAL, OPERATOR, POLICY_DATE } from '@/lib/operator';

export const metadata: Metadata = { title: 'Grievance Officer', description: 'Contact the Grievance Officer for the UPROAR app, under the IT Rules, 2021.' };

export default function GrievancePage() {
  return (
    <>
      <LegalHead title="Grievance Officer" subtitle={`Last updated ${POLICY_DATE}`} />
      <article className="page">
        <p className="lede">Under Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.</p>
        <dl className="kv" style={{ margin: '16px 0' }}>
          <dt>Name</dt><dd>{OPERATOR.grievanceOfficer}</dd>
          <dt>Email</dt><dd><a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></dd>
          <dt>Country</dt><dd>{OPERATOR.country}</dd>
        </dl>

        <h2>How to file</h2>
        <p>The fastest way is the <Link prefetch={false} href="/report">report form</Link>, which starts the right clock straight away and gives you a reference number. You can also email the address above with the link to the post, what is wrong, and how to reach you.</p>

        <h2>What to expect</h2>
        <ul className="list">
          <li>Acknowledged within 24 hours. The form does this straight away.</li>
          <li>Resolved within 7 days.</li>
          <li>Removal requests about threats, harassment, private details, incitement, deliberate falsehoods and malware are resolved within 36 hours.</li>
          <li>Complaints about nudity, sexual content, morphed images or impersonation of a person are acted on within 2 hours.</li>
          <li>Court and government orders are acted on within 3 hours. Officers should use <Link prefetch={false} href="/law-enforcement">this page</Link>.</li>
        </ul>

        <h2>If you disagree with a decision</h2>
        <p>You can <Link prefetch={false} href="/appeal">appeal to us</Link>, and you can appeal to the <a href={GAC_PORTAL} target="_blank" rel="noopener noreferrer">Grievance Appellate Committee</a> within 30 days of our decision.</p>

        <h2>What we can and can&apos;t do</h2>
        <p>We can hide or withhold content in this app, its search and its share cards. We can&apos;t remove anything from the Solana blockchain, because nobody can.</p>
      </article>
    </>
  );
}
