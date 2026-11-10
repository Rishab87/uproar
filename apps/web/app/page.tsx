import { Landing } from '@/components/Landing';
import { pageCtx } from '@/lib/server/ctx';
import { recentHandles, stats } from '@/lib/server/queries';

export default async function LandingPage() {
  const c = await pageCtx();
  const [handles, counts] = await Promise.all([recentHandles(c, 28), stats(c)]);
  return <Landing handles={handles.map((h) => ({ handle: h.handle, accent: h.accent }))} stats={counts} />;
}
