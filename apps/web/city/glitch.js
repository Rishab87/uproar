// The final pass. At rest: a faint LED sub-pixel texture, grain and vignette.
// In a burst: slice tears, RGB split and corrupted blocks.
export const GlitchShader = {
  name: 'GlitchShader',
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    uniform float uSeed;
    varying vec2 vUv;
    float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = vUv;
      float a = uAmount;
      // slice tears
      float rows = 14. + floor(h11(uSeed) * 34.);
      float row = floor(uv.y * rows);
      float tear = step(.62, h11(row * 7.13 + uSeed * 3.7));
      uv.x += (h11(row * 1.7 + uSeed) - .5) * .14 * a * tear;
      // RGB split, faint even at rest
      float s = .0007 + .016 * a;
      vec3 col = vec3(texture2D(tDiffuse, uv + vec2(s, 0.)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(s, 0.)).b);
      // corrupted blocks
      vec2 blk = floor(uv * vec2(22., 13.));
      if (a > .02 && h21(blk + uSeed * 9.1) > 1. - .07 * a) col = vec3(col.r * 1.7 + .2, col.g * .15, col.b * 1.5 + .1);
      // bright scan streaks
      float streak = step(.9965 - .012 * a, h11(floor(gl_FragCoord.y * .5) + floor(uSeed * 40.)));
      col += streak * a * vec3(1., .25, .75);
      // LED sub-pixels: barely there, gives the image a screen
      float px = mod(gl_FragCoord.x, 3.);
      vec3 mask = vec3(px < 1. ? 1. : .95, (px >= 1. && px < 2.) ? 1. : .95, px >= 2. ? 1. : .95);
      col *= mask;
      // grain and vignette
      col += (h21(gl_FragCoord.xy + fract(uTime) * 917.) - .5) * .035;
      vec2 q = vUv - .5;
      col *= 1. - dot(q, q) * .62;
      gl_FragColor = vec4(col, 1.);
    }`,
};
