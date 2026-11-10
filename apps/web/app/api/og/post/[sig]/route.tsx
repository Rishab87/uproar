import { stripBidiControls } from '@uproar/protocol';
import { getSql } from '@/lib/server/db';
import { isValidSignature } from '@/lib/server/http';
import { NeonSign, OgFrame, ogImage } from '@/lib/server/og';
import { getPost } from '@/lib/server/queries';

/** The bundled fonts cover Latin only. Other scripts get the handle card instead of empty boxes. */
const LATIN = /^[\u0000-ɏ -⁯\s]*$/;

export async function GET(_req: Request, { params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  const generic = () => ogImage(<OgFrame footer="An open social network on Solana"><NeonSign text="UPROAR" color="#ff2d95" /></OgFrame>);
  if (!isValidSignature(sig)) return generic();

  const sql = getSql();
  // Crawlers come from anywhere, so a post withheld in any country gets the blank card everywhere.
  const withheld = await sql`select 1 from content_state where target_type = 'post' and target = ${sig} and cardinality(withheld_countries) > 0`;
  if (withheld.length) return generic();
  const post = await getPost({ sql, country: '', viewer: null }, sig);
  if (!post || post.tombstone || !post.text) return generic();
  const authorWithheld = post.author ? await sql`select 1 from content_state where target_type = 'profile' and target = ${post.author.address} and cardinality(withheld_countries) > 0` : [];
  if (authorWithheld.length) return generic();

  const who = post.author?.handle ? `@${post.author.handle}` : 'UPROAR';
  const text = stripBidiControls(post.text);
  if (!LATIN.test(text)) return ogImage(<OgFrame footer="On UPROAR"><NeonSign text={who} color="#2df0ff" /></OgFrame>);
  const clipped = text.length > 230 ? `${text.slice(0, 228)}...` : text;
  return ogImage(
    <OgFrame footer={who}>
      <div style={{ display: 'flex', fontSize: text.length > 120 ? 44 : 60, lineHeight: 1.25, whiteSpace: 'pre-wrap' }}>{clipped}</div>
    </OgFrame>,
  );
}
