import type { Metadata } from 'next';
import { LegalHead } from '@/components/LegalHead';

export const metadata: Metadata = { title: 'How For You works', description: 'The exact formula behind the For You feed. No manual picks and no paid boosts.' };

export default function AlgorithmPage() {
  return (
    <>
      <LegalHead title="How For You works" />
      <article className="page">
        <p className="lede">There is one formula, and this is all of it. Nobody picks posts by hand and nobody can pay for reach.</p>
        <pre><code>{`score = (1 + likes + 2 reposts + 2 quotes + replies)
        / (hours since posting + 2) ^ 1.5
        x 1.5 if you follow the author
        x 0.7 ^ (n - 1) for the author's nth post in this feed`}</code></pre>
        <h2>What that means</h2>
        <ul className="list">
          <li>New posts get a chance, because a post starts with a score above zero.</li>
          <li>Older posts fade unless people keep engaging with them.</li>
          <li>One loud account can&apos;t fill your feed, because each extra post of theirs counts for less.</li>
          <li>Follower counts don&apos;t count at all.</li>
          <li>Replies don&apos;t appear in For You. It ranks the 5,000 most recent posts from the last 30 days.</li>
        </ul>
        <h2>What removes a post from your feed</h2>
        <ul className="list">
          <li>Your own mutes, blocks, muted words and label settings.</li>
          <li>Posts hidden or withheld under the <a href="/rules">Rules</a>.</li>
          <li>The Spam label, if you keep the default setting to hide it.</li>
        </ul>
        <h2>Prefer no ranking?</h2>
        <p>Following and Latest are strictly newest first, with no formula at all.</p>
      </article>
    </>
  );
}
