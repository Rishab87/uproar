/**
 * Post-deploy check of a live devnet deployment: real wallets, real transactions, the real indexer
 * and the real database. Two throwaway people claim names, post, reply, like, repost, follow, get
 * notified, edit a profile, pin, search and delete. Then it cleans up after itself: posts deleted,
 * names released for their deposits, and the SOL sent back to the funder. Refuses mainnet.
 *
 *   cd apps/web && SMOKE_URL=https://uproar-app.vercel.app SMOKE_RPC='<devnet rpc url>' pnpm exec tsx scripts/smoke-devnet.ts
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { settleOnNavigation } from '../e2e/helpers';
import { keyFromSeed, type TestKey } from '../e2e/keys';

const BASE = process.env.SMOKE_URL ?? 'https://uproar-app.vercel.app';
const RPC = process.env.SMOKE_RPC ?? 'https://api.devnet.solana.com';
const FUNDER = (process.env.SMOKE_FUNDER ?? '~/.config/solana/uproar/deployer.json').replace(/^~/, homedir());
const SOLANA = join(homedir(), '.local/share/solana/install/active_release/bin/solana');
if (/mainnet/i.test(BASE + RPC)) throw new Error('This check writes to the chain, so it only runs against devnet.');

const walletSource = readFileSync(new URL('../e2e/mock-wallet.js', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'uproar-smoke-'));
const tag = randomBytes(3).toString('hex');
const t0 = Date.now();
const log = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`);

type Person = { key: TestKey; file: string; context: BrowserContext; page: Page; handle: string; errors: string[]; claimed: boolean };

const solana = (args: string[]) => execFileSync(SOLANA, [...args, '-u', RPC, '--commitment', 'confirmed'], { encoding: 'utf8' });
const funderAddress = execFileSync(join(homedir(), '.local/share/solana/install/active_release/bin/solana-keygen'), ['pubkey', FUNDER], { encoding: 'utf8' }).trim();

async function balance(address: string): Promise<number> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }) });
  return ((await res.json()) as { result: { value: number } }).result.value;
}

async function person(browser: Browser, label: string): Promise<Person> {
  const seed = randomBytes(32);
  const key = keyFromSeed(seed.toString('hex'));
  const file = join(dir, `${label}.json`);
  writeFileSync(file, JSON.stringify([...seed, ...Buffer.from(key.publicKey, 'base64')]), { mode: 0o600 });
  solana(['transfer', '--from', FUNDER, '--fee-payer', FUNDER, key.address, '0.03', '--allow-unfunded-recipient']);
  const context = await browser.newContext({ baseURL: BASE });
  await context.addInitScript(walletSource.replace('__MOCK_WALLET_CONFIG__', JSON.stringify({ ...key, chains: ['solana:devnet'], name: 'Test Wallet', autoConnect: false })));
  const page = await context.newPage();
  settleOnNavigation(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { key, file, context, page, handle: `chk${label}_${tag}`, errors, claimed: false };
}

async function claim(p: Person) {
  await p.page.goto('/claim');
  await p.page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await p.page.getByRole('button', { name: 'Test Wallet' }).click();
  const input = p.page.getByLabel('Your name');
  await expect(async () => {
    if ((await input.inputValue()) !== p.handle) await input.fill(p.handle);
    await expect(p.page.getByText(`@${p.handle} is free.`)).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 45_000 });
  await expect(p.page.getByText('Total from your wallet')).toBeVisible({ timeout: 30_000 });
  await p.page.getByRole('checkbox').check();
  await p.page.getByRole('button', { name: `Claim @${p.handle}` }).click();
  await expect(p.page.getByTestId('claim-done')).toBeVisible({ timeout: 90_000 });
  p.claimed = true;
}

/** Waits until the public API serves the post, so it's confirmed on chain and indexed. */
async function indexed(sig: string, text: string) {
  await expect(async () => {
    const res = await fetch(`${BASE}/api/post/${sig}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(text);
  }).toPass({ timeout: 60_000, intervals: [1_000] });
}

async function compose(page: Page, text: string): Promise<string> {
  await page.getByLabel('Post text').first().fill(text);
  const consent = page.getByRole('checkbox', { name: /18 or older/ });
  if (await consent.count()) await consent.first().check();
  await page.getByRole('button', { name: /^(Post|Reply)$/ }).last().click();
  const link = page.locator('article.post', { hasText: text }).first().locator('a.post-time');
  await expect(link).toHaveAttribute('href', /\/post\//, { timeout: 45_000 });
  const sig = ((await link.getAttribute('href')) as string).split('/post/')[1] as string;
  await indexed(sig, text);
  return sig;
}

async function pageHas(path: string, text: string, timeout = 45_000) {
  await expect(async () => {
    expect(await (await fetch(`${BASE}${path}`)).text()).toContain(text);
  }).toPass({ timeout, intervals: [1_500] });
}

async function deletePost(p: Person, sig: string, text: string) {
  await p.page.goto(`/post/${sig}`);
  p.page.once('dialog', (d) => void d.accept());
  await p.page.locator('.post-focus').getByRole('button', { name: 'More' }).click();
  await p.page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(p.page.getByText('The author deleted this post.').first()).toBeVisible({ timeout: 45_000 });
  await expect(async () => {
    expect(await (await fetch(`${BASE}/api/post/${sig}`)).text()).not.toContain(text);
  }).toPass({ timeout: 45_000, intervals: [1_500] });
}

async function release(p: Person) {
  const before = await balance(p.key.address);
  await p.page.goto('/settings');
  p.page.once('dialog', (d) => void d.accept());
  await p.page.getByRole('button', { name: 'Release this name' }).click();
  await expect(p.page.getByText('Handle released. Your deposit and rent are back in your wallet.')).toBeVisible({ timeout: 60_000 });
  const gained = (await balance(p.key.address)) - before;
  if (gained < 10_000_000) throw new Error(`@${p.handle}: release returned only ${gained} lamports`);
  p.claimed = false;
  log(`released @${p.handle}, ${(gained / 1e9).toFixed(5)} SOL back in the wallet`);
}

async function main() {
  const browser = await chromium.launch();
  const people: Person[] = [];
  const made: { p: () => Person; sig: string; text: string }[] = [];
  let ok = false;
  try {
    const a = await person(browser, 'a');
    const b = await person(browser, 'b');
    people.push(a, b);
    log(`funded two throwaway wallets from ${funderAddress}`);

    await claim(a);
    log(`@${a.handle} claimed with one wallet approval`);
    await claim(b);
    log(`@${b.handle} claimed`);

    await a.page.goto('/home');
    const first = `devnet check ${tag}: first post on chain #chk${tag}`;
    const firstSig = await compose(a.page, first);
    made.push({ p: () => a, sig: firstSig, text: first });
    log('posted, confirmed on chain, indexed and served by the API');

    await b.page.goto(`/post/${firstSig}`);
    const focus = b.page.locator('.post-focus');
    await focus.getByRole('button', { name: /^Like/ }).click();
    await expect(focus.getByRole('button', { name: /^Like/ })).toHaveAttribute('aria-pressed', 'true');
    await focus.getByRole('button', { name: /^Repost/ }).click();
    await expect(focus.getByRole('button', { name: /^Repost/ })).toHaveAttribute('aria-pressed', 'true');
    const reply = `devnet check ${tag}: a reply`;
    const replySig = await compose(b.page, reply);
    made.push({ p: () => b, sig: replySig, text: reply });
    await b.page.goto(`/@${a.handle}`);
    await b.page.locator('.profile-actions').getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(b.page.locator('.profile-actions').getByRole('button', { name: /Following|Unfollow/ })).toBeVisible();
    await expect(async () => {
      const res = await fetch(`${BASE}/api/profile/${a.handle}`);
      const body = (await res.json()) as { profile?: { followers?: number }; followers?: number };
      expect(body.profile?.followers ?? body.followers).toBe(1);
    }).toPass({ timeout: 60_000, intervals: [1_000] });
    log('second person liked, reposted, replied and followed, with no wallet popups');

    await expect(async () => {
      const res = await fetch(`${BASE}/api/post/${firstSig}`);
      const { post } = (await res.json()) as { post: { likes: number; reposts: number; replies: number } };
      expect([post.likes, post.reposts, post.replies]).toEqual([1, 1, 1]);
    }).toPass({ timeout: 60_000, intervals: [1_500] });
    log('counts on chain-built index: 1 like, 1 repost, 1 reply');

    await a.page.goto('/notifications');
    for (const text of ['liked your post', 'reposted your post', 'followed you']) {
      await expect(a.page.getByText(text).first()).toBeVisible({ timeout: 60_000 });
    }
    await expect(a.page.locator('.post-text', { hasText: reply }).first()).toBeVisible();
    log('notifications: like, repost, follow and reply all arrived');

    await a.page.goto(`/@${a.handle}`);
    await a.page.getByRole('button', { name: 'Edit profile' }).click();
    const dialog = a.page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(`Check ${tag}`);
    await dialog.getByLabel('Bio').fill('Automated devnet check. This profile releases its name when done.');
    await dialog.getByRole('button', { name: 'Save profile' }).click();
    await expect(a.page.getByText('Profile updated.')).toBeVisible({ timeout: 60_000 });
    await pageHas(`/@${a.handle}`, `Check ${tag}`);
    log('profile edit is on chain and visible to everyone');

    await a.page.goto(`/@${a.handle}`);
    await a.page.locator('article.post', { hasText: first }).first().getByRole('button', { name: 'More' }).click();
    await a.page.getByRole('menuitem', { name: 'Pin to profile' }).click();
    await expect(a.page.getByText('Pinned to your profile.')).toBeVisible({ timeout: 60_000 });
    await pageHas(`/@${a.handle}`, 'Pinned');
    log('pinned post shows on the public profile');

    await pageHas(`/api/search?q=${tag}`, first);
    await pageHas(`/tag/chk${tag}`, first);
    log('search and the hashtag page find the post');

    for (const m of [...made].reverse()) {
      await deletePost(m.p(), m.sig, m.text);
      made.splice(made.indexOf(m), 1);
    }
    await pageHas(`/post/${firstSig}`, 'The author deleted this post.');
    log('deleting hides both posts everywhere, with a tombstone at the link');

    for (const p of people) {
      const real = p.errors.filter((e) => !/Failed to load resource|access control checks/.test(e));
      if (real.length) throw new Error(`browser errors for @${p.handle}: ${real.join(' | ')}`);
    }
    ok = true;
  } catch (error) {
    for (const [i, p] of people.entries()) await p.page.screenshot({ path: join(dir, `fail-${i}.png`) }).catch(() => {});
    console.error(`FAILED: ${(error as Error).message.split('\n').slice(0, 8).join(' ')}`);
    console.error(`screenshots in ${dir}`);
  } finally {
    // Leave nothing behind: posts, names, SOL.
    for (const m of made) await deletePost(m.p(), m.sig, m.text).catch((e) => console.error('cleanup delete failed', e.message));
    for (const p of people) if (p.claimed) await release(p).catch((e) => console.error('cleanup release failed', e.message));
    for (const p of people) {
      try {
        solana(['transfer', '--from', p.file, '--fee-payer', p.file, funderAddress, 'ALL', '--allow-unfunded-recipient']);
      } catch (e) {
        console.error(`could not return SOL from ${p.key.address}: ${(e as Error).message.split('\n')[0]}`);
      }
      await p.context.close();
    }
    await browser.close();
    if (ok) rmSync(dir, { recursive: true, force: true });
    log(ok ? 'PASS: everything above happened on devnet, and the test data is cleaned up' : 'FAIL');
    process.exit(ok ? 0 : 1);
  }
}

void main();
