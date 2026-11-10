import { RichText } from './RichText';

export function QuotedPreview({ text, handle }: { text: string; handle: string | null }) {
  return (
    <div className="quoted quoted-preview">
      {handle ? <p className="who-handle">@{handle}</p> : null}
      <p className="post-text"><RichText text={text} /></p>
    </div>
  );
}
