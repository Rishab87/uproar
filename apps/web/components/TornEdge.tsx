/** The notched, torn edge of the loud block. Seeded, so server and client draw the same shape. */
function edgePath(w: number, h: number, seed: number) {
  let s = seed;
  const R = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const base = h * 0.62;
  const d = [`M0 0 L${w} 0 L${w} ${base}`];
  let x = w;
  while (x > 0) {
    const r = R();
    const step = 40 + R() * 160;
    const nx = Math.max(0, x - step);
    if (r < 0.18) {
      const m = (x + nx) / 2;
      d.push(`L${m + 9} ${base} L${m} ${h} L${m - 9} ${base} L${nx} ${base}`);
    } else if (r < 0.34) {
      d.push(`L${x - 6} ${base} L${x - 6} ${h * 0.24} L${nx + 6} ${h * 0.24} L${nx + 6} ${base} L${nx} ${base}`);
    } else if (r < 0.46) {
      d.push(`L${x - 10} ${base} L${x - 18} ${h * 0.9} L${nx + 18} ${h * 0.9} L${nx + 10} ${base} L${nx} ${base}`);
    } else {
      d.push(`L${nx} ${base}`);
    }
    x = nx;
  }
  d.push('Z');
  return d.join(' ');
}

export function TornEdge({ seed, position }: { seed: number; position: 'top' | 'bottom' }) {
  return (
    <div className={`loud-edge loud-edge-${position}`} aria-hidden="true">
      <svg viewBox="0 0 1600 28" preserveAspectRatio="none" focusable="false">
        <path fill="currentColor" d={edgePath(1600, 28, seed)} />
      </svg>
    </div>
  );
}
