import { stripBidiControls, tokenize } from '@uproar/protocol';
import Link from 'next/link';

function shortUrl(url: string): string {
  const clean = url.replace(/^https?:\/\/(www\.)?/, '');
  return clean.length > 34 ? `${clean.slice(0, 32)}...` : clean;
}

/** Text is never treated as HTML. Mentions, tags and http(s) links are the only things made clickable. */
export function RichText({ text }: { text: string }) {
  const tokens = tokenize(stripBidiControls(text));
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'mention') return <Link prefetch={false} key={i} className="tok" href={`/@${t.value.slice(1).toLowerCase()}`} onClick={stop}>{t.value}</Link>;
        if (t.type === 'hashtag') return <Link prefetch={false} key={i} className="tok" href={`/tag/${encodeURIComponent(t.value.slice(1))}`} onClick={stop}>{t.value}</Link>;
        if (t.type === 'url') return <a key={i} className="tok" href={t.value} target="_blank" rel="nofollow ugc noopener noreferrer" onClick={stop}>{shortUrl(t.value)}</a>;
        return <span key={i}>{t.value}</span>;
      })}
    </>
  );
}
