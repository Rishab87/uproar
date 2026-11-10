import { ACCENTS } from '@/components/Avatar';
import { pageCtx } from '@/lib/server/ctx';
import { NeonSign, OgFrame, ogImage } from '@/lib/server/og';
import { getProfileByHandle, restrictedAnywhere } from '@/lib/server/queries';

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const clean = decodeURIComponent(handle).toLowerCase();
  const c = await pageCtx();
  const page = /^[a-z0-9_]{3,15}$/.test(clean) ? await getProfileByHandle(c, clean) : null;
  // A hidden or withheld name gets the plain card, so its sign can't keep travelling after a decision.
  if (!page || page.tombstone || (await restrictedAnywhere(c, 'profile', page.profile.address))) {
    return ogImage(<OgFrame footer="An open social network on Solana"><NeonSign text="UPROAR" color="#ff2d95" /></OgFrame>);
  }
  const color = ACCENTS[Math.abs(page.profile.accent) % ACCENTS.length] as string;
  return ogImage(
    <OgFrame footer="Claimed on UPROAR">
      <NeonSign text={`@${clean}`} color={color} />
    </OgFrame>,
  );
}
