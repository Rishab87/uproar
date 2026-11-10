// Every building in one instanced draw call. Windows, shopfronts and edge neon are procedural,
// computed per pixel from world position so stacked tiers line up and nothing needs a texture.
import * as THREE from './vendor/three.js';

const VERT = /* glsl */ `
attribute vec4 aBox;   // w, h, d, style
attribute vec4 aLook;  // seed, lit, edge, tint
attribute float aShop;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vN;
varying vec4 vBox;
varying vec4 vLook;
varying float vShop;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position * aBox.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vBox = aBox;
  vLook = aLook;
  vShop = aShop;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uFog;
uniform float uFogDensity;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vN;
varying vec4 vBox;
varying vec4 vLook;
varying float vShop;

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec3 n = normalize(vN);
  float style = vBox.w;
  float seed = vLook.x;
  float litP = vLook.y;
  bool side = abs(n.y) < 0.5;
  // light that bounces up off a wet, lit street
  vec3 col = vec3(0.010, 0.012, 0.018) + vec3(0.040, 0.012, 0.050) * exp(-vWorld.y / 26.0);

  if (side) {
    bool xFace = abs(n.x) > 0.5;
    float faceId = xFace ? (n.x > 0. ? 1. : 2.) : (n.z > 0. ? 3. : 4.);
    float u = (xFace ? vWorld.z : vWorld.x) + seed * 3.0;
    float v = vWorld.y;

    vec2 cell; vec2 win;
    if (style < 0.5)      { cell = vec2(3.4, 3.9); win = vec2(.70, .58); }
    else if (style < 1.5) { cell = vec2(1.7, 4.1); win = vec2(.90, .74); }
    else if (style < 2.5) { cell = vec2(2.7, 3.1); win = vec2(.48, .50); }
    else                  { cell = vec2(7.0, 5.2); win = vec2(.22, .16); }
    vec2 g = vec2(u, v) / cell;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 aa = fwidth(g);
    vec2 d = abs(f - vec2(.5, .55)) - win * .5;
    float inside = (1. - smoothstep(-aa.x, aa.x, d.x)) * (1. - smoothstep(-aa.y, aa.y, d.y));

    // glass towers light up in long runs; everything else window by window
    vec2 lid = (style > 0.5 && style < 1.5) ? vec2(floor(id.x / 6.), id.y) : id;
    float r = h21(lid + seed * 1.37 + faceId * 19.1);
    float band = h21(vec2(id.y * 1.3, seed + faceId));
    float lit = step(r, litP) * step(.16, band);
    float t = h21(lid * 1.71 + seed);
    vec3 cool = vec3(.62, .80, 1.0);
    vec3 warm = vec3(1.0, .62, .30);
    vec3 cyan = vec3(.25, .92, 1.0);
    vec3 pink = vec3(1.0, .22, .62);
    vec3 wc = (style > 1.5 && style < 2.5) ? mix(warm, pink, step(.88, t)) : mix(cool, cyan, step(.8, t));
    wc = mix(wc, warm, step(.6, t) * step(t, .72) * step(style, 1.5));
    wc = mix(wc, pink, step(.982, t));
    float inten = (.25 + .75 * h21(lid + 9.1)) * lit;
    // inside the window: brighter under the ceiling, a mullion down the middle, blinds on some
    float ceiling = mix(.55, 1.15, smoothstep(.15, .95, (f.y - (.55 - win.y * .5)) / win.y));
    float mullion = (style < 0.5) ? (1. - .75 * (1. - smoothstep(0., .03, abs(f.x - .5)))) : 1.;
    float blind = step(.72, h21(lid + 5.7)) * step(.5, fract((f.y - .2) * 9.));
    inten *= ceiling * mullion * (1. - blind * .55);
    // a slow flicker on the odd window
    inten *= 1. - .6 * step(.996, h21(lid + 3.3)) * step(.5, fract(uTime * .7 + t * 9.));
    // far away the grid goes sub-pixel: fade to its average so it never shimmers
    float lod = smoothstep(.35, .95, max(aa.x, aa.y));
    float glow = mix(inside * inten, litP * .5 * win.x * win.y, lod);
    col += wc * glow * .9;
    // unlit glass: a faint wash of the street's neon, stronger low down
    float glass = inside * (1. - lit) * (1. - lod);
    col += mix(vec3(.02, .035, .06), vec3(.07, .02, .06), smoothstep(60., 0., v)) * glass;
    if (style > 0.5 && style < 1.5) col += vec3(.012, .03, .05) * (1. - inside) * (1. - lod);

    // shopfronts: the street is lit by the ground floor
    if (vShop > .5 && v < 6.2) {
      float sf = smoothstep(.4, 1.2, v) * (1. - smoothstep(5.0, 6.2, v));
      float mull = step(.08, fract(u / 3.6));
      vec3 sc = vLook.w < .33 ? vec3(1., .3, .62) : (vLook.w < .66 ? vec3(.3, .9, 1.) : vec3(1., .62, .34));
      col += sc * sf * mull * (.55 + 1.0 * h21(vec2(floor(u / 7.2), seed)));
    }

    // neon along the building's vertical edges
    if (vLook.z > .5) {
      vec2 halfSize = vBox.xz * .5;
      // distance to the nearest vertical corner, measured along this face only
      float e = xFace ? (halfSize.y - abs(vLocal.z)) : (halfSize.x - abs(vLocal.x));
      float strip = 1. - smoothstep(.15, .55, e);
      vec3 nc = vLook.z < 1.5 ? vec3(1., .14, .55) : (vLook.z < 2.5 ? vec3(.15, .88, 1.) : vec3(1., .16, .2));
      col += nc * strip * 3.2;
    }
  } else if (n.y > 0.5) {
    col = vec3(.008, .009, .013);
  }

  float dist = length(vWorld - cameraPosition);
  float fogF = 1. - exp(-pow(uFogDensity * dist, 2.));
  // the haze sits low: tall towers rise out of it
  fogF *= 1. - .45 * smoothstep(80., 520., vWorld.y);
  col = mix(col, uFog, clamp(fogF, 0., 1.));
  gl_FragColor = vec4(col, 1.);
}`;

export function buildTowers(boxes, fog) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const count = boxes.length;
  const aBox = new Float32Array(count * 4);
  const aLook = new Float32Array(count * 4);
  const aShop = new Float32Array(count);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: fog.color },
      uFogDensity: { value: fog.density },
    },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    const h = Math.max(0.5, b.y1 - b.y0);
    m.makeScale(b.w, h, b.d);
    m.setPosition(b.x, b.y0, b.z);
    mesh.setMatrixAt(i, m);
    aBox.set([b.w, h, b.d, b.style], i * 4);
    aLook.set([b.seed, b.lit, b.edge, b.tint], i * 4);
    aShop[i] = b.shop;
  });
  geo.setAttribute('aBox', new THREE.InstancedBufferAttribute(aBox, 4));
  geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(aLook, 4));
  geo.setAttribute('aShop', new THREE.InstancedBufferAttribute(aShop, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return { mesh, update: (t) => { mat.uniforms.uTime.value = t; } };
}
