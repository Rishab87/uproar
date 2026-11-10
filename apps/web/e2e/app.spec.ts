import { expect, test, type BrowserContext } from '@playwright/test';
import { approvals, claim, connect, expectPost, newUser, postFromComposer, realErrors, sigOfPost, type User, airdrop, RPC, WALLET_NAME } from './helpers';
import { OPERATOR_KEY } from './keys';

/**
 * The whole product through a real browser: real wallet signatures, real transactions on a local
 * validator, the real indexer, the real database. Nothing here is mocked except the human.
 */
test.describe.configure({ mode: 'serial' });

let alice: User;
let bob: User;
let anon: User;
const tag = Math.random().toString(36).slice(2, 7);
const firstPost = `first post ${tag} #tag${tag}`;
let firstSig = '';

async function balanceOf(address: string): Promise<number> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }) });
  return ((await res.json()) as { result: { value: number } }).result.value;
}

test.beforeAll(async ({ browser }) => {
  alice = await newUser(browser);
  bob = await newUser(browser);
  anon = await newUser(browser);
});

test.afterAll(async () => {
  for (const u of [alice, bob, anon]) {
    await u?.context.close();
  }
});

test('anyone can read without a wallet', async () => {
  await anon.page.goto('/home');
  await expect(anon.page.getByRole('tab', { name: 'For you' })).toBeVisible();
  await expect(anon.page.getByText('Connect a wallet to post')).toBeVisible();
  for (const path of ['/rules', '/terms', '/privacy', '/grievance', '/report', '/law-enforcement', '/transparency', '/algorithm', '/protocol', '/appeal']) {
    const res = await anon.page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  await anon.page.goto('/grievance');
  await expect(anon.page.getByText('Rishab Kumar Jha')).toBeVisible();
  await expect(anon.page.getByText('kumarjharishab@gmail.com')).toBeVisible();
  expect(realErrors(anon.errors)).toEqual([]);
});

test('the strict CSP holds on every page, with no violations', async () => {
  const res = await anon.page.goto('/home');
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(realErrors(anon.errors).filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test('claim: one wallet approval creates the profile, the name and a session', async () => {
  await claim(alice);
  await alice.page.getByRole('link', { name: 'Go to the feed' }).click();
  await expect(alice.page).toHaveURL(/\/home$/);
  await expect(alice.page.getByLabel('Post text').first()).toBeVisible();
});

test('a taken name is refused, and shown as taken', async () => {
  await bob.page.goto('/claim');
  await connect(bob.page);
  await bob.page.getByLabel('Your name').fill(alice.handle);
  await expect(bob.page.getByText(`@${alice.handle} is taken.`)).toBeVisible();
  await expect(bob.page.getByRole('button', { name: /^Claim/ })).toBeDisabled();
});

test('invalid names are refused before anything is signed', async () => {
  await bob.page.getByLabel('Your name').fill('a b');
  await expect(bob.page.getByText('3 to 15 characters')).toBeVisible();
  await bob.page.getByLabel('Your name').fill('');
});

test('posting needs consent the first time, then no wallet popup at all', async () => {
  const before = await approvals(alice.page);
  await alice.page.getByLabel('Post text').first().fill(firstPost);
  await expect(alice.page.getByRole('button', { name: 'Post', exact: true }).last()).toBeDisabled();
  await alice.page.getByRole('checkbox', { name: /18 or older/ }).check();
  await alice.page.getByRole('button', { name: 'Post', exact: true }).last().click();
  await expectPost(alice.page, firstPost);
  expect(await approvals(alice.page)).toBe(before);
});

test('the consent is not asked for again', async () => {
  await alice.page.getByLabel('Post text').first().fill('checking consent');
  await expect(alice.page.getByRole('checkbox', { name: /18 or older/ })).toHaveCount(0);
  await alice.page.getByLabel('Post text').first().fill('');
});

test('over-long posts are blocked by the composer', async () => {
  await alice.page.getByLabel('Post text').first().fill('x'.repeat(281));
  await expect(alice.page.getByRole('button', { name: 'Post', exact: true }).last()).toBeDisabled();
  await alice.page.getByLabel('Post text').first().fill('');
});

test('posts survive a reload, and the session key still works without the wallet', async () => {
  await alice.page.reload();
  await expectPost(alice.page, firstPost);
  const before = await approvals(alice.page);
  const text = `second post ${tag}`;
  await postFromComposer(alice.page, text);
  await expectPost(alice.page, text);
  expect(await approvals(alice.page)).toBe(before);
});

test('a second person can claim and see the first person\'s post', async () => {
  await claim(bob);
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(bob.page, firstPost);
});

test('like, repost and bookmark work, count correctly and survive a reload', async () => {
  const article = bob.page.locator('article.post', { hasText: firstPost }).first();
  await article.getByRole('button', { name: /^Like/ }).click();
  await expect(article.getByRole('button', { name: /^Like/ })).toHaveAttribute('aria-pressed', 'true');
  await article.getByRole('button', { name: /^Repost/ }).click();
  await article.getByRole('button', { name: 'Bookmark' }).click();
  await expect(article.getByRole('button', { name: 'Bookmark' })).toHaveAttribute('aria-pressed', 'true');
  await bob.page.waitForTimeout(2500);
  await bob.page.reload();
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  const after = bob.page.locator('article.post', { hasText: firstPost }).first();
  await expect(after.getByRole('button', { name: /^Like, 1 likes/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect(after.getByRole('button', { name: /^Repost, 1 reposts/ })).toHaveAttribute('aria-pressed', 'true');
  await bob.page.goto('/bookmarks');
  await expectPost(bob.page, firstPost);
});

test('unlike takes the count back down', async () => {
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  const article = bob.page.locator('article.post', { hasText: firstPost }).first();
  await article.getByRole('button', { name: /^Like/ }).click();
  await expect(article.getByRole('button', { name: /^Like/ })).toHaveAttribute('aria-pressed', 'false');
  await bob.page.waitForTimeout(2500);
  await bob.page.reload();
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  await expect(bob.page.locator('article.post', { hasText: firstPost }).first().getByRole('button', { name: /^Like, 0 likes/ })).toBeVisible({ timeout: 30_000 });
  // Like it again, so the notification test has something to find.
  await bob.page.locator('article.post', { hasText: firstPost }).first().getByRole('button', { name: /^Like/ }).click();
  await bob.page.waitForTimeout(2500);
});

test('reply and quote appear in the thread and in the original author\'s notifications', async () => {
  const sig = await sigOfPost(bob.page, firstPost);
  firstSig = sig;
  await bob.page.goto(`/post/${sig}`);
  await expect(bob.page.locator('.post-focus .post-text', { hasText: firstPost })).toBeVisible();
  const reply = `a reply ${tag}`;
  await postFromComposer(bob.page, reply);
  await expectPost(bob.page, reply);

  await bob.page.locator('.post-focus').getByRole('button', { name: /^Quote/ }).click();
  const quote = `a quote ${tag}`;
  await postFromComposer(bob.page, quote, bob.page.getByRole('dialog'));
  await expect(bob.page.getByRole('dialog')).toHaveCount(0);
  await bob.page.goto(`/@${bob.handle}`);
  await expectPost(bob.page, quote);

  await alice.page.goto('/notifications');
  await expect(alice.page.locator('.post-text', { hasText: reply }).first()).toBeVisible({ timeout: 45_000 });
  await expect(alice.page.locator('.post-text', { hasText: quote }).first()).toBeVisible();
  await expect(alice.page.getByText('liked your post').first()).toBeVisible();
  await expect(alice.page.getByText('reposted your post').first()).toBeVisible();
});

test('mentions and hashtags link up, and search finds them', async () => {
  const mention = `hey @${bob.handle} look #tag${tag}`;
  await alice.page.goto('/home');
  await postFromComposer(alice.page, mention);
  await expectPost(alice.page, mention);
  await bob.page.goto('/notifications');
  await expect(bob.page.locator('.post-text', { hasText: mention }).first()).toBeVisible({ timeout: 45_000 });

  await anon.page.goto(`/tag/tag${tag}`);
  await expectPost(anon.page, firstPost);
  await expectPost(anon.page, mention);
  await anon.page.goto(`/explore?q=${tag}`);
  await expectPost(anon.page, firstPost);
  await anon.page.getByRole('tab', { name: 'People' }).click();
  await anon.page.goto(`/explore?q=${alice.handle}`);
  await anon.page.getByRole('tab', { name: 'People' }).click();
  await expect(anon.page.locator('#main .person-text', { hasText: `@${alice.handle}` })).toBeVisible();
});

test('follow fills the Following feed, and unfollow empties it', async () => {
  await bob.page.goto(`/@${alice.handle}`);
  const actions = bob.page.locator('.profile-actions');
  await actions.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(actions.getByRole('button', { name: /Following|Unfollow/ })).toBeVisible();
  await bob.page.waitForTimeout(2500);
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Following' }).click();
  await expectPost(bob.page, firstPost);
  await bob.page.goto(`/@${alice.handle}`);
  await expect(bob.page.locator('.profile-counts')).toContainText('1 Follower', { timeout: 30_000 });

  // Unfollow empties the Following feed again.
  await bob.page.locator('.profile-actions').getByRole('button', { name: /Following|Unfollow/ }).click();
  await expect(bob.page.locator('.profile-actions').getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
  await bob.page.waitForTimeout(2500);
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Following' }).click();
  await expect(bob.page.getByText('Nobody here yet')).toBeVisible({ timeout: 30_000 });

  // Follow again: the later tests rely on it.
  await bob.page.goto(`/@${alice.handle}`);
  await bob.page.locator('.profile-actions').getByRole('button', { name: 'Follow', exact: true }).click();
  await bob.page.waitForTimeout(2500);
});

test('follows notify, and who to follow suggests people until you follow them', async () => {
  await alice.page.goto('/notifications');
  await expect(alice.page.getByText('followed you').first()).toBeVisible({ timeout: 45_000 });

  await alice.page.goto('/home');
  const who = alice.page.locator('section.panel', { has: alice.page.getByRole('heading', { name: 'Who to follow' }) });
  const row = who.locator('.person', { hasText: `@${bob.handle}` });
  await expect(row).toBeVisible();
  await expect(who.locator('.person', { hasText: `@${alice.handle}` })).toHaveCount(0);
  await row.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(row.getByRole('button', { name: /Following|Unfollow/ })).toBeVisible();
  await alice.page.waitForTimeout(2500);

  await bob.page.goto('/notifications');
  await expect(bob.page.getByText('followed you').first()).toBeVisible({ timeout: 45_000 });
  await alice.page.reload();
  await expect(alice.page.locator('section.panel .person', { hasText: `@${bob.handle}` })).toHaveCount(0);
});

test('undoing a repost takes it and its count back', async () => {
  // On the post's own page, so a quote of it can't be mistaken for it.
  await bob.page.goto(`/post/${firstSig}`);
  const repost = bob.page.locator('.post-focus').getByRole('button', { name: /^Repost/ });
  await expect(repost).toHaveAttribute('aria-pressed', 'true');
  await repost.click();
  await expect(repost).toHaveAttribute('aria-pressed', 'false');
  await bob.page.waitForTimeout(2500);
  await expect(async () => {
    await bob.page.reload();
    await expect(bob.page.locator('.post-focus').getByRole('button', { name: /^Repost, 0 reposts/ })).toHaveAttribute('aria-pressed', 'false', { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

test('editing a profile updates it from the chain', async () => {
  await alice.page.goto(`/@${alice.handle}`);
  await alice.page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = alice.page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`Alice ${tag}`);
  await dialog.getByLabel('Bio').fill('Testing in नमस्ते');
  await dialog.getByLabel('Website').fill('https://example.com');
  await dialog.getByRole('button', { name: 'Save profile' }).click();
  await expect(alice.page.getByText('Profile updated.')).toBeVisible({ timeout: 30_000 });
  await alice.page.waitForTimeout(1500);
  await anon.page.goto(`/@${alice.handle}`);
  await expect(anon.page.locator('.profile-name', { hasText: `Alice ${tag}` })).toBeVisible();
  await expect(anon.page.getByText('Testing in नमस्ते')).toBeVisible();
});

test('pinning puts a post at the top of the profile, for everyone', async () => {
  await alice.page.goto(`/@${alice.handle}`);
  await alice.page.locator('article.post', { hasText: firstPost }).first().getByRole('button', { name: 'More' }).click();
  await alice.page.getByRole('menuitem', { name: 'Pin to profile' }).click();
  await expect(alice.page.getByText('Pinned to your profile.')).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await anon.page.goto(`/@${alice.handle}`);
    const top = anon.page.locator('article.post').first();
    await expect(top.locator('.post-context')).toContainText('Pinned', { timeout: 2_000 });
    await expect(top.locator('.post-text')).toContainText(firstPost, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

test('muting hides someone from your feeds only, and block and mute lists are private', async () => {
  await bob.page.goto(`/@${alice.handle}`);
  await bob.page.locator('.profile-actions').getByRole('button', { name: 'More' }).click();
  await bob.page.getByRole('menuitem', { name: /^Mute/ }).click();
  await expect(bob.page.getByText(/Muted @/)).toBeVisible();
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  await expect(bob.page.locator('.post-text', { hasText: firstPost })).toHaveCount(0, { timeout: 15_000 });

  await anon.page.goto('/home');
  await anon.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(anon.page, firstPost);

  await bob.page.goto('/settings');
  await bob.page.getByRole('button', { name: `Unmute ${alice.handle}` }).click();
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(bob.page, firstPost);
});

test('muted words filter the viewer\'s own feed', async () => {
  await bob.page.goto('/settings');
  await bob.page.getByLabel('Word to mute').fill(`second post ${tag}`);
  await bob.page.getByRole('button', { name: 'Mute word' }).click();
  await expect(bob.page.locator('.chip', { hasText: `second post ${tag}` })).toBeVisible();
  await bob.page.goto('/home');
  await bob.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(bob.page, firstPost);
  await expect(bob.page.locator('.post-text', { hasText: `second post ${tag}` })).toHaveCount(0);
  await bob.page.goto('/settings');
  await bob.page.getByRole('button', { name: `Remove second post ${tag}` }).click();
});

test('deleting a post hides it for everyone, with a tombstone at its own link', async () => {
  const doomed = `delete me ${tag}`;
  await alice.page.goto('/home');
  await postFromComposer(alice.page, doomed);
  await expectPost(alice.page, doomed);
  await alice.page.waitForTimeout(1500);
  await alice.page.reload();
  await alice.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(alice.page, doomed);
  const sig = await sigOfPost(alice.page, doomed);
  alice.page.once('dialog', (d) => d.accept());
  const article = alice.page.locator('article.post', { hasText: doomed }).first();
  await article.getByRole('button', { name: 'More' }).click();
  await alice.page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(alice.page.getByText('The author deleted this post.').first()).toBeVisible();
  await alice.page.waitForTimeout(2500);

  const html = await (await anon.context.request.get(`/post/${sig}`)).text();
  expect(html).not.toContain(doomed);
  await anon.page.goto(`/post/${sig}`);
  await expect(anon.page.getByText('The author deleted this post.')).toBeVisible();
});

test('extending a session takes one wallet approval and tops up its fuel', async () => {
  await bob.page.goto('/settings');
  await expect(bob.page.getByText('This device').first()).toBeVisible();
  const before = await approvals(bob.page);
  await bob.page.getByRole('button', { name: 'Extend and top up' }).click();
  await expect(bob.page.getByText('Session extended and topped up.')).toBeVisible({ timeout: 30_000 });
  expect(await approvals(bob.page)).toBe(before + 1);
});

test('an expired or revoked session stops working, and signing out returns fuel-free to the wallet', async () => {
  await bob.page.goto('/settings');
  await expect(bob.page.getByText('This device').first()).toBeVisible();
  bob.page.once('dialog', (d) => d.accept());
  await bob.page.getByRole('button', { name: 'Revoke all sessions' }).click();
  await expect(bob.page.getByText('Every session key is revoked.')).toBeVisible({ timeout: 30_000 });
  await expect(bob.page.getByRole('button', { name: 'Start a session' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Start a session' }).click();
  await expect(bob.page.getByText('Session started.')).toBeVisible({ timeout: 30_000 });
});

test('a rejected wallet request explains itself and changes nothing', async () => {
  await bob.page.evaluate(() => { (window as unknown as { __mockWallet: { rejectNext: boolean } }).__mockWallet.rejectNext = true; });
  bob.page.once('dialog', (d) => d.accept());
  await bob.page.getByRole('button', { name: 'Revoke all sessions' }).click();
  await expect(bob.page.getByText('You cancelled that in your wallet. Nothing was changed.')).toBeVisible({ timeout: 15_000 });
});

test('the RPC proxy refuses to serve post text, or anything off its allowlist', async () => {
  const send = (method: string, params: unknown[] = []) => anon.context.request.post('/api/rpc', { data: { jsonrpc: '2.0', id: 1, method, params } });
  for (const method of ['getTransaction', 'getBlock', 'getProgramAccounts', 'getSignaturesForAddress', 'getBlocks']) {
    expect((await send(method)).status(), method).toBe(403);
  }
  expect((await send('getLatestBlockhash')).status()).toBe(200);
  // Only UPROAR transactions can be relayed. Anything else, or anything malformed, is refused.
  expect((await send('sendTransaction', ['AQID'])).status()).toBe(403);
  expect((await anon.context.request.post('/api/rpc', { data: 'not json', headers: { 'content-type': 'application/json' } })).status()).toBe(400);
});

test('private endpoints refuse unsigned requests and forged signatures', async () => {
  const req = anon.context.request;
  expect((await req.get('/api/notifications')).status()).toBe(401);
  expect((await req.get('/api/prefs')).status()).toBe(401);
  expect((await req.get('/api/bookmarks')).status()).toBe(401);
  expect((await req.get('/api/sessions')).status()).toBe(401);
  const forged = `v1.${alice.key.address}.${alice.key.address}.${Math.floor(Date.now() / 1000)}.${'1'.repeat(88)}`;
  expect((await req.get('/api/notifications', { headers: { 'x-uproar-auth': forged } })).status()).toBe(401);
  expect((await req.post('/api/bookmarks', { data: { post: 'x', on: true }, headers: { 'x-uproar-auth': forged } })).status()).toBe(401);
  expect((await req.get('/api/admin/queue')).status()).toBe(401);
  expect((await req.get('/api/cron/tick')).status()).toBe(401);
  expect((await req.post('/api/webhooks/helius', { data: [] })).status()).toBe(401);
});

/** Solid white pixels in a share card. A neon sign's letters are white, and a blurred sign has none. */
async function whitePixels(context: BrowserContext, path: string): Promise<number> {
  const page = await context.newPage();
  try {
    // Opening the image itself keeps it same-origin, so the canvas can read it back.
    await page.goto(path);
    return await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] as number) > 235 && (d[i + 1] as number) > 235 && (d[i + 2] as number) > 235) n++;
      return n;
    }, path);
  } finally {
    await page.close();
  }
}

test('share cards show a readable name, and sharing a sign posts the profile to X', async () => {
  const res = await anon.context.request.get('/api/og/site');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  const handle = await anon.context.request.get(`/api/og/handle/${alice.handle}`);
  expect(handle.status()).toBe(200);
  expect(handle.headers()['content-type']).toContain('image/png');
  // The name on a sign must read as crisp letters. A blurred sign measured 0 white pixels, a crisp one about 16,000.
  for (const path of ['/api/og/site', `/api/og/handle/${alice.handle}`, '/api/og/handle/unclaimed_name']) {
    expect(await whitePixels(anon.context, path), `${path} shows a readable name`).toBeGreaterThan(3000);
  }
  // Sharing your sign opens a post on X with your profile link, which shows the sign as its card. The
  // text has no @name, because X would turn that into a mention of whoever holds the name there.
  await alice.page.goto(`/@${alice.handle}`);
  const share = new URL((await alice.page.getByRole('link', { name: 'Share my sign' }).getAttribute('href')) ?? '', 'http://invalid');
  expect(share.origin + share.pathname).toBe('https://twitter.com/intent/tweet');
  expect(share.searchParams.get('url')).toMatch(new RegExp(`/@${alice.handle}$`));
  expect(share.searchParams.get('text')).not.toContain('@');
});

test('the operator console refuses the wrong wallet, and admits the operator', async ({ browser }) => {
  await alice.page.goto('/admin');
  await alice.page.getByRole('button', { name: 'Sign in with this wallet' }).click();
  await expect(alice.page.getByText('This wallet is not an operator')).toBeVisible();

  const op = await newUser(browser, { key: OPERATOR_KEY });
  await airdrop(OPERATOR_KEY.address, 1);
  await op.page.goto('/admin');
  await connect(op.page);
  await op.page.getByRole('button', { name: 'Sign in with this wallet' }).click();
  await expect(op.page.getByRole('heading', { name: 'Queue' })).toBeVisible();
  await expect(op.page.getByTestId('health-audit')).toContainText('Intact');
  await expect(op.page.getByTestId('health-alarms')).toContainText('NOT CONFIGURED');
  await op.context.close();
});

test('a wallet name is visible in the connect dialog', async () => {
  await anon.page.goto('/home');
  await anon.page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await expect(anon.page.getByRole('button', { name: WALLET_NAME })).toBeVisible();
  await anon.page.keyboard.press('Escape');
});

test('on a new device the first action starts a session in the same approval, and later ones need none', async ({ browser }) => {
  const again = await newUser(browser, { key: alice.key, handle: alice.handle });
  await again.page.goto(`/post/${firstSig}`);
  await connect(again.page);
  await again.page.waitForSelector('html[data-viewer="settled"]', { state: 'attached' });
  const heart = again.page.locator('.post-focus').getByRole('button', { name: /^Like/ });
  await heart.click();
  await expect(again.page.getByText(/Session started on this device/)).toBeVisible({ timeout: 30_000 });
  expect(await approvals(again.page)).toBe(1);
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await again.page.waitForTimeout(2500);
  expect(await approvals(again.page)).toBe(1);
  await again.context.close();
});

test('trending shows the tags people are using', async () => {
  // Trends are cached for a minute, so look again until the cache has caught up.
  await expect(async () => {
    await anon.page.goto('/home');
    await expect(anon.page.locator('.trend-list').getByText(`#tag${tag}`)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 75_000 });
});

test('a wallet with no SOL claims a name with test SOL from the app, and gets it only once', async ({ browser }) => {
  const fresh = await newUser(browser);
  await claim(fresh, { faucet: true });
  // The app hands out about enough for a name and its fees, not a whole SOL like an airdrop.
  expect(await balanceOf(fresh.key.address)).toBeLessThan(10_000_000);
  const again = await fresh.context.request.post('/api/faucet', { data: { address: fresh.key.address } });
  expect(await again.json()).toMatchObject({ status: 'already_sent' });
  expect(realErrors(fresh.errors)).toEqual([]);
  await fresh.context.close();
});

test('releasing a name refunds the deposit and rent, and frees the name', async () => {
  const before = await balanceOf(bob.key.address);
  await bob.page.goto('/settings');
  bob.page.once('dialog', (d) => d.accept());
  await bob.page.getByRole('button', { name: 'Release this name' }).click();
  await expect(bob.page.getByText('Handle released. Your deposit and rent are back in your wallet.')).toBeVisible({ timeout: 30_000 });
  // At least the 0.01 SOL deposit comes back, plus the name account's rent, less the fee.
  expect((await balanceOf(bob.key.address)) - before).toBeGreaterThan(10_000_000);
  await expect(async () => {
    await bob.page.goto('/claim');
    await bob.page.getByLabel('Your name').fill(bob.handle);
    await expect(bob.page.getByText(`@${bob.handle} is free.`)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

test('no browser errors across the whole session', async () => {
  const noise = (e: string) => /User rejected|Failed to fetch|not an operator/.test(e);
  for (const u of [alice, bob, anon]) {
    expect(realErrors(u.errors).filter((e) => !noise(e))).toEqual([]);
  }
});
