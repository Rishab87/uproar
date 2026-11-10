'use client';
import { useEffect, useRef, useState } from 'react';
import type { City } from '@/city/index';

function chooseTier(): 'high' | 'mid' | 'low' {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return coarse && small ? 'low' : weak ? 'mid' : 'high';
}

/**
 * Without GPU acceleration, WebGL runs in software: the city would draw a few frames a second and
 * every click on the page would wait seconds for it. Those browsers keep the still image instead.
 */
function hasFastWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl = (probe.getContext('webgl2', opts) ?? probe.getContext('webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

/**
 * The live city, flown by scrolling. If WebGL can't start, the page keeps its still image. It stops
 * rendering when hidden and backs off on slow devices.
 */
export function CityHero({ handles }: { handles: { handle: string; accent: number }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!hasFastWebGL()) {
      setFailed(true);
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let city: City | null = null;
    let cancelled = false;
    let lastY = scrollY;
    let lastT = performance.now();
    let lastGlitch = 0;

    const progress = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    };
    const onScroll = () => {
      if (!city) return;
      city.setProgress(progress());
      const block = document.getElementById('loud');
      if (block) {
        const r = block.getBoundingClientRect();
        const covered = (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / innerHeight;
        city.setVisible(covered < 0.55);
      }
      const now = performance.now();
      const speed = Math.abs(scrollY - lastY) / Math.max(1, now - lastT);
      lastY = scrollY;
      lastT = now;
      if (speed > 5 && now - lastGlitch > 900) {
        lastGlitch = now;
        city.glitch(0.28);
      }
    };
    const onPointer = (e: PointerEvent) => city?.pointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    const onVisibility = () => city?.setVisible(!document.hidden);
    // A press on a link or button gets the main thread at once: stop drawing the city. Links leave the
    // page anyway; for buttons (the wallet dialog) it starts again a moment later.
    const onPress = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!city || !target?.closest('a[href], button')) return;
      // A modified click opens a new tab and this page stays, so leave the city alone.
      const m = e as MouseEvent;
      if (m.metaKey || m.ctrlKey || m.shiftKey || m.altKey || (typeof m.button === 'number' && m.button > 0)) return;
      city.stop();
      // If the page is still here after a while (a dialog, or navigation that didn't happen), draw again.
      setTimeout(() => {
        if (!cancelled) city?.start();
      }, target.closest('a[href]') ? 4000 : 1500);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') onPress(e);
    };
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onKey, true);

    void (async () => {
      try {
        const { createCity } = await import('@/city/index.js');
        const built = await createCity(el, { tier: chooseTier(), reduced, handles, onGiveUp: () => { if (!cancelled) setFailed(true); } });
        if (cancelled) {
          built.destroy();
          return;
        }
        city = built;
        city.jump(progress());
        city.start();
        addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        if (!matchMedia('(pointer: coarse)').matches && !reduced) addEventListener('pointermove', onPointer, { passive: true });
        onScroll();
        requestAnimationFrame(() => {
          el.classList.add('is-ready');
          (window as unknown as { __cityReady?: boolean }).__cityReady = true;
          setTimeout(() => {
            city?.glitch(0.9);
            const shout = document.querySelector('.shout');
            if (shout && !reduced) {
              shout.classList.add('is-glitching');
              setTimeout(() => shout.classList.remove('is-glitching'), 340);
            }
          }, 700);
        });
      } catch (error) {
        console.error('The city did not start:', error);
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      removeEventListener('scroll', onScroll);
      removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey, true);
      city?.destroy();
    };
  }, [handles]);

  if (failed) return null;
  return <canvas ref={canvas} className="city-canvas" aria-hidden="true" />;
}
