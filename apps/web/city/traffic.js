// Traffic: air lanes over the city, and two streams of cars on the avenue (red going, white coming).
import * as THREE from './vendor/three.js';
import { mulberry } from './layout.js';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Bodies: a low hull and a cabin in one geometry. Front is local -z.
function merge(geos) {
  const pos = [];
  const nor = [];
  const idx = [];
  let off = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  out.setIndex(idx);
  return out;
}
function hull(len, wid, h, lift, cabLen, cabWid, cabH, cabZ) {
  const body = new THREE.BoxGeometry(wid, h, len);
  body.translate(0, lift + h / 2, 0);
  const cab = new THREE.BoxGeometry(cabWid, cabH, cabLen);
  cab.translate(0, lift + h + cabH / 2, cabZ);
  return merge([body, cab]);
}

const VEHICLE_VERT = /* glsl */ `
attribute vec4 aCar; // length, width, flyer, tint
varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying vec4 vCar;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vCar = aCar;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const VEHICLE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying vec4 vCar;
void main() {
  vec3 n = normalize(vN);
  float len = vCar.x; float wid = vCar.y; float flyer = vCar.z;
  vec3 tint = vCar.w < .34 ? vec3(1., .12, .55) : (vCar.w < .67 ? vec3(.15, .85, 1.) : vec3(.85, .9, 1.));
  // dark paint catching the city: cool from the sky, magenta bounced off the wet street
  vec3 col = vec3(.008, .009, .013) + vec3(.035, .055, .09) * max(n.y, 0.) + vec3(.06, .018, .05) * (1. - abs(n.y));
  bool side = abs(n.y) < .5;
  // a neon trim line along the sills
  float sill = 1. - smoothstep(.015, .05, abs(vLocal.y - (flyer > .5 ? .5 : .46)));
  if (side) col += tint * sill * 1.1;
  // lamps: white pair at the front, a full-width red strip at the back
  float band = step(.52, vLocal.y) * step(vLocal.y, .74);
  if (flyer > .5) band = step(.38, vLocal.y) * step(vLocal.y, .62);
  float front = step(len * .5 - .03, -vLocal.z);
  float back = step(len * .5 - .03, vLocal.z);
  float corners = step(wid * .5 - .45, abs(vLocal.x));
  col += vec3(3., 2.8, 2.4) * front * band * corners;
  col += vec3(3.2, .12, .18) * back * band;
  // flyers glow underneath
  if (flyer > .5 && n.y < -.5) col += tint * 1.6;
  float dist = length(vWorld - cameraPosition);
  float f = 1. - exp(-pow(uFogDensity * dist, 2.));
  gl_FragColor = vec4(mix(col, uFog, clamp(f, 0., 1.)), 1.);
}`;

export function buildTraffic({ low, fog }) {
  const R = mulberry(9001);
  const group = new THREE.Group();
  const dot = dotTexture();

  // air: lanes at different heights, east-west and north-south
  const lanes = [];
  for (let i = 0; i < 10; i++) {
    const ew = i % 2 === 0;
    lanes.push({ ew, y: 58 + R() * 170, at: ew ? -160 - R() * 1500 : (R() - 0.5) * 700, dir: R() < 0.5 ? 1 : -1 });
  }
  const AIR = low ? 46 : 100;
  const air = Array.from({ length: AIR }, () => {
    const lane = lanes[Math.floor(R() * lanes.length)];
    return { lane, s: (R() - 0.5) * 3200, v: (24 + R() * 34) * lane.dir, dy: (R() - 0.5) * 10, dx: (R() - 0.5) * 16 };
  });
  // street: going away on the right (tail lights), coming on the left (headlights)
  const CARS = low ? 50 : 120;
  const cars = Array.from({ length: CARS }, () => {
    const away = R() < 0.5;
    return { away, x: (away ? 1 : -1) * (2.6 + Math.floor(R() * 3) * 3.4), z: 100 - R() * 1000, v: 11 + R() * 9 };
  });

  const vehicleMat = new THREE.ShaderMaterial({
    vertexShader: VEHICLE_VERT,
    fragmentShader: VEHICLE_FRAG,
    uniforms: { uFog: { value: fog.color }, uFogDensity: { value: fog.density } },
  });
  const CAR_LEN = 4.6;
  const carGeo = hull(CAR_LEN, 1.9, 0.72, 0.3, 2.3, 1.7, 0.52, 0.3);
  const flyGeo = hull(5.4, 2.5, 0.95, 0, 2.2, 1.7, 0.6, 0.6);
  const attr = (count, fill) => {
    const a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) a.set(fill(i), i * 4);
    return new THREE.InstancedBufferAttribute(a, 4);
  };
  carGeo.setAttribute('aCar', attr(CARS, () => [CAR_LEN, 1.9, 0, R()]));
  flyGeo.setAttribute('aCar', attr(AIR, () => [5.4, 2.5, 1, R()]));
  const carBodies = new THREE.InstancedMesh(carGeo, vehicleMat, CARS);
  const flyBodies = new THREE.InstancedMesh(flyGeo, vehicleMat, AIR);
  carBodies.frustumCulled = false;
  flyBodies.frustumCulled = false;
  group.add(carBodies, flyBodies);
  const m4 = new THREE.Matrix4();

  const n = AIR * 2 + CARS * 2;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.7, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  mat.color.setScalar(2.6);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);

  // short light trails behind the flyers
  const tpos = new Float32Array(AIR * 2 * 3);
  const tcol = new Float32Array(AIR * 2 * 3);
  for (let i = 0; i < AIR; i++) tcol.set([1.6, 0.1, 0.2, 0, 0, 0], i * 6);
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  const trails = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  trails.frustumCulled = false;
  group.add(trails);

  const head = [0.85, 0.95, 1.0];
  const tail = [1.0, 0.08, 0.12];
  for (let i = 0; i < AIR; i++) {
    col.set(head, i * 6);
    col.set(tail, i * 6 + 3);
  }
  for (let i = 0; i < CARS; i++) {
    const c = cars[i].away ? [1.0, 0.06, 0.1] : [1.0, 0.9, 0.75];
    col.set(c, (AIR * 2 + i * 2) * 3);
    col.set(c, (AIR * 2 + i * 2 + 1) * 3);
  }

  const wrap = (s, lim) => ((((s + lim) % (lim * 2)) + lim * 2) % (lim * 2)) - lim;

  return {
    group,
    update(t, dt) {
      for (let i = 0; i < AIR; i++) {
        const a = air[i];
        a.s = wrap(a.s + a.v * dt, 1600);
        const L = a.lane;
        const dir = Math.sign(a.v);
        let x, z, tx, tz;
        if (L.ew) { x = a.s; z = L.at + a.dx; tx = x - dir * 3; tz = z; }
        else { x = L.at + a.dx; z = -700 + a.s; tx = x; tz = z - dir * 3; }
        const y = L.y + a.dy;
        const o = i * 6;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        pos[o + 3] = tx; pos[o + 4] = y; pos[o + 5] = tz;
        m4.makeRotationY(L.ew ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0));
        m4.setPosition(x, y - 0.6, z);
        flyBodies.setMatrixAt(i, m4);
        const k = 26;
        tpos[o] = tx; tpos[o + 1] = y; tpos[o + 2] = tz;
        tpos[o + 3] = L.ew ? tx - dir * k : tx; tpos[o + 4] = y; tpos[o + 5] = L.ew ? tz : tz - dir * k;
      }
      for (let i = 0; i < CARS; i++) {
        const c = cars[i];
        c.z += (c.away ? -c.v : c.v) * dt;
        if (c.z < -920) c.z += 1020;
        if (c.z > 100) c.z -= 1020;
        const j = (AIR * 2 + i * 2) * 3;
        // the lamps facing down the avenue: tail lights going away, headlights coming
        const lz = c.z + CAR_LEN / 2 + 0.1;
        pos[j] = c.x - 0.72; pos[j + 1] = 0.63; pos[j + 2] = lz;
        pos[j + 3] = c.x + 0.72; pos[j + 4] = 0.63; pos[j + 5] = lz;
        m4.makeRotationY(c.away ? 0 : Math.PI);
        m4.setPosition(c.x, 0, c.z);
        carBodies.setMatrixAt(i, m4);
      }
      carBodies.instanceMatrix.needsUpdate = true;
      flyBodies.instanceMatrix.needsUpdate = true;
      geo.attributes.position.needsUpdate = true;
      tgeo.attributes.position.needsUpdate = true;
    },
  };
}
