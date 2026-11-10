// Sky, searchlights and the red beacons on top of the tall towers.
import * as THREE from './vendor/three.js';

export function buildSky(fogColor) {
  const geo = new THREE.SphereGeometry(5200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uHorizon: { value: fogColor }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uHorizon;
      uniform float uTime;
      varying vec3 vDir;
      float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float y = clamp(vDir.y, 0., 1.);
        vec3 zenith = vec3(.004, .006, .012);
        vec3 col = mix(uHorizon * 1.15, zenith, pow(y, .55));
        // low cloud deck, lit from below by the city
        vec2 c = vDir.xz / max(.08, vDir.y) * 1.6;
        float cl = noise(c + uTime * .006) * .6 + noise(c * 2.3 - uTime * .004) * .4;
        float deck = smoothstep(.45, .85, cl) * (1. - smoothstep(.05, .5, y));
        col += vec3(.10, .03, .09) * deck * (1. - y * 1.6) + vec3(.02, .05, .07) * deck;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, update: (t) => { mat.uniforms.uTime.value = t; } };
}

export function buildBeams() {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(70, 1.5, 1600, 24, 1, true);
  geo.translate(0, 800, 0);
  const make = (color) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        vAlong = position.y / 1600.;
        vec4 w = modelMatrix * vec4(position, 1.);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor; varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        float core = pow(abs(dot(normalize(vN), normalize(vView))), 2.5);
        float fade = pow(1. - vAlong, 1.6) * smoothstep(0., .02, vAlong);
        gl_FragColor = vec4(uColor * core * fade * .16, 1.);
      }`,
  });
  const beams = [
    { x: -220, z: -1450, color: 0x9fe8ff, phase: 0 },
    { x: 260, z: -1700, color: 0xffd6f2, phase: 2.1 },
    { x: 60, z: -2100, color: 0x9fe8ff, phase: 4.2 },
  ].map((b) => {
    const m = new THREE.Mesh(geo, make(b.color));
    m.position.set(b.x, 260, b.z);
    group.add(m);
    return { m, phase: b.phase };
  });
  return {
    group,
    update: (t) => {
      for (const b of beams) {
        b.m.rotation.z = Math.sin(t * 0.11 + b.phase) * 0.42;
        b.m.rotation.x = Math.cos(t * 0.08 + b.phase) * 0.22 - 0.08;
      }
    },
  };
}

export function buildBeacons(boxes) {
  const tops = [];
  for (const b of boxes) if (b.y1 > 150 && (b.spire || b.w > 20)) tops.push([b.x, b.y1 + 1, b.z]);
  const pos = new Float32Array(tops.length * 3);
  const phase = new Float32Array(tops.length);
  tops.forEach((p, i) => { pos.set(p, i * 3); phase[i] = Math.random() * 6.28; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aPhase; uniform float uTime; uniform float uScale; varying float vOn;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vOn = step(.55, fract(uTime * .5 + aPhase));
        gl_PointSize = clamp(uScale * 4. / -mv.z, 2., 14.);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vOn;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, 0., d);
        gl_FragColor = vec4(vec3(3., .12, .16) * a * a * (.15 + .85 * vOn), 1.);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { mesh: points, update: (t, scale) => { mat.uniforms.uTime.value = t; mat.uniforms.uScale.value = scale; } };
}
