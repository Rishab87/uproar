import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { keyFromSeed, type TestKey } from './keys';

const here = dirname(fileURLToPath(import.meta.url));
const walletSource = readFileSync(join(here, 'mock-wallet.js'), 'utf8');

export const RPC = 'http://127.0.0.1:8899';
export const WALLET_NAME = 'Test Wallet';

export async function airdrop(address: string, sol = 3): Promise<void> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [address, sol * 1_000_000_000] }) });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (!body.result) throw new Error(`airdrop failed: ${body.error?.message}`);
  for (let i = 0; i < 60; i++) {
    const s = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[body.result]] }) });
    const j = (await s.json()) as { result: { value: ({ confirmationStatus: string } | null)[] } };
    const st = j.result.value[0]?.confirmationStatus;
    if (st === 'confirmed' || st === 'finalized') return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('airdrop did not confirm');
}

export type User = { key: TestKey; context: BrowserContext; page: Page; errors: string[]; handle: string };

/** A browser context with a real wallet injected. Console errors and CSP violations are collected. */
export async function newUser(browser: Browser, opts: { key?: TestKey; country?: string; handle?: string; viewport?: { width: number; height: number } } = {}): Promise<User> {
  const key = opts.key ?? keyFromSeed(randomBytes(32).toString('hex'));
  const context = await browser.newContext({
    ...(opts.country ? { extraHTTPHeaders: { 'x-vercel-ip-country': opts.country } } : {}),
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
  });
  await context.addInitScript(walletSource.replace('__MOCK_WALLET_CONFIG__', JSON.stringify({ ...key, chains: ['solana:localnet'], name: WALLET_NAME, autoConnect: false })));
  const page = await context.newPage();
  settleOnNavigation(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return { key, context, page, errors, handle: opts.handle ?? `u${randomBytes(4).toString('hex')}` };
}

/**
 * Like a person, wait for the page to know who you are before acting: the app marks
 * <html data-viewer="settled"> once the profile and session key are loaded.
 */
export function settleOnNavigation(page: Page): void {
  const settle = () =>
    page.waitForSelector('html[data-viewer="settled"]', { state: 'attached', timeout: 20_000 }).then(
      () => undefined,
      () => console.warn(`page never settled: ${page.url()}`),
    );
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = (async (...args: Parameters<Page['goto']>) => { const res = await goto(...args); await settle(); return res; }) as Page['goto'];
  page.reload = (async (...args: Parameters<Page['reload']>) => { const res = await reload(...args); await settle(); return res; }) as Page['reload'];
}

/**
 * Errors a test run expects from the browser itself rather than from the app. WebKit reports a
 * same-origin fetch that a navigation cut short as an "access control" failure. A real CSP or
 * cross-origin block reads differently ("Refused to connect"), so it still fails the test.
 */
export function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !/Failed to load resource: the server responded with a status of (4\d\d)/.test(e) &&
      !/WebGL|GPU stall|GL Driver/.test(e) &&
      !/^pageerror: \/localhost:\d+\/[^ ]* due to access control checks\.$/.test(e),
  );
}

export const approvals = (page: Page) => page.evaluate(() => (window as unknown as { __mockWallet: { approvals: number } }).__mockWallet.approvals);

export async function connect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await page.getByRole('button', { name: WALLET_NAME }).click();
}

/** Connects unless this browser is already connected, which the app remembers between pages. */
export async function ensureConnected(page: Page): Promise<void> {
  const input = page.getByLabel('Your name');
  const button = page.getByRole('button', { name: 'Connect wallet' }).first();
  await expect(input.or(button)).toBeVisible();
  if (await button.isVisible()) await connect(page);
  await expect(input).toBeVisible();
}

/**
 * The full onboarding through the real UI: one wallet approval makes a profile, a name and a session.
 * With `faucet`, the wallet starts empty and gets its SOL from the claim page's "Get free test SOL".
 */
export async function claim(user: User, opts: { faucet?: boolean } = {}): Promise<void> {
  const { page, handle } = user;
  if (!opts.faucet) await airdrop(user.key.address);
  await page.goto('/claim');
  await ensureConnected(page);
  // WebKit under heavy load sometimes reverts one instant fill. Someone typing never sees that, so type again.
  const input = page.getByLabel('Your name');
  await expect(async () => {
    if ((await input.inputValue()) !== handle) await input.fill(handle);
    await expect(page.getByText(`@${handle} is free.`)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.getByText('Total from your wallet')).toBeVisible();
  if (opts.faucet) {
    const tap = page.getByRole('button', { name: 'Get free test SOL' });
    await tap.click();
    await expect(tap).toBeHidden({ timeout: 45_000 });
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: `Claim @${handle}` }).click();
  await expect(page.getByTestId('claim-done')).toBeVisible({ timeout: 60_000 });
  expect(await approvals(page)).toBe(1);
}

/** Posts through a composer, accepting the first-post consent if it is asked for. */
export async function postFromComposer(page: Page, text: string, scope: Page | ReturnType<Page['getByRole']> = page): Promise<void> {
  await scope.getByLabel('Post text').first().fill(text);
  const consent = scope.getByRole('checkbox', { name: /18 or older/ });
  if (await consent.count()) await consent.first().check();
  await scope.getByRole('button', { name: /^(Post|Reply)$/ }).last().click();
}

/** Waits for a post to appear on the page, proving the chain-to-index round trip worked. */
export async function expectPost(page: Page, text: string): Promise<void> {
  await expect(page.locator('.post-text', { hasText: text }).first()).toBeVisible({ timeout: 45_000 });
}

export async function sigOfPost(page: Page, text: string): Promise<string> {
  const href = await page.locator('article.post', { hasText: text }).first().locator('a.post-time').getAttribute('href');
  if (!href) throw new Error('post link not found');
  return href.split('/post/')[1] as string;
}
