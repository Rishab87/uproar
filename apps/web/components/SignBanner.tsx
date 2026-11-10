import { accentColor } from './Avatar';

/**
 * Every profile's banner is its handle as a neon sign on a dark wall. It's drawn, not uploaded, and
 * it's the same sign that hangs in the city.
 */
export function SignBanner({ handle, accent }: { handle: string | null; accent: number }) {
  const color = accentColor(accent);
  const text = handle ? `@${handle}` : 'UPROAR';
  return (
    <div className="sign-banner" style={{ color, ['--glow' as string]: color }} aria-hidden="true">
      <span className="sign-tube">{text}</span>
    </div>
  );
}
