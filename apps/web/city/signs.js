// Signs and screens. The megacorp rents you a name from its billboards; the street answers in
// neon, and every handle claimed on UPROAR gets a real sign on the avenue.
import * as THREE from './vendor/three.js';
import { mulberry, AVENUE, END } from './layout.js';

const JP = '"Noto JP Sign", "Hiragino Sans", "Yu Gothic", sans-serif';
const UI = 'Tomorrow, "Arial Narrow", sans-serif';
const NEON = '"Tilt Neon", Tomorrow, sans-serif';
const SHOUT = 'Anybody, Impact, sans-serif';

/* ---------------------------------------------------------------- materials */

const NEON_VERT = /* glsl */ `
varying vec2 vUv; varying float vDist;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.);
  vDist = length(w.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Additive light that dims into the haze instead of turning into a grey rectangle.
function neonMaterial(tex, color, intensity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uOn: { value: 1 }, uFogDensity: { value: 0 } },
    vertexShader: NEON_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D map; uniform vec3 uColor; uniform float uOn; uniform float uFogDensity;
      varying vec2 vUv; varying float vDist;
      void main() {
        float a = texture2D(map, vUv).r;
        float fogF = exp(-pow(uFogDensity * vDist, 2.));
        gl_FragColor = vec4(uColor * a * uOn * fogF, 1.);
      }`,
  });
}

// LED screens: you see the sub-pixels when you get close.
function screenMaterial(tex, intensity, cols) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, uIntensity: { value: intensity }, uCols: { value: cols }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogDensity: { value: 0 } },
    vertexShader: NEON_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D map; uniform float uIntensity; uniform float uCols; uniform float uTime; uniform vec3 uFog; uniform float uFogDensity;
      varying vec2 vUv; varying float vDist;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        float px = vUv.x * uCols * 3.;
        float s = fract(px / 3.);
        vec3 mask = vec3(step(s, .333), step(.333, s) * step(s, .666), step(.666, s));
        float near = 1. - smoothstep(.25, .8, fwidth(px));
        c *= mix(vec3(1.), mask * 2.4 + .12, near * .85);
        c *= .93 + .07 * sin(vUv.y * 700. - uTime * 6.);
        c *= uIntensity;
        float fogF = 1. - exp(-pow(uFogDensity * vDist, 2.));
        gl_FragColor = vec4(mix(c, uFog, clamp(fogF, 0., 1.)), 1.);
      }`,
  });
}

/* ---------------------------------------------------------------- drawing */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  return { c, g };
}

const made = [];
function texture(c, srgb = false) {
  const t = new THREE.CanvasTexture(c);
  made.push(t);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A tube frame: rounded rectangle stroked in white, the bloom turns it into light.
function tubeFrame(g, x, y, w, h, lw, r = lw * 2) {
  g.save();
  g.strokeStyle = '#fff';
  g.lineWidth = lw;
  g.lineJoin = 'round';
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.stroke();
  g.restore();
}

function bladeSign(text, family, weight = 900) {
  const chars = [...text];
  const W = 128;
  const step = 112;
  const H = Math.round(step * chars.length + 64);
  const { c, g } = canvas(W, H);
  tubeFrame(g, 10, 10, W - 20, H - 20, 7, 14);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${weight} ${chars.length > 4 ? 78 : 92}px ${family}`;
  chars.forEach((ch, i) => g.fillText(ch, W / 2, 32 + step * (i + 0.5)));
  return { c, aspect: W / H };
}

// Largest size (<= max) at which `text` fits in `width`.
function fit(g, weight, family, text, max, width) {
  g.font = `${weight} 100px ${family}`;
  return Math.min(max, (100 * width) / Math.max(1, g.measureText(text).width));
}

function wordSign(text, font, size = 120, frame = true) {
  const { g: probe } = canvas(8, 8);
  probe.font = `${size}px ${font}`;
  const tw = probe.measureText(text).width;
  const W = Math.min(1024, Math.ceil(tw + size * 0.9));
  const H = Math.round(size * 1.7);
  const { c, g } = canvas(W, H);
  if (frame) tubeFrame(g, 8, 8, W - 16, H - 16, 7, 18);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${size}px ${font}`;
  g.fillText(text, W / 2, H / 2 + size * 0.04);
  return { c, aspect: W / H };
}

function lumenAd() {
  const W = 512;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#c9e6ff');
  bg.addColorStop(0.55, '#9fcdf5');
  bg.addColorStop(1, '#c7b0f0');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.7, H * 0.28, 10, W * 0.7, H * 0.28, W * 0.7);
  glow.addColorStop(0, 'rgba(235,248,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0b1733';
  g.textBaseline = 'alphabetic';
  g.font = `600 30px ${UI}`;
  g.fillText('L U M E N ™', 44, 78);
  const big = fit(g, 900, SHOUT, 'RENT', 170, W - 84);
  g.font = `900 ${big}px ${SHOUT}`;
  ['RENT', 'YOUR', 'NAME'].forEach((w, i) => g.fillText(w, 40, 330 + i * big * 0.96));
  g.font = `500 40px ${UI}`;
  g.fillText('and be happy.', 46, 846);
  g.fillStyle = 'rgba(11,23,51,0.55)';
  g.font = `400 22px ${UI}`;
  g.fillText('identity, as a service', 46, 930);
  return { c, aspect: W / H };
}

const RENT = ['RENT YOUR NAME.', 'RENT YOUR FEED.', 'RENT YOUR REACH.', 'RENT YOUR VOICE.'];
function rentAd(i) {
  const W = 1024;
  const H = 384;
  const { c, g } = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a1a3a');
  bg.addColorStop(1, '#1d0b33');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#7ff3ff';
  g.font = `600 34px ${UI}`;
  g.fillText('L U M E N ™', 56, 74);
  g.fillStyle = '#ffffff';
  const size = Math.min(...RENT.map((t) => fit(g, 900, SHOUT, t, 108, W - 110)));
  g.font = `900 ${size}px ${SHOUT}`;
  g.fillText(RENT[i % RENT.length], 52, 230);
  g.fillStyle = 'rgba(127,243,255,0.75)';
  g.font = `400 30px ${UI}`;
  g.fillText('first month free. cancel never.', 56, 310);
  return c;
}

function heroLayer(which) {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = fit(g, 400, NEON, 'UPROAR', 300, W - 90);
  if (which === 'frame') {
    tubeFrame(g, 18, H / 2 - size * 0.86, W - 36, size * 1.72, 9, 40);
  } else {
    g.font = `400 ${size}px ${NEON}`;
    g.lineWidth = 5;
    g.fillText('UPROAR', W / 2, H / 2 + size * 0.04);
    g.strokeText('UPROAR', W / 2, H / 2 + size * 0.04);
  }
  return c;
}

/* ---------------------------------------------------------------- the city's signage */

export async function buildSigns(boxes, { fogDensity, fogColor, low, handles = [] }) {
  await Promise.all([
    document.fonts.load(`900 100px ${JP}`, '修理手作り人間営業中'),
    document.fonts.load(`100px ${NEON}`),
    document.fonts.load(`600 40px ${UI}`),
    document.fonts.load(`900 100px ${SHOUT}`),
  ]).catch(() => {});

  const group = new THREE.Group();
  const neonMats = [];
  const screens = [];
  const R = mulberry(4242);

  const plane = (w, h, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };
  const neon = (art, color, intensity, h, x, y, z, ry = 0) => {
    const mat = neonMaterial(texture(art.c), color, intensity);
    mat.uniforms.uFogDensity.value = fogDensity * 0.85;
    neonMats.push(mat);
    return plane(h * art.aspect, h, mat, x, y, z, ry);
  };
  const dark = new THREE.MeshBasicMaterial({ color: 0x020203 });
  const backing = (w, h, x, y, z, ry = 0, depth = 1.2) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), dark);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
  };
  // a screen on a frame: one group so the screen sits flat on its backing at any angle
  const mount = (w, h, mat, x, y, z, ry, frame = 1.5) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w + frame * 2, h + frame * 2, 1.6), dark);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    face.position.z = 0.85;
    g.add(box, face);
    group.add(g);
  };

  // the avenue-facing buildings: blades hang off them over the pavement, facing down the avenue
  const fronts = boxes.filter((b) => b.y0 === 0 && b.side !== 0 && Math.abs(b.x) - b.w / 2 < AVENUE + 6 && b.z > END.z + 40);
  const pick = (zMin, zMax, side) => fronts.filter((b) => b.side === side && b.z < zMax && b.z > zMin);
  const blade = (art, color, intensity, h, side, zMin, zMax, y) => {
    const list = pick(zMin, zMax, side);
    if (!list.length) return;
    const b = list[Math.floor(R() * list.length)];
    const face = b.x - side * (b.w / 2);
    const z = b.z + (R() - 0.5) * (b.d * 0.7);
    const x = face - side * 1.6;
    backing(h * art.aspect + 0.4, h + 0.6, x, y, z - 0.35, 0, 0.3);
    neon(art, color, intensity, h, x, y, z);
  };

  // hand-placed: one strong sign every stretch of the flight
  blade(bladeSign('修理', JP), 0xff2440, 3.6, 9, -1, -90, 10, 12);
  blade(bladeSign('SPEAK', UI, 700), 0x2ff0ff, 3.0, 11, 1, -120, -30, 16);
  blade(bladeSign('手作り', JP), 0xff2bb8, 3.8, 12, -1, -260, -160, 22);
  blade(bladeSign('RECORDS', UI, 700), 0xff8a3d, 2.8, 12, 1, -300, -200, 13);
  blade(bladeSign('人間', JP), 0xd8f6ff, 3.2, 10, 1, -420, -330, 26);
  blade(bladeSign('ARCADE', UI, 700), 0x8b5bff, 3.2, 11, -1, -460, -360, 14);
  blade(bladeSign('営業中', JP), 0x2ff0ff, 3.0, 8, -1, -620, -520, 9);
  blade(bladeSign('TAPES', UI, 700), 0xff2bb8, 3.0, 9, 1, -640, -540, 10);

  // tall vertical banners up the faces of the canyon towers
  const banner = (art, color, intensity, h, side, zMin, zMax, yFrac) => {
    const list = pick(zMin, zMax, side).filter((b) => b.y1 > h + 20);
    if (!list.length) return;
    const b = list[Math.floor(R() * list.length)];
    const face = b.x - side * (b.w / 2);
    const z = b.z + side * (b.d / 2 - 2);
    const x = face - side * 2.4;
    const y = Math.min(b.y1 - h / 2 - 2, h / 2 + 8 + (b.y1 - h - 10) * yFrac);
    backing(h * art.aspect + 0.6, h + 0.8, x, y, z - 0.4, 0, 0.4);
    neon(art, color, intensity, h, x, y, z);
  };
  banner(bladeSign('人間', JP), 0xff2bb8, 3.4, 26, 1, -150, 20, 0.5);
  banner(bladeSign('LOUD', UI, 700), 0x2ff0ff, 3.2, 30, -1, -240, -60, 0.6);
  banner(bladeSign('修理', JP), 0xff2440, 3.6, 24, 1, -380, -230, 0.4);
  banner(bladeSign('OPEN', UI, 700), 0xff2bb8, 3.2, 28, -1, -520, -380, 0.5);
  banner(bladeSign('手作り', JP), 0x2ff0ff, 3.4, 30, 1, -640, -500, 0.6);

  // street clutter: words that belong on this street, plus small lit panels
  const words = ['NO RENT', 'SAY IT', 'OWN IT', 'REPLY', 'OPEN', '24H', 'NO BOOSTS', 'LIVE'];
  const colors = [0xff2bb8, 0x2ff0ff, 0xff2440, 0xffffff, 0x8b5bff, 0xff8a3d];
  const wordArts = words.map((w) => wordSign(w, NEON, 120));
  const count = low ? 22 : 46;
  for (let i = 0; i < count; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const list = pick(-880, 60, side);
    if (!list.length) continue;
    const b = list[Math.floor(R() * list.length)];
    const face = b.x - side * (b.w / 2);
    const z = b.z + (R() - 0.5) * b.d * 0.8;
    const y = 5 + R() ** 1.8 * 34;
    if (R() < 0.55) {
      // flush on the facade, facing across the avenue
      const art = wordArts[Math.floor(R() * wordArts.length)];
      neon(art, colors[Math.floor(R() * colors.length)], 2.6, 1.6 + R() * 1.8, face - side * 0.3, y, z, -side * Math.PI / 2);
    } else {
      // hanging horizontal sign over the pavement, facing down the avenue
      const art = wordArts[Math.floor(R() * wordArts.length)];
      const h = 1.6 + R() * 1.4;
      const x = face - side * (1.8 + R() * 2);
      backing(h * art.aspect + 0.4, h + 0.4, x, y, z - 0.3, 0, 0.3);
      neon(art, colors[Math.floor(R() * colors.length)], 2.8, h, x, y, z);
    }
  }

  // every claimed handle gets its own sign, newest first, nearest the start of the flight
  const accents = [0xff2bb8, 0x2ff0ff, 0xffffff, 0x8b5bff, 0xff8a3d];
  handles.slice(0, low ? 14 : 28).forEach(({ handle, accent }, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const span = 60 + i * 26;
    const list = pick(-span - 60, -span + 60, side);
    if (!list.length) return;
    const b = list[Math.floor(R() * list.length)];
    const face = b.x - side * (b.w / 2);
    const art = wordSign(`@${handle}`, NEON, 120);
    const h = i < 4 ? 4.2 : 3;
    const x = face - side * (2.4 + (h * art.aspect) / 2);
    const y = 9 + (i % 5) * 4.5 + R() * 2;
    const z = b.z + (R() - 0.5) * b.d * 0.6;
    backing(h * art.aspect + 0.5, h + 0.5, x, y, z - 0.3, 0, 0.3);
    neon(art, accents[(accent ?? 0) % accents.length], 3.2, h, x, y, z);
  });

  // the megacorp
  const lumen = lumenAd();
  const lumenTex = texture(lumen.c, true);
  const lumenMat = screenMaterial(lumenTex, 1.05, 160);
  lumenMat.uniforms.uFog.value = fogColor;
  lumenMat.uniforms.uFogDensity.value = fogDensity;
  screens.push(lumenMat);
  const roofSign = (mat, w, h, side, zNear, ry) => {
    const list = fronts.filter((b) => b.side === side && Math.abs(b.z - zNear) < 70 && b.y1 < 66).sort((a, b) => Math.abs(a.z - zNear) - Math.abs(b.z - zNear));
    const b = list[0];
    const roof = b ? b.y1 : 40;
    const x = b ? b.x - side * (b.w / 2 - w * 0.42) : side * 30;
    const z = b ? b.z : zNear;
    const y = roof + 4 + h / 2;
    mount(w, h, mat, x, y, z, ry);
    for (const lx of [-w * 0.32, w * 0.32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, y - h / 2 - roof, 0.8), dark);
      leg.position.set(x + lx * Math.cos(ry), roof + (y - h / 2 - roof) / 2, z - lx * Math.sin(ry) - 0.8);
      group.add(leg);
    }
  };
  roofSign(lumenMat, 26, 52, 1, -205, -0.3);

  let rentIndex = 0;
  const rentTexs = RENT.map((_, k) => texture(rentAd(k), true));
  const rentMat = screenMaterial(rentTexs[0], 1.45, 300);
  rentMat.uniforms.uFog.value = fogColor;
  rentMat.uniforms.uFogDensity.value = fogDensity;
  screens.push(rentMat);
  roofSign(rentMat, 44, 16.5, -1, -470, 0.28);

  // UPROAR, on the tower that closes the avenue
  const heroZ = END.z + END.d / 2 + 0.8;
  const heroW = 66;
  const heroH = heroW / 2;
  const heroY = 140;
  backing(heroW + 6, heroH + 6, 0, heroY, heroZ - 0.6, 0, 0.8);
  const layers = [['frame', 0x2ff0ff, 3.4], ['word', 0xff2bb8, 4.8]].map(([k, col, inten]) => {
    const mat = neonMaterial(texture(heroLayer(k)), col, inten);
    mat.uniforms.uFogDensity.value = fogDensity * 0.5;
    neonMats.push(mat);
    plane(heroW, heroH, mat, 0, heroY, heroZ);
    return mat;
  });

  let last = 0;
  return {
    group,
    textures: made,
    hero: { x: 0, y: heroY, z: heroZ },
    update(t) {
      for (const s of screens) s.uniforms.uTime.value = t;
      // the megacorp's screen cycles what it wants you to rent
      if (t - last > 2.6) {
        last = t;
        rentIndex = (rentIndex + 1) % rentTexs.length;
        rentMat.uniforms.map.value = rentTexs[rentIndex];
      }
      // the odd tube that never stopped buzzing
      layers[1].uniforms.uOn.value = Math.sin(t * 31) > 0.97 && Math.sin(t * 0.7) > 0.6 ? 0.25 : 1;
    },
  };
}
