import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { GAC_PORTAL, OPERATOR, POLICY_DATE } from '@/lib/operator';

export const metadata: Metadata = { title: 'Rules', description: 'What you can post on the UPROAR app, what gets hidden, and how to appeal.' };

export default function RulesPage() {
  return (
    <>
      <LegalHead title="Rules" subtitle={`Last updated ${POLICY_DATE}`} />
      <article className="page">
        <p className="lede">Posts are written to Solana, and nobody can erase them from there. These rules cover what this app shows. Other apps reading the same chain can make other choices.</p>

        <h2>What stays up</h2>
        <p>Opinion, politics, religion, satire, criticism of anyone including governments, and insults that stay within the law all stay up by default. If you don&apos;t want to see something, you can mute it, block it or filter it by label. A complaint gets a written answer. It does not automatically mean removal.</p>

        <h2>What gets hidden here without waiting for a complaint</h2>
        <ul className="list">
          <li>Sexual content involving a child.</li>
          <li>Intimate images or descriptions of a person shared without their consent.</li>
          <li>Credible threats of violence against a named person.</li>
          <li>Publishing someone&apos;s private details in order to harm them.</li>
          <li>Anything a court or an authorised government agency orders us to disable, as far as the order requires.</li>
        </ul>

        <h2>What the law says you must not post</h2>
        <p>Indian law (Rule 3(1)(b) of the IT Rules, 2021) requires us to tell you not to host, display, upload, publish, transmit, store, update or share information that:</p>
        <ol className="list">
          <li>belongs to another person and to which you have no right;</li>
          <li>is obscene, pornographic, paedophilic, invasive of another person&apos;s privacy including bodily privacy, insulting or harassing on the basis of gender, racially or ethnically objectionable, relating to or encouraging money laundering or gambling, an online game that causes user harm, or promoting enmity between groups on the grounds of religion or caste with the intent to incite violence;</li>
          <li>is harmful to a child;</li>
          <li>infringes any patent, trademark, copyright or other proprietary right;</li>
          <li>deceives or misleads about the origin of a message, or knowingly and intentionally communicates misinformation or information that is patently false and untrue or misleading;</li>
          <li>impersonates another person;</li>
          <li>threatens the unity, integrity, defence, security or sovereignty of India, friendly relations with foreign States or public order, incites any cognisable offence, prevents the investigation of any offence, or insults another nation;</li>
          <li>contains a software virus or other code designed to interrupt, destroy or limit the functionality of any computer resource;</li>
          <li>is an online game not verified as a permissible online game;</li>
          <li>advertises or promotes an online game that is not permissible, or an intermediary offering one;</li>
          <li>violates any law for the time being in force.</li>
        </ol>

        <h2>What happens if you break them</h2>
        <p>This app can suspend or terminate your access to the app at once, and remove or disable access to what you posted here. If what you post breaks the law, you may be liable to penalty or punishment under the Information Technology Act or other law. Where an offence must by law be reported, including under the Bharatiya Nagarik Suraksha Sanhita, 2023 or the Protection of Children from Sexual Offences Act, 2012, it will be reported to the authorities.</p>

        <h2>How complaints are handled</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Complaint</th><th>Who can file</th><th>What happens</th><th>Deadline</th></tr></thead>
            <tbody>
              <tr><td>Sexual content involving a child</td><td>Anyone</td><td>Hidden as soon as it&apos;s filed, reviewed at once, reported to the authorities</td><td>Immediately</td></tr>
              <tr><td>Nudity, sexual content, morphed images or impersonation of a person</td><td>That person, or someone on their behalf, with a signed declaration</td><td>Hidden first, then reviewed. Restored if the complaint was false</td><td>2 hours</td></tr>
              <tr><td>Court or authorised government order</td><td>Authorised officers, on <Link prefetch={false} href="/law-enforcement">this page</Link></td><td>Verified, then disabled as far as the order requires</td><td>3 hours</td></tr>
              <tr><td>Threats, harassment, private details, incitement, deliberate falsehoods, malware</td><td>Anyone</td><td>Reviewed. A written decision follows. It stays up unless it breaks these rules</td><td>36 hours</td></tr>
              <tr><td>Everything else, including copyright</td><td>Anyone</td><td>Acknowledged straight away, then a written decision</td><td>7 days</td></tr>
            </tbody>
          </table>
        </div>
        <p>Filing a false complaint can get your complaints ignored for automatic hiding. After three false complaints, your reports still get reviewed on the same clock, but nothing is hidden before review.</p>

        <h2>Labels</h2>
        <p>A label never removes anything. It lets you decide: hide, warn or show. The labels are Adult, Graphic, Self-harm, Hateful, Rude and Spam. Change your choices in <Link prefetch={false} href="/settings">Settings</Link>. An account posting more than 60 times in an hour gets the Spam label automatically, which most people have set to hide. It can post, but it gets less reach here.</p>

        <h2>What can be undone</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>You did this</th><th>Undo</th><th>What stays on chain</th></tr></thead>
            <tbody>
              <tr><td>Post, reply or quote</td><td>Delete hides it here and in apps that respect deletes</td><td>The text, forever</td></tr>
              <tr><td>Like, repost or follow</td><td>Tap again</td><td>Both events</td></tr>
              <tr><td>Claim a name</td><td>Release it for your deposit and rent back</td><td>Its history</td></tr>
              <tr><td>Start a session key</td><td>Revoke it in Settings. It also expires on its own within 30 days</td><td>Its history</td></tr>
              <tr><td>Block, mute, bookmark</td><td>Remove it in Settings</td><td>Nothing. These are never on chain</td></tr>
              <tr><td>Report</td><td>Withdraw it with your private token, except a child safety report</td><td>Nothing</td></tr>
            </tbody>
          </table>
        </div>
        <p>Nobody can erase text from the chain, edit a post, post as you without your key, or take your name on chain. This app can hide an impersonating name or a post on this app.</p>

        <h2>If we hide something of yours</h2>
        <ol className="list">
          <li>You see the reason on the post.</li>
          <li><Link prefetch={false} href="/appeal">Appeal to the Grievance Officer</Link>. You get a written decision within 7 days.</li>
          <li>If you disagree with the decision, you can appeal to the <a href={GAC_PORTAL} target="_blank" rel="noopener noreferrer">Grievance Appellate Committee</a> within 30 days.</li>
        </ol>
        <p>Every action we take appears in the <Link prefetch={false} href="/transparency">transparency log</Link>, without details that would cause more harm.</p>

        <h2>Other things to know</h2>
        <ul className="list">
          <li>You must be 18 or older.</li>
          <li>This app is run by {OPERATOR.name}, {OPERATOR.description}. See the <Link prefetch={false} href="/grievance">Grievance Officer</Link> page for contact details.</li>
          <li>We tell everyone about these rules at least every three months.</li>
        </ul>
      </article>
    </>
  );
}
