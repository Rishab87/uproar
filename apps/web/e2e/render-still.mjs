// Renders the city's still image, used in the app's gutters and as the no-WebGL fallback.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? 'public/city-still.jpg';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__cityReady === true, null, { timeout: 180000 });
await page.addStyleTag({ content: '.landing main, .landing-bar, .landing-foot { visibility: hidden !important; } .city-canvas { transition: none !important; opacity: 1 !important; }' });
// Fly a little way down the avenue, where the street and the signs fill the frame.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.1));
await page.waitForTimeout(6000);
await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
await browser.close();
console.log('wrote', out);
