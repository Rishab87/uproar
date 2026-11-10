import type { AuthorView } from '@/lib/server/queries';

export const ACCENTS = ['#ff2d95', '#2df0ff', '#f1f3f7', '#8b5bff', '#ff8a3d'];
export const accentColor = (accent: number) => ACCENTS[Math.abs(accent) % ACCENTS.length] as string;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COLS = 5;
const ROWS = 5;

/** A mirrored block glyph drawn from the address, so no image is ever uploaded or hosted. */
function cells(seed: string): boolean[] {
  let h = hash(seed);
  const out: boolean[] = [];
  for (let i = 0; i < ROWS * Math.ceil(COLS / 2); i++) {
    if (i % 24 === 0) h = hash(`${seed}:${i}`);
    out.push(((h >> (i % 24)) & 1) === 1);
  }
  return out;
}

export function Avatar({ author, size = 44 }: { author: Pick<AuthorView, 'address' | 'avatarSeed' | 'accent'> | null; size?: number }) {
  const on = author ? cells(`${author.address}:${author.avatarSeed}`) : [];
  const color = author ? accentColor(author.accent) : 'rgba(241,243,247,.3)';
  const half = Math.ceil(COLS / 2);
  const rects: { x: number; y: number }[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < half; x++) {
      if (on[y * half + x]) {
        rects.push({ x, y });
        if (x !== COLS - 1 - x) rects.push({ x: COLS - 1 - x, y });
      }
    }
  }
  return (
    <span className="avatar" style={{ width: size, height: size, color }}>
      <svg viewBox="-1 -1 7 7" width={size} height={size} aria-hidden="true" focusable="false">
        {rects.map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width="1.02" height="1.02" fill="currentColor" />
        ))}
      </svg>
    </span>
  );
}
