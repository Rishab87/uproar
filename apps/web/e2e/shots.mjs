// Screenshots of the main screens at desktop and phone sizes, in Chromium or WebKit, for review.
import { chromium, webkit } from '@playwright/test';
const [, , outDir, engine = 'chromium', base = 'http://localhost:3000', ...only] = process.argv;
const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'chromium' ? { args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } : {});
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const stats = await (await fetch(`${base}/api/recent-handles`)).json();
const handle = stats[0]?.handle ?? 'nobody';
const feed = await (await fetch(`${base}/api/feed?tab=latest`)).json();
const sig = feed.items.find((i) => i.post.replies > 0 || i.post.quotes > 0)?.post.sig ?? feed.items[0]?.post.sig;
const routes = [['home', '/home'], ['profile', `/@${handle}`], ['post', `/post/${sig}`], ['explore', '/explore'], ['claim', '/claim'], ['rules', '/rules'], ['report', '/report'], ['transparency', '/transparency'], ['landing', '/']];
for (const [size, viewport] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(size === 'phone' ? { hasTouch: true, isMobile: engine !== 'webkit' ? true : undefined } : {}) });
  for (const [name, path] of routes) {
    if (only.length && !only.includes(name)) continue;
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(name === 'landing' ? 9000 : 1500);
    await page.screenshot({ path: `${outDir}/${engine}-${size}-${name}.png` });
    if (errors.length) console.log(engine, size, name, 'ERRORS', errors.slice(0, 3));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('done');
