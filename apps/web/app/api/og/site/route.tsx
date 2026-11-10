import { NeonSign, OgFrame, ogImage } from '@/lib/server/og';

export async function GET() {
  return ogImage(
    <OgFrame footer="An open social network on Solana">
      <NeonSign text="UPROAR" color="#ff2d95" />
    </OgFrame>,
  );
}
