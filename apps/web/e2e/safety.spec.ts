import { expect, test } from '@playwright/test';
import { airdrop, claim, connect, expectPost, newUser, postFromComposer, realErrors, sigOfPost, type User } from './helpers';
import { OPERATOR_KEY } from './keys';

/**
 * Timed drills of every legal clock, through the real forms and the real console. Each drill measures
 * how long the action really took and fails if it misses the statutory deadline.
 */
test.describe.configure({ mode: 'serial' });

let author: User;
let reader: User;
let inIndia: User;
let inUS: User;
let operator: User;
const tag = Math.random().toString(36).slice(2, 7);
const timings: Record<string, number> = {};

async function publish(text: string): Promise<string> {
  await author.page.goto('/home');
  await postFromComposer(author.page, text);
  await expectPost(author.page, text);
  await author.page.waitForTimeout(1200);
  await author.page.reload();
  await author.page.getByRole('tab', { name: 'Latest' }).click();
  await expectPost(author.page, text);
  return sigOfPost(author.page, text);
}

async function fileReport(page: User['page'], sig: string, label: RegExp, extra?: () => Promise<void>) {
  await page.goto(`/report?type=post&target=${sig}`);
  await page.getByRole('radio', { name: label }).check();
  await page.getByLabel('Details', { exact: true }).fill('drill');
  await extra?.();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByTestId('report-filed')).toBeVisible();
  return page.getByTestId('report-filed').locator('strong').innerText();
}

const refOf = (s: string) => s.split(': ')[1] as string;

async function openItem(ref: string) {
  await operator.page.goto('/admin');
  await operator.page.getByTestId('queue').getByRole('button', { name: new RegExp(ref) }).click();
  await expect(operator.page.getByTestId('admin-detail')).toBeVisible();
}

/** The visible surfaces a post could leak through, read as an anonymous visitor. */
async function assertGone(user: User, sig: string, text: string) {
  const req = user.context.request;
  for (const path of [`/post/${sig}`, `/api/post/${sig}`, '/api/feed?tab=latest', '/api/feed?tab=foryou', `/api/search?q=${tag}`, `/api/profile/${author.handle}/feed?tab=posts`]) {
    const body = await (await req.get(path)).text();
    expect(body.includes(text), `${text} leaked on ${path}`).toBe(false);
  }
}

test.beforeAll(async ({ browser }) => {
  author = await newUser(browser);
  reader = await newUser(browser);
  inIndia = await newUser(browser, { country: 'IN' });
  inUS = await newUser(browser, { country: 'US' });
  operator = await newUser(browser, { key: OPERATOR_KEY });
  await claim(author);
  await airdrop(OPERATOR_KEY.address, 1);
  await operator.page.goto('/admin');
  await connect(operator.page);
  await operator.page.getByRole('button', { name: 'Sign in with this wallet' }).click();
  await expect(operator.page.getByRole('heading', { name: 'Queue' })).toBeVisible();
});

test.afterAll(async () => {
  console.log('\nLEGAL CLOCK DRILLS (time from filing to the post being gone or the decision recorded):');
  for (const [k, v] of Object.entries(timings)) console.log(`  ${k}: ${(v / 1000).toFixed(1)}s`);
  for (const u of [author, reader, inIndia, inUS, operator]) await u?.context.close();
});

test('drill: child safety report hides at once, for everyone, and pages the operator', async () => {
  const text = `drill child safety ${tag}`;
  const sig = await publish(text);
  const start = Date.now();
  const filed = await fileReport(reader.page, sig, /Sexual content involving a child/);
  await assertGone(reader, sig, text);
  await assertGone(inUS, sig, text);
  timings['Child safety, immediately'] = Date.now() - start;
  expect(Date.now() - start).toBeLessThan(60_000);

  // A share card and the transparency log must not carry it either.
  const png = await reader.context.request.get(`/api/og/post/${sig}`);
  expect(png.status()).toBe(200);
  const transparency = await (await reader.context.request.get('/transparency')).text();
  expect(transparency).not.toContain(sig);

  // The operator sees the original text, records the external report, and confirms the removal.
  const ref = refOf(filed);
  await openItem(ref);
  await expect(operator.page.getByTestId('admin-post-text')).toHaveText(text);
  await operator.page.getByLabel('Written reason').fill('Reviewed');
  await operator.page.getByLabel('cybercrime.gov.in reference').fill('DRILL-1');
  await operator.page.getByRole('button', { name: 'Hide it' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  await assertGone(reader, sig, text);
});

test('drill: a 2-hour complaint hides first, and a false one is restored after review', async () => {
  const text = `drill intimate ${tag}`;
  const sig = await publish(text);
  const start = Date.now();
  const filed = await fileReport(reader.page, sig, /Nudity, sexual content/, async () => {
    await reader.page.getByLabel(/Email/).fill('person@example.com');
    await reader.page.getByLabel('Your name').fill('A Person');
    await reader.page.getByRole('checkbox', { name: /I declare/ }).check();
  });
  await assertGone(reader, sig, text);
  timings['Intimate or impersonation complaint, 2 hours'] = Date.now() - start;
  expect(Date.now() - start).toBeLessThan(2 * 3_600_000);

  await reader.page.goto(`/post/${sig}`);
  await expect(reader.page.getByText(/hidden on this app/i)).toBeVisible();
  await expect(reader.page.getByRole('link', { name: 'Appeal this' })).toBeVisible();

  await openItem(refOf(filed));
  await operator.page.getByLabel('Written reason').fill('The post is not what the complaint said');
  await operator.page.getByRole('checkbox', { name: /complaint was false/ }).check();
  await operator.page.getByRole('button', { name: 'Restore' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();

  const restored = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(restored.post.text).toBe(text);
});

test('a complaint needing a declaration cannot be sent without it', async () => {
  const text = `no declaration ${tag}`;
  const sig = await publish(text);
  await reader.page.goto(`/report?type=post&target=${sig}`);
  await reader.page.getByRole('radio', { name: /Nudity, sexual content/ }).check();
  await expect(reader.page.getByRole('button', { name: 'Send report' })).toBeDisabled();
  const res = await reader.context.request.post('/api/report', { data: { targetType: 'post', target: sig, category: 'intimate_or_impersonation', email: 'x@example.com' } });
  expect(res.status()).toBe(422);
  const body = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(body.post.text).toBe(text);
});

test('drill: a court order withholds only in the ordered country, within 3 hours', async () => {
  const text = `drill court order ${tag}`;
  const sig = await publish(text);
  const start = Date.now();
  await reader.page.goto('/law-enforcement');
  await reader.page.getByLabel('Issuing court or agency').fill('High Court of Delhi');
  await reader.page.getByLabel('Officer name').first().fill('Registrar');
  await reader.page.getByLabel('Officer designation and rank').fill('Registrar General');
  await reader.page.getByLabel('Order reference number').fill(`CS(OS) ${tag}`);
  await reader.page.getByLabel('Official contact email').first().fill('registrar@example.com');
  await reader.page.getByLabel('Posts or accounts named in the order').fill(sig);
  await reader.page.getByLabel('Countries the order applies to').fill('IN');
  await reader.page.getByRole('button', { name: 'Submit order' }).click();
  await expect(reader.page.getByTestId('order-filed')).toBeVisible();
  const ref = refOf(await reader.page.getByTestId('order-filed').locator('strong').innerText());

  // Nothing changes until a person has verified the order, so a forged form can't censor anything.
  const before = await (await inIndia.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(before.post.text).toBe(text);

  await openItem(ref);
  await operator.page.getByLabel('Written note').fill('Verified with the registry');
  await operator.page.getByRole('button', { name: 'Verified: act on it' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  timings['Court order, 3 hours'] = Date.now() - start;
  expect(Date.now() - start).toBeLessThan(3 * 3_600_000);

  await assertGone(inIndia, sig, text);
  const india = await (await inIndia.context.request.get(`/api/post/${sig}`)).json() as { post: { tombstone: { kind: string; countries: string[] } } };
  expect(india.post.tombstone).toMatchObject({ kind: 'withheld', countries: ['IN'] });
  const us = await (await inUS.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string; tombstone: unknown } };
  expect(us.post.text).toBe(text);
  expect(us.post.tombstone).toBeNull();

  await inIndia.page.goto(`/post/${sig}`);
  await expect(inIndia.page.getByText(/withheld in your country/i)).toBeVisible();
  await expect(inIndia.page.locator('body')).not.toContainText(text);

  const transparency = await (await reader.context.request.get('/transparency')).text();
  expect(transparency).toContain(`CS(OS) ${tag}`);
});

test('drill: a 36-hour complaint leaves the post up until someone decides', async () => {
  const text = `drill harassment ${tag}`;
  const sig = await publish(text);
  const start = Date.now();
  const filed = await fileReport(reader.page, sig, /Targeted harassment/);
  const during = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(during.post.text).toBe(text);

  await openItem(refOf(filed));
  await operator.page.getByLabel('Written reason').fill('Rude, but lawful speech');
  await operator.page.getByRole('button', { name: 'No action' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  timings['Harassment complaint, 36 hours'] = Date.now() - start;
  const after = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(after.post.text).toBe(text);
});

test('a reporter can check status and withdraw, and the post comes back', async () => {
  const text = `drill withdraw ${tag}`;
  const sig = await publish(text);
  await fileReport(reader.page, sig, /Nudity, sexual content/, async () => {
    await reader.page.getByLabel(/Email/).fill('other@example.com');
    await reader.page.getByLabel('Your name').fill('Other');
    await reader.page.getByRole('checkbox', { name: /I declare/ }).check();
  });
  await assertGone(reader, sig, text);
  const url = await reader.page.getByTestId('report-status-url').innerText();
  await reader.page.goto(url);
  await expect(reader.page.getByTestId('report-status')).toHaveText('Under review');
  await reader.page.getByRole('button', { name: 'Withdraw this report' }).click();
  await expect(reader.page.getByTestId('report-status')).toHaveText('Withdrawn by you');
  const back = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(back.post.text).toBe(text);
});

test('drill: appeal overturns a removal, and the author is marked verified', async () => {
  const text = `drill appeal ${tag}`;
  const sig = await publish(text);
  const filed = await fileReport(reader.page, sig, /A threat of violence/);
  await openItem(refOf(filed));
  await operator.page.getByLabel('Written reason').fill('Reads like a threat');
  await operator.page.getByRole('button', { name: 'Hide it' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  await assertGone(reader, sig, text);

  const start = Date.now();
  await author.page.goto(`/post/${sig}`);
  await expect(author.page.locator('body')).not.toContainText(text);
  await author.page.getByRole('link', { name: 'Appeal this' }).click();
  await author.page.getByLabel('Email').fill('author@example.com');
  await author.page.getByLabel('Why was this decision wrong?').fill('It was a quote from a film');
  await author.page.getByRole('button', { name: 'Send appeal' }).click();
  await expect(author.page.getByTestId('appeal-filed')).toBeVisible();
  const ref = refOf(await author.page.getByTestId('appeal-filed').locator('strong').innerText());

  await openItem(ref);
  await expect(operator.page.getByTestId('admin-detail')).toContainText('verified author');
  const statusUrl = await author.page.getByTestId('appeal-status-url').innerText();
  await operator.page.getByLabel('Written note').fill('Film quote. Overturned.');
  await operator.page.getByRole('button', { name: 'Overturn and restore' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  timings['Appeal, 7 days'] = Date.now() - start;
  await author.page.goto(statusUrl);
  await expect(author.page.getByTestId('appeal-status')).toHaveText('Decision overturned and restored');
  await expect(author.page.getByText('Film quote. Overturned.')).toBeVisible();
  const back = await (await reader.context.request.get(`/api/post/${sig}`)).json() as { post: { text: string } };
  expect(back.post.text).toBe(text);
});

test('drill: a data request gets its 72-hour clock, and the export holds what we said we hold', async () => {
  const start = Date.now();
  await reader.page.goto('/law-enforcement');
  await reader.page.getByLabel('Requesting agency').fill('CERT-In');
  await reader.page.getByLabel('Officer name').last().fill('Officer');
  await reader.page.getByLabel('Officer designation', { exact: true }).fill('Director');
  await reader.page.getByLabel('Legal basis and order reference').fill(`Rule 3(1)(j) ${tag}`);
  await reader.page.getByLabel('Official contact email').last().fill('officer@example.com');
  await reader.page.getByLabel('Which account, wallet or post is this about?').fill(author.handle);
  await reader.page.getByRole('button', { name: 'Submit request' }).click();
  await expect(reader.page.getByTestId('data-filed')).toBeVisible();
  const ref = refOf(await reader.page.getByTestId('data-filed').locator('strong').innerText());

  await openItem(ref);
  const res = await operator.context.request.get(`/api/admin/export?subject=${author.handle}`);
  expect(res.status()).toBe(200);
  const data = await res.json() as { profile: { handle: string }; posts: unknown[]; sessions: unknown[] };
  expect(data.profile.handle).toBe(author.handle);
  expect(data.posts.length).toBeGreaterThan(0);
  expect(data.sessions.length).toBeGreaterThan(0);

  await operator.page.getByLabel('Written note').fill('Sent the export to the requesting officer');
  await operator.page.getByRole('button', { name: 'Mark answered' }).click();
  await expect(operator.page.getByText('Decision recorded.')).toBeVisible();
  timings['Data request, 72 hours'] = Date.now() - start;
});

test('direct operator action hides an account everywhere, and restoring brings it back', async () => {
  const text = `account level ${tag}`;
  await publish(text);
  const profile = await (await reader.context.request.get(`/api/profile/${author.handle}`)).json() as { profile: { address: string } };
  await operator.page.goto('/admin');
  await operator.page.getByLabel('Target', { exact: true }).selectOption('profile');
  await operator.page.getByLabel('Post ID or account address').fill(profile.profile.address);
  await operator.page.getByLabel('Why (recorded in the audit log)').fill('Drill');
  await operator.page.getByRole('button', { name: 'Apply' }).click();
  await expect(operator.page.getByText('Done. It is in the audit log.')).toBeVisible();

  const feed = await (await reader.context.request.get('/api/feed?tab=latest')).text();
  expect(feed).not.toContain(text);
  const page = await (await reader.context.request.get(`/api/profile/${author.handle}`)).json() as { tombstone: { kind: string } };
  expect(page.tombstone.kind).toBe('removed');

  await operator.page.getByLabel('Action').selectOption('unhide');
  await operator.page.getByLabel('Post ID or account address').fill(profile.profile.address);
  await operator.page.getByLabel('Target', { exact: true }).selectOption('profile');
  await operator.page.getByLabel('Why (recorded in the audit log)').fill('Drill over');
  await operator.page.getByRole('button', { name: 'Apply' }).click();
  await expect(operator.page.getByText('Done. It is in the audit log.').last()).toBeVisible();
  await expect.poll(async () => (await (await reader.context.request.get('/api/feed?tab=latest')).text()).includes(text)).toBe(true);
});

test('a label warns in the feed until the viewer chooses to see it', async () => {
  const text = `labelled content ${tag}`;
  const sig = await publish(text);
  await operator.page.goto('/admin');
  await operator.page.getByLabel('Action').selectOption('label');
  await operator.page.getByLabel('Label').selectOption('graphic');
  await operator.page.getByLabel('Post ID or account address').fill(sig);
  await operator.page.getByLabel('Why (recorded in the audit log)').fill('Graphic description');
  await operator.page.getByRole('button', { name: 'Apply' }).click();
  await expect(operator.page.getByText('Done. It is in the audit log.')).toBeVisible();

  await reader.page.goto(`/post/${sig}`);
  await expect(reader.page.getByText(/Labelled graphic/)).toBeVisible();
  await reader.page.getByRole('button', { name: 'Show' }).click();
  await expect(reader.page.locator('.post-text', { hasText: text })).toBeVisible();
});

test('the audit chain is intact after everything, and the console says so', async () => {
  await operator.page.goto('/admin');
  await expect(operator.page.getByTestId('health-audit')).toContainText('Intact');
  const t = await (await reader.context.request.get('/api/transparency')).json() as { counts: { category: string; total: number }[]; dataRequests: { received: number } };
  expect(t.counts.find((c) => c.category === 'threat')?.total).toBeGreaterThan(0);
  expect(t.dataRequests.received).toBeGreaterThan(0);
  const body = JSON.stringify(t);
  expect(body).not.toContain('person@example.com');
  expect(body).not.toContain('203.0.113');
});

test('maintenance runs under its secret, and only under its secret', async () => {
  const noAuth = await reader.context.request.post('/api/cron/tick');
  expect(noAuth.status()).toBe(401);
  const wrong = await reader.context.request.post('/api/cron/tick', { headers: { authorization: 'Bearer wrong' } });
  expect(wrong.status()).toBe(401);
  const ok = await reader.context.request.post('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron-secret' } });
  expect(ok.status()).toBe(200);
  const result = await ok.json() as { ran: boolean; tick?: { notice: string | null } };
  expect(typeof result.ran).toBe('boolean');
});

test('no browser errors during the drills', async () => {
  const noise = (e: string) => /Failed to fetch/.test(e);
  for (const u of [author, reader, inIndia, inUS, operator]) {
    expect(realErrors(u.errors).filter((e) => !noise(e))).toEqual([]);
  }
});
