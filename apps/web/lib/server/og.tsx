import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';

const SIZE = { width: 1200, height: 630 };

async function fonts() {
  const dir = join(process.cwd(), 'assets/og');
  const [anybody, tomorrow, neon] = await Promise.all([readFile(join(dir, 'anybody-900.ttf')), readFile(join(dir, 'tomorrow-600.ttf')), readFile(join(dir, 'tilt-neon.ttf'))]);
  return [
    { name: 'Anybody', data: anybody, weight: 900 as const, style: 'normal' as const },
    { name: 'Tomorrow', data: tomorrow, weight: 600 as const, style: 'normal' as const },
    { name: 'Tilt Neon', data: neon, weight: 400 as const, style: 'normal' as const },
  ];
}

export async function ogImage(node: ReactNode): Promise<Response> {
  return new ImageResponse(node as React.ReactElement, {
    ...SIZE,
    fonts: await fonts(),
    headers: { 'cache-control': 'public, max-age=60, s-maxage=60' },
  });
}

export function OgFrame({ children, footer }: { children: ReactNode; footer?: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 56, background: '#05070c', color: '#f1f3f7', fontFamily: 'Tomorrow' }}>
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>{children}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontFamily: 'Anybody', fontSize: 40, color: '#ff2d95' }}>UPROAR</div>
        {footer ? <div style={{ display: 'flex', fontSize: 24, color: 'rgba(241,243,247,.66)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** How the letters glow: a tight halo and a wide one, in the sign's colour. */
const GLOWS = ['0 0 8px', '0 0 26px'];

/**
 * The share image for a claimed name: the handle as a neon sign.
 *
 * next/og blurs the letters themselves when text has a text-shadow, and draws only the first shadow
 * of a list. So the glow comes from blurred copies of the name underneath, one per shadow, and the
 * crisp white letters sit on top with no shadow of their own.
 */
export function NeonSign({ text, color }: { text: string; color: string }) {
  const size = text.length > 13 ? 92 : text.length > 9 ? 112 : 138;
  const letters = { display: 'flex', fontFamily: 'Tilt Neon', fontSize: size, lineHeight: 1.1, whiteSpace: 'nowrap' } as const;
  return (
    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          display: 'flex',
          padding: '18px 48px 26px',
          border: `6px solid ${color}`,
          borderRadius: 34,
          boxShadow: `0 0 60px 6px ${color}, inset 0 0 44px 0 ${color}`,
        }}
      >
        <div style={{ display: 'flex', position: 'relative' }}>
          {GLOWS.map((glow) => (
            <div key={glow} style={{ ...letters, position: 'absolute', top: 0, left: 0, color, textShadow: `${glow} ${color}` }}>
              {text}
            </div>
          ))}
          <div style={{ ...letters, color: '#fff' }}>{text}</div>
        </div>
      </div>
    </div>
  );
}
