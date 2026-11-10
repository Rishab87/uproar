// The wet street: a planar reflection, roughened by puddles and ripples, with lane paint.
import * as THREE from './vendor/three.js';
import { Reflector } from './vendor/three.js';

const VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
#include <common>
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec3 uFog;
uniform float uFogDensity;
varying vec4 vUv;
varying vec3 vWorld;

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 p = vWorld.xz;
  float puddle = smoothstep(.45, .7, noise(p * .05) * .65 + noise(p * .17) * .35);
  vec2 rip = vec2(noise(p * 1.1 + uTime * .35), noise(p.yx * 1.1 - uTime * .3)) - .5;
  vec4 uv = vUv;
  uv.xy += rip * mix(.045, .008, puddle) * uv.w;
  vec3 refl = texture2DProj(tDiffuse, uv).rgb;
  // wet asphalt drags reflections into vertical streaks
  vec4 uv2 = uv; uv2.y += .018 * uv.w;
  vec4 uv3 = uv; uv3.y += .036 * uv.w;
  refl = refl * .5 + texture2DProj(tDiffuse, uv2).rgb * .3 + texture2DProj(tDiffuse, uv3).rgb * .2;
  vec3 col = vec3(.004, .005, .008) + refl * mix(.32, .9, puddle);
  // lane paint on the avenue
  float ax = abs(vWorld.x);
  float dash = step(.5, fract(vWorld.z / 9.));
  float lane = (1. - smoothstep(.08, .14, abs(ax - 5.5))) * dash + (1. - smoothstep(.06, .1, abs(ax - 12.6)));
  col += vec3(.05, .05, .055) * lane * step(ax, 13.) * (1. - puddle * .6);
  float dist = length(vWorld - cameraPosition);
  float fogF = 1. - exp(-pow(uFogDensity * dist, 2.));
  col = mix(col, uFog, clamp(fogF, 0., 1.));
  gl_FragColor = vec4(col, 1.);
}`;

export function buildStreet({ fog, resolution }) {
  const geo = new THREE.PlaneGeometry(9000, 9000);
  const street = new Reflector(geo, {
    clipBias: 0.003,
    textureWidth: resolution[0],
    textureHeight: resolution[1],
    color: 0xffffff,
    shader: {
      name: 'WetStreet',
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTime: { value: 0 },
        uFog: { value: fog.color },
        uFogDensity: { value: fog.density },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    },
  });
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0, -1200);
  return {
    mesh: street,
    update: (t) => { street.material.uniforms.uTime.value = t; },
    resize: (w, h) => street.getRenderTarget().setSize(w, h),
  };
}
