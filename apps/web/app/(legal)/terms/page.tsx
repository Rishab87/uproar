import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { OPERATOR, POLICY_DATE } from '@/lib/operator';

export const metadata: Metadata = { title: 'Terms', description: 'The agreement for using the UPROAR app.' };

export default function TermsPage() {
  return (
    <>
      <LegalHead title="Terms" subtitle={`Last updated ${POLICY_DATE}`} />
      <article className="page">
        <h2>Who runs this</h2>
        <p>This app is run by {OPERATOR.name}, {OPERATOR.description} (&ldquo;we&rdquo;). You can reach us at <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. By using the app you agree to these Terms, the <Link prefetch={false} href="/rules">Rules</Link> and the <Link prefetch={false} href="/privacy">Privacy Policy</Link>.</p>

        <h2>What this is, and what it isn&apos;t</h2>
        <p>UPROAR is a website that reads a public, open program on the Solana blockchain and displays what people have written to it. We don&apos;t control the blockchain. The chain records your actions, and this app shows them. Anyone can build a different app on the same data, and these Terms only cover this one.</p>

        <h2>Permanence</h2>
        <p><strong>What you post is written to a public blockchain and can&apos;t be erased by you, us or anyone else.</strong> Deleting a post hides it in this app and in other apps that choose to respect deletes. Copies stay on the chain and may be read by anyone with the tools to do so. Don&apos;t post anything you may later want removed from the world.</p>

        <h2>Who can use it</h2>
        <p>You must be at least 18, able to enter a binding contract, and allowed by the law where you live to use this service.</p>

        <h2>Your wallet and keys</h2>
        <p>You control your wallet. We never hold your funds or your keys, and we can&apos;t recover them if you lose them. A session key is stored in your browser and can perform social actions for you until it expires or you revoke it. It can spend the small fee balance you gave it. It can&apos;t move other funds or change your name. Keep your device secure.</p>

        <h2>Costs</h2>
        <p>Using the app needs Solana network fees, which go to the network and aren&apos;t refundable. Claiming a name locks a deposit and account rent on chain. You get these back when you release the name and close the account, less network fees. We charge no fee and receive none of these amounts. Costs are shown before you approve anything.</p>

        <h2>Your content</h2>
        <p>You own what you write. By posting, you let this app display, store, index and transmit it, which is what a social network has to do. You are responsible for what you post. You confirm that you have the right to post it and that it doesn&apos;t break the Rules or the law.</p>

        <h2>What we can do</h2>
        <p>Under these Terms and the law, we can hide or disable access to content or accounts in this app, in whole or for certain countries, apply labels, and suspend or terminate your access to this app. We can&apos;t change what is on the chain. See the <Link prefetch={false} href="/rules">Rules</Link> for how decisions are made and how to appeal.</p>

        <h2>Reporting and legal requests</h2>
        <p>We act on complaints and lawful orders as the law requires. We may report offences to the authorities where the law requires that, and share the limited data we hold in response to lawful requests. See the <Link prefetch={false} href="/privacy">Privacy Policy</Link>.</p>

        <h2>No warranty</h2>
        <p>The app and the protocol are provided as they are, without warranty of any kind. Blockchains and software can fail. Transactions can be delayed or lost. The program is open source and not formally audited, and using it is at your own risk.</p>

        <h2>Limit of liability</h2>
        <p>To the extent the law allows, we aren&apos;t liable for indirect or consequential loss, loss of funds caused by your wallet, keys or the blockchain, or content posted by other people. Nothing here limits liability that can&apos;t be limited by law.</p>

        <h2>Changes</h2>
        <p>We may change these Terms. We&apos;ll tell users about important changes in the app. Continuing to use the app means you accept the new Terms.</p>

        <h2>Governing law</h2>
        <p>These Terms are governed by the laws of {OPERATOR.jurisdiction}. Grievances go first to the <Link prefetch={false} href="/grievance">Grievance Officer</Link>.</p>
      </article>
    </>
  );
}
