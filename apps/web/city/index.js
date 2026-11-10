// The city: renderer, camera rig, post-processing and a governor that keeps it smooth.
import * as THREE from './vendor/three.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass } from './vendor/three.js';
import { layoutCity } from './layout.js';
import { buildTowers } from './towers.js';
import { buildStreet } from './street.js';
import { buildSigns } from './signs.js';
import { buildTraffic } from './traffic.js';
import { buildSky, buildBeams, buildBeacons } from './sky.js';
import { GlitchShader } from './glitch.js';

// Camera keyframes: rooftop height down the avenue, a pass at street level between the towers,
// then up to face the sign on the tower that closes the avenue.
const PATH = [
  [[0, 44, 84], [0, 60, -420]],
  [[0, 30, -110], [2, 34, -520]],
  [[-1.5, 13, -320], [0, 17, -720]],
  [[1.5, 22, -560], [0, 70, -900]],
  [[0, 92, -705], [0, 128, -902]],
  [[0, 140, -790], [0, 140, -902]],
];

// Building the city is heavy. Handing the main thread back between steps keeps the page's buttons
// responding while it loads.
const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

// Never more than about 2.4 million pixels a frame: a big external screen at full density would
// otherwise be several times a laptop's work.
const PIXEL_BUDGET = 2_400_000;

export async function createCity(canvas, { tier = 'high', reduced = false, handles = [], onGiveUp = null } = {}) {
  const low = tier === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const fog = { color: new THREE.Color(0x0a1524), density: low ? 0.0013 : 0.00105 };
  const scene = new THREE.Scene();
  scene.background = fog.color;
  scene.fog = new THREE.FogExp2(fog.color, fog.density);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 9000);
  const boxes = layoutCity({ low });
  await yieldToMain();
  const towers = buildTowers(boxes, fog);
  await yieldToMain();
  const sky = buildSky(fog.color);
  const beams = buildBeams();
  const beacons = buildBeacons(boxes);
  await yieldToMain();
  const traffic = buildTraffic({ low, fog });
  await yieldToMain();
  const signs = await buildSigns(boxes, { fogDensity: fog.density, fogColor: fog.color, low, handles });
  await yieldToMain();

  let dpr = Math.min(window.devicePixelRatio || 1, tier === 'high' ? 1.25 : tier === 'mid' ? 1.1 : 1);
  let reflectScale = tier === 'high' ? 0.42 : tier === 'mid' ? 0.36 : 0.28;
  const size = () => [Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight)];
  const [w0, h0] = size();
  const street = buildStreet({ fog, resolution: [Math.round(w0 * dpr * reflectScale), Math.round(h0 * dpr * reflectScale)] });
  scene.add(sky.mesh, towers.mesh, street.mesh, signs.group, traffic.group, beams.group, beacons.mesh);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w0, h0), 0.72, 0.42, 1.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const glitch = new ShaderPass(GlitchShader);
  composer.addPass(glitch);

  let posCurve;
  let lookCurve;
  // the last two keyframes back off on narrow screens so the whole sign always fits the frame
  function buildPath(aspect, fov) {
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect);
    const need = (66 / 0.58 / 2) / Math.tan(hHalf); // the 66m sign takes ~58% of the width, phones clamp closer
    const keys = PATH.map(([p, l]) => [[...p], [...l]]);
    const end = keys[keys.length - 1];
    end[0][2] = Math.min(-760, Math.max(signs.hero.z + need, -830));
    keys[keys.length - 2][0][2] = Math.max(end[0][2] + 70, keys[keys.length - 2][0][2]);
    posCurve = new THREE.CatmullRomCurve3(keys.map(([q]) => new THREE.Vector3(...q)), false, 'centripetal');
    lookCurve = new THREE.CatmullRomCurve3(keys.map(([, l]) => new THREE.Vector3(...l)), false, 'centripetal');
  }
  const state = { target: 0, p: 0, mx: 0, my: 0, smx: 0, smy: 0, glitch: 0, nextBurst: 4, t: 0, running: false, visible: true, frames: [], dirty: true };
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();

  function resize() {
    const [w, h] = size();
    const ratio = Math.min(dpr, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    street.resize(Math.round(w * ratio * reflectScale), Math.round(h * ratio * reflectScale));
    const portrait = h > w;
    camera.fov = portrait ? 60 : 40;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    buildPath(camera.aspect, camera.fov);
    state.dirty = true;
  }

  function frame(dt) {
    const s = state;
    s.t += reduced ? 0 : dt;
    const gap = Math.abs(s.target - s.p);
    const k = 1 - Math.exp(-dt * (reduced ? 60 : 7 + gap * 40));
    s.p += (s.target - s.p) * k;
    s.smx += (s.mx - s.smx) * (1 - Math.exp(-dt * 2.4));
    s.smy += (s.my - s.smy) * (1 - Math.exp(-dt * 2.4));
    posCurve.getPoint(Math.min(1, Math.max(0, s.p)), pos);
    lookCurve.getPoint(Math.min(1, Math.max(0, s.p)), look);
    if (!reduced) {
      pos.x += Math.sin(s.t * 0.27) * 0.6 + s.smx * 2.2;
      pos.y += Math.sin(s.t * 0.41) * 0.5 - s.smy * 1.4;
    }
    look.x += s.smx * 14;
    look.y -= s.smy * 8;
    camera.position.copy(pos);
    camera.lookAt(look);

    towers.update(s.t);
    street.update(s.t);
    sky.update(s.t);
    beams.update(s.t);
    beacons.update(s.t, renderer.domElement.height / 2);
    traffic.update(s.t, reduced ? 0 : dt);
    signs.update(s.t);

    // glitch: rare bursts, plus whatever the page asks for
    if (!reduced && s.t > s.nextBurst) {
      s.glitch = Math.max(s.glitch, 0.35 + Math.random() * 0.4);
      s.nextBurst = s.t + 5 + Math.random() * 7;
    }
    glitch.uniforms.uAmount.value = s.glitch;
    glitch.uniforms.uTime.value = s.t;
    if (s.glitch > 0.01) glitch.uniforms.uSeed.value = Math.floor(s.t * 24) * 0.137;
    s.glitch *= Math.exp(-dt * 9);
    composer.render(dt);
    s.dirty = false;
  }

  // keep it smooth: if frames run long, render fewer pixels; as a last resort, only redraw on change.
  // It has to decide fast: on a struggling device every slow frame also delays the page's clicks.
  let mode = 'live';
  let warm = 0;
  function govern(dt, raw) {
    if (warm < 3) { warm += 1; return; } // the first frames after starting include one-off setup
    const f = state.frames;
    if (raw > 0.1 && dpr > 0.75) {
      dpr = 0.75;
      reflectScale = 0.22;
      resize();
      f.length = 0;
      return;
    }
    f.push(dt);
    if (f.length < 12) return;
    const sorted = [...f].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    f.length = 0;
    if (p90 > 0.021) {
      if (dpr > 0.75) {
        dpr = Math.max(0.75, dpr * 0.8);
        reflectScale = Math.max(0.22, reflectScale * 0.8);
        resize();
      } else if (mode === 'live') {
        mode = 'still';
      }
    }
  }

  // Last resort: if scrolling still runs slow at the lowest resolution, this device can't fly the city.
  // The page then keeps its still image, so it never feels stuck.
  let stillSlow = 0;
  function watchStill(raw) {
    stillSlow = raw > 0.045 ? stillSlow + 1 : Math.max(0, stillSlow - 1);
    if (stillSlow > 10 && onGiveUp) {
      const give = onGiveUp;
      onGiveUp = null;
      give();
    }
  }

  let last = performance.now();
  let raf = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, raw);
    last = now;
    if (!state.visible) return;
    // In still mode the pointer's parallax doesn't count, so aiming at a button never starts redraws.
    const pointerMoving = mode === 'live' && Math.abs(state.mx - state.smx) > 0.001;
    const moving = Math.abs(state.target - state.p) > 0.0004 || pointerMoving || state.glitch > 0.01;
    if ((mode === 'still' || reduced) && !moving && !state.dirty) return;
    frame(dt);
    if (!reduced && mode === 'live') govern(dt, raw);
    else if (mode === 'still' && moving) watchStill(raw);
  }

  resize();
  // upload every texture and compile every shader now, so nothing hitches when it first scrolls into view
  for (const [i, t] of signs.textures.entries()) {
    renderer.initTexture(t);
    if (i % 4 === 3) await yieldToMain();
  }
  if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
  else renderer.compile(scene, camera);
  const onResize = () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 120); };
  const onVisibility = () => { last = performance.now(); };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start() { if (!state.running) { state.running = true; last = performance.now(); raf = requestAnimationFrame(loop); } },
    stop() { state.running = false; cancelAnimationFrame(raf); },
    setProgress(p) { state.target = p; },
    jump(p) { state.target = state.p = p; state.dirty = true; },
    pointer(x, y) { state.mx = x; state.my = y; },
    glitch(a) { state.glitch = Math.max(state.glitch, a); },
    setVisible(v) { if (v && !state.visible) last = performance.now(); state.visible = v; state.dirty = true; },
    renderOnce() { frame(0.016); },
    get mode() { return mode; },
    destroy() {
      state.running = false;
      cancelAnimationFrame(raf);
      clearTimeout(resize.t);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      composer.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
