// The city plan: a canyon of towers either side of one avenue, a downtown core further on,
// and a single tower closing the avenue that carries the UPROAR sign.
// Units are metres. x runs east-west, z runs north (negative) to south, y is up.

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const AVENUE = 14; // half-width of the avenue
export const PITCH = 64; // block + street
export const BLOCK = 50;
export const DOWNTOWN = { x: 30, z: -1250 };
export const END = { x: 0, z: -930, w: 76, d: 56, h: 270 }; // the tower that closes the avenue

// styles: 0 office grid, 1 glass ribbon, 2 residential, 3 dark industrial / clutter
function pickStyle(R, core) {
  const r = R();
  if (r < 0.34 + core * 0.15) return 0;
  if (r < 0.6 + core * 0.25) return 1;
  if (r < 0.9) return 2;
  return 3;
}

function heightAt(R, x, z) {
  const dx = x - DOWNTOWN.x;
  const dz = (z - DOWNTOWN.z) * 0.8;
  const d2 = dx * dx + dz * dz;
  const core = Math.exp(-d2 / (560 * 560));
  const ring = Math.exp(-d2 / (1200 * 1200));
  let h = 18 + 74 * R() ** 1.6 * (0.5 + ring) + core * (110 + 280 * R() ** 1.25);
  if (R() < 0.025 + core * 0.14) h += 140 + R() * 280;
  // the first stretch of avenue: a canyon the camera can fly through
  if (z > -260 && Math.abs(x) < 140) h = 30 + R() * 72;
  return { h, core };
}

export function layoutCity({ low = false } = {}) {
  const R = mulberry(20261107);
  const boxes = [];
  const add = (b) => boxes.push(b);

  const building = (cx, cz, w, d, side) => {
    const { h, core } = heightAt(R, cx, cz);
    const style = pickStyle(R, core);
    const lit = style === 3 ? 0.1 + R() * 0.08 : 0.18 + R() * 0.4;
    const nearAve = Math.abs(cx) < AVENUE + BLOCK + 10;
    const edge = R() < (nearAve ? 0.2 : 0.09) ? 1 + Math.floor(R() * 3) : 0;
    const tint = R();
    const seed = R() * 1000;
    const shop = nearAve && h < 140 ? 1 : R() < 0.3 ? 1 : 0;
    const base = { style, lit, edge, tint, seed, shop, side };
    if (h > 120) {
      add({ ...base, x: cx, z: cz, w, d, y0: 0, y1: h * 0.6 });
      add({ ...base, x: cx, z: cz, w: w * 0.78, d: d * 0.78, y0: h * 0.6, y1: h * 0.86, shop: 0 });
      add({ ...base, x: cx, z: cz, w: w * 0.55, d: d * 0.55, y0: h * 0.86, y1: h, shop: 0 });
      if (R() < 0.5) add({ ...base, style: 3, edge: 0, lit: 0, x: cx, z: cz, w: 2.2, d: 2.2, y0: h, y1: h + 18 + R() * 36, shop: 0, spire: 1 });
    } else {
      add({ ...base, x: cx, z: cz, w, d, y0: 0, y1: h });
      const clutter = Math.floor(R() * 4);
      for (let i = 0; i < clutter; i++) {
        const cw = 3 + R() * 6;
        const cd = 3 + R() * 6;
        add({ style: 3, lit: 0.05, edge: 0, tint: 0, seed: R() * 1000, shop: 0, side,
          x: cx + (R() - 0.5) * (w - cw), z: cz + (R() - 0.5) * (d - cd), w: cw, d: cd, y0: h, y1: h + 2 + R() * 5 });
      }
    }
  };

  const block = (bx, bz, side) => {
    const split = R();
    const gap = 3 + R() * 3;
    if (split < 0.28) building(bx, bz, BLOCK - 2, BLOCK - 2, side);
    else if (split < 0.62) {
      const ww = (BLOCK - gap) / 2;
      building(bx - (ww + gap) / 2, bz, ww, BLOCK - 2, side);
      building(bx + (ww + gap) / 2, bz, ww, BLOCK - 2, side);
    } else {
      const ww = (BLOCK - gap) / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) building(bx + sx * (ww + gap) / 2, bz + sz * (ww + gap) / 2, ww, ww, side);
    }
  };

  const cols = low ? 9 : 15;
  const rows = low ? 26 : 36;
  for (const side of [-1, 1]) {
    for (let k = 0; k < cols; k++) {
      const bx = side * (AVENUE + 2 + BLOCK / 2 + k * PITCH);
      for (let j = 0; j < rows; j++) {
        const bz = 70 - j * PITCH;
        // a plaza in front of the end tower, so its sign is seen whole
        if (k < 2 && bz < END.z + END.d / 2 + 150 && bz > END.z) continue;
        block(bx, bz, side);
      }
    }
  }
  // past the end tower the avenue itself fills in: downtown
  for (let j = 0; j < rows; j++) {
    const bz = END.z - END.d / 2 - 40 - j * PITCH;
    if (bz < 70 - rows * PITCH) break;
    building(0, bz, AVENUE * 2 - 4, BLOCK - 2, 0);
  }
  // the end tower, built by hand
  const T = { style: 0, lit: 0.42, edge: 0, tint: 0.2, seed: 77, shop: 1, side: 0, end: 1 };
  boxes.push({ ...T, x: END.x, z: END.z, w: END.w, d: END.d, y0: 0, y1: END.h * 0.64 });
  boxes.push({ ...T, x: END.x, z: END.z - 4, w: END.w * 0.8, d: END.d * 0.8, y0: END.h * 0.64, y1: END.h * 0.9, shop: 0 });
  boxes.push({ ...T, x: END.x, z: END.z - 8, w: END.w * 0.5, d: END.d * 0.5, y0: END.h * 0.9, y1: END.h, shop: 0 });

  // a far skyline so the horizon never runs out
  const far = low ? 140 : 260;
  for (let i = 0; i < far; i++) {
    const a = -Math.PI * 0.95 + R() * Math.PI * 0.9;
    const r = 2500 + R() * 1300;
    const h = 120 + R() ** 1.5 * 520;
    const w = 40 + R() * 70;
    boxes.push({ style: R() < 0.5 ? 0 : 1, lit: 0.3 + R() * 0.3, edge: R() < 0.06 ? 2 : 0, tint: R(), seed: R() * 1000, shop: 0, side: 0,
      x: Math.cos(a) * r + DOWNTOWN.x, z: Math.sin(a) * r * 0.6 + DOWNTOWN.z, w, d: w * (0.6 + R() * 0.6), y0: 0, y1: h });
  }
  return boxes;
}
