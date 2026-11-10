import { randomBytes } from 'node:crypto';
import { connect, type Sql } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_HIDE_BUDGET_PER_HOUR,
  CATEGORIES,
  acknowledgeAlert,
  ageOutRecords,
  appealStatus,
  checkRateLimit,
  decideAppeal,
  decideOrder,
  decideReport,
  dispatchAlerts,
  fileAppeal,
  fileDataRequest,
  fileOrder,
  fileReport,
  hide,
  label,
  liftOrder,
  logAccess,
  publishQuarterlyNotice,
  queue,
  reportStatus,
  respondToDataRequest,
  showState,
  tick,
  transparency,
  unhide,
  unlabel,
  unwithhold,
  verifyAuditChain,
  withdrawReport,
  withhold,
} from '../src/index';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar';
const POST = 'P'.repeat(88);
const POST2 = 'Q'.repeat(88);
const HOUR = 3_600_000;

let sql: Sql;
let schema: string;
beforeEach(async () => {
  schema = `s_${randomBytes(6).toString('hex')}`;
  const admin = postgres(URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  sql = connect(URL, { max: 4, schema });
  await migrate(sql);
});
afterEach(async () => {
  await sql.unsafe(`drop schema ${schema} cascade`);
  await sql.end();
});

const reporter = { email: 'person@example.com', name: 'A Person', ip: '203.0.113.9', country: 'IN' };
const post = (t = POST) => ({ targetType: 'post' as const, target: t });
const within = (d: Date, from: Date, ms: number) => Math.abs(d.getTime() - from.getTime() - ms) < 5_000;

describe('legal clocks', () => {
  it.each([
    ['child_safety', 0],
    ['intimate_or_impersonation', 2 * HOUR],
    ['threat', 36 * HOUR],
    ['harassment', 36 * HOUR],
    ['privacy', 36 * HOUR],
    ['hate', 36 * HOUR],
    ['misinformation', 36 * HOUR],
    ['malware', 36 * HOUR],
    ['copyright', 7 * 24 * HOUR],
    ['illegal', 7 * 24 * HOUR],
    ['other', 7 * 24 * HOUR],
  ])('%s gets its statutory deadline', async (category, ms) => {
    const filed = await fileReport(sql, { ...post(), category, details: 'x', ...reporter, declaration: true, onBehalf: false });
    const row = (await sql<{ resolve_due_at: Date; created_at: Date; ack_due_at: Date; acknowledged_at: Date | null }[]>`select * from reports where ref = ${filed.ref}`)[0]!;
    expect(within(row.resolve_due_at, row.created_at, ms)).toBe(true);
    expect(within(row.ack_due_at, row.created_at, 24 * HOUR)).toBe(true);
    expect(row.acknowledged_at, 'filing acknowledges the complaint straight away').not.toBeNull();
  });

  it('every category is documented with its rule', () => {
    for (const c of Object.values(CATEGORIES)) {
      expect(c.rule.length).toBeGreaterThan(3);
      expect(c.label.length).toBeGreaterThan(3);
    }
  });

  it('rejects unknown categories and empty targets', async () => {
    await expect(fileReport(sql, { ...post(), category: 'nope', details: '', ...reporter })).rejects.toThrow();
    await expect(fileReport(sql, { targetType: 'post', target: '', category: 'other', details: '', ...reporter })).rejects.toThrow();
  });
});

describe('automatic protection', () => {
  it('a child safety report hides the post immediately and raises a p0 alarm', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'child_safety', details: 'x', ...reporter });
    expect(filed.autoHidden).toBe(true);
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);
    const alert = (await sql<{ severity: string }[]>`select severity from alerts`)[0];
    expect(alert?.severity).toBe('p0');
  });

  it('a signed 2-hour complaint hides the post until reviewed', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'that is me', declaration: true, onBehalf: false, ...reporter });
    expect(filed.autoHidden).toBe(true);
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);
    expect((await sql<{ severity: string }[]>`select severity from alerts`)[0]?.severity).toBe('p1');
  });

  it('a 2-hour complaint without the declaration is refused', async () => {
    await expect(
      fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: false, onBehalf: false, ...reporter }),
    ).rejects.toThrow(/declaration/i);
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
  });

  it('a 2-hour complaint without an email is refused, so the person can be reached', async () => {
    await expect(
      fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: false, ip: reporter.ip, country: 'IN' }),
    ).rejects.toThrow(/email/i);
  });

  it('repeat false filers cannot use the child safety report as a takedown button either', async () => {
    for (let i = 0; i < 3; i++) {
      const t = `${'R'.repeat(87)}${i}`;
      const filed = await fileReport(sql, { ...post(t), category: 'child_safety', details: 'x', ...reporter });
      await decideReport(sql, filed.ref, { decision: 'restored', reason: 'nothing of the kind', actor: 'op', falseReport: true });
    }
    const fourth = await fileReport(sql, { ...post(), category: 'child_safety', details: 'x', ...reporter });
    expect(fourth.autoHidden).toBe(false);
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
    const alarm = await sql`select 1 from alerts where dedupe_key = ${`report:${fourth.ref}`} and severity = 'p0'`;
    expect(alarm.length, 'it still pages the operator straight away').toBe(1);
  });

  it('other complaints leave the post up', async () => {
    for (const category of ['harassment', 'hate', 'misinformation', 'other']) {
      const filed = await fileReport(sql, { ...post(), category, details: 'rude', ...reporter });
      expect(filed.autoHidden).toBe(false);
    }
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
  });

  it('restoring after a false complaint counts against the filer, and repeat filers lose auto-hide', async () => {
    for (let i = 0; i < 3; i++) {
      const t = `${'R'.repeat(87)}${i}`;
      const filed = await fileReport(sql, { ...post(t), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: true, ...reporter });
      expect(filed.autoHidden).toBe(true);
      await decideReport(sql, filed.ref, { decision: 'restored', reason: 'not what the complaint said', actor: 'op', falseReport: true });
      expect((await showState(sql, 'post', t)).hidden).toBe(false);
    }
    const fourth = await fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: true, ...reporter });
    expect(fourth.autoHidden, 'still filed and still on the 2-hour clock, just not hidden first').toBe(false);
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
    const rows = await sql`select 1 from reports where ref = ${fourth.ref} and status = 'open'`;
    expect(rows.length).toBe(1);
  });

  it('standing follows the email even from a new address, and the address even with a new email', async () => {
    for (let i = 0; i < 3; i++) {
      const t = `${'R'.repeat(87)}${i}`;
      const filed = await fileReport(sql, { ...post(t), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: true, ...reporter });
      await decideReport(sql, filed.ref, { decision: 'restored', reason: 'false', actor: 'op', falseReport: true });
    }
    const a = await fileReport(sql, { ...post(POST), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: true, ...reporter, ip: '198.51.100.1' });
    expect(a.autoHidden).toBe(false);
    const b = await fileReport(sql, { ...post(POST2), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: true, ...reporter, email: 'new@example.com' });
    expect(b.autoHidden).toBe(false);
  });
});

describe('report lifecycle', () => {
  it('a reporter can check status and withdraw with their private token', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    expect((await reportStatus(sql, filed.ref, filed.token))?.status).toBe('open');
    expect(await reportStatus(sql, filed.ref, 'wrong')).toBeNull();
    expect(await withdrawReport(sql, filed.ref, 'wrong')).toBe(false);
    expect(await withdrawReport(sql, filed.ref, filed.token)).toBe(true);
    expect((await reportStatus(sql, filed.ref, filed.token))?.status).toBe('withdrawn');
  });

  it('withdrawing a 2-hour complaint restores the post unless something else keeps it hidden', async () => {
    const a = await fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: false, ...reporter });
    const b = await fileReport(sql, { ...post(), category: 'child_safety', details: 'x', ...reporter });
    await withdrawReport(sql, a.ref, a.token);
    expect((await showState(sql, 'post', POST)).hidden, 'the other open report still holds it').toBe(true);
    await withdrawReport(sql, b.ref, b.token);
    expect((await showState(sql, 'post', POST)).hidden, 'a child safety hide stays until the operator reviews it').toBe(true);
  });

  it('withdrawing the only 2-hour complaint restores the post', async () => {
    const a = await fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: false, ...reporter });
    await withdrawReport(sql, a.ref, a.token);
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
  });

  it('a decision is final: it cannot be decided twice', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await decideReport(sql, filed.ref, { decision: 'no_action', reason: 'lawful speech', actor: 'op' });
    await expect(decideReport(sql, filed.ref, { decision: 'removed', reason: 'changed my mind', actor: 'op' })).rejects.toThrow();
  });

  it('every decision needs a written reason', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await expect(decideReport(sql, filed.ref, { decision: 'no_action', reason: '  ', actor: 'op' })).rejects.toThrow(/reason/i);
  });

  it('removing through a decision hides the post with a public reason', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'threat', details: 'x', ...reporter });
    await decideReport(sql, filed.ref, { decision: 'removed', reason: 'credible threat against a named person', actor: 'op' });
    const state = await showState(sql, 'post', POST);
    expect(state.hidden).toBe(true);
    expect(state.reasonCode).toBe('threat');
  });

  it('the queue lists open items soonest deadline first, across every kind', async () => {
    await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await fileReport(sql, { ...post(POST2), category: 'threat', details: 'x', ...reporter });
    await fileOrder(sql, order());
    const q = await queue(sql);
    const dues = q.map((i) => i.dueAt.getTime());
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
    expect(q.map((i) => i.kind)).toEqual(['order', 'report', 'report']);
  });
});

const order = (over: Partial<Parameters<typeof fileOrder>[1]> = {}) => ({
  kind: 'court' as const,
  authority: 'High Court of Delhi',
  officerName: 'Registrar',
  officerDesignation: 'Registrar General',
  orderReference: 'CS(OS) 1/2026',
  contactEmail: 'registrar@example.com',
  targets: [{ type: 'post' as const, target: POST }],
  scopeCountries: ['IN'],
  details: '',
  ip: '203.0.113.1',
  ...over,
});

describe('legal orders', () => {
  it('starts a 3-hour clock and does not touch content until the operator verifies it', async () => {
    const filed = await fileOrder(sql, order());
    const row = (await sql<{ due_at: Date; received_at: Date }[]>`select * from legal_orders where ref = ${filed.ref}`)[0]!;
    expect(within(row.due_at, row.received_at, 3 * HOUR)).toBe(true);
    expect((await showState(sql, 'post', POST)).withheldCountries).toEqual([]);
    expect((await sql<{ severity: string }[]>`select severity from alerts`)[0]?.severity).toBe('p0');
  });

  it('actioning withholds exactly the ordered targets, only in the ordered countries', async () => {
    const filed = await fileOrder(sql, order({ targets: [{ type: 'post', target: POST }, { type: 'profile', target: 'A'.repeat(44) }] }));
    await decideOrder(sql, filed.ref, { status: 'actioned', note: 'verified with the registry', actor: 'op' });
    expect((await showState(sql, 'post', POST)).withheldCountries).toEqual(['IN']);
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
    expect((await showState(sql, 'profile', 'A'.repeat(44))).withheldCountries).toEqual(['IN']);
    expect((await showState(sql, 'post', POST2)).withheldCountries).toEqual([]);
  });

  it('an order with no country scope hides the target everywhere', async () => {
    const filed = await fileOrder(sql, order({ scopeCountries: [] }));
    await decideOrder(sql, filed.ref, { status: 'actioned', note: 'global order', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);
  });

  it('a rejected order changes nothing and records why', async () => {
    const filed = await fileOrder(sql, order());
    await decideOrder(sql, filed.ref, { status: 'rejected', note: 'officer not authorised under rule 3(1)(d)', actor: 'op' });
    expect((await showState(sql, 'post', POST)).withheldCountries).toEqual([]);
    const row = (await sql<{ status: string; decision_note: string }[]>`select * from legal_orders`)[0];
    expect(row).toMatchObject({ status: 'rejected', decision_note: 'officer not authorised under rule 3(1)(d)' });
  });

  it('refuses orders that name nothing', async () => {
    await expect(fileOrder(sql, order({ targets: [] }))).rejects.toThrow(/target/i);
  });
});

describe('data requests', () => {
  it('starts a 72-hour clock and needs a written response', async () => {
    const filed = await fileDataRequest(sql, { authority: 'CERT-In', officerName: 'X', officerDesignation: 'Director', legalBasis: 'Rule 3(1)(j)', contactEmail: 'x@example.com', subject: 'wallet', details: '', ip: '203.0.113.1' });
    const row = (await sql<{ due_at: Date; received_at: Date }[]>`select * from data_requests`)[0]!;
    expect(within(row.due_at, row.received_at, 72 * HOUR)).toBe(true);
    await expect(respondToDataRequest(sql, filed.ref, { status: 'responded', note: '', actor: 'op' })).rejects.toThrow();
    await respondToDataRequest(sql, filed.ref, { status: 'responded', note: 'sent access logs', actor: 'op' });
    expect((await sql<{ status: string }[]>`select status from data_requests`)[0]?.status).toBe('responded');
  });
});

describe('appeals', () => {
  it('overturning restores the post, and upholding keeps it down', async () => {
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op', legalBasis: 'rules' });
    const a = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 'it was a joke', verifiedAuthor: true, ip: '1.1.1.1' });
    await decideAppeal(sql, a.ref, { status: 'upheld', note: 'still a threat', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);

    const b = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 'read it again', verifiedAuthor: true, ip: '1.1.1.1' });
    await decideAppeal(sql, b.ref, { status: 'overturned', note: 'misread on review', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
    expect((await appealStatus(sql, b.ref, b.token))?.status).toBe('overturned');
  });

  it('appeals run on a 7-day clock', async () => {
    const a = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 's', verifiedAuthor: false, ip: '1.1.1.1' });
    const row = (await sql<{ due_at: Date; created_at: Date }[]>`select * from appeals where ref = ${a.ref}`)[0]!;
    expect(within(row.due_at, row.created_at, 7 * 24 * HOUR)).toBe(true);
  });

  it('overturning does not lift a court order', async () => {
    const o = await fileOrder(sql, order({ scopeCountries: [] }));
    await decideOrder(sql, o.ref, { status: 'actioned', note: 'verified', actor: 'op' });
    const a = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 's', verifiedAuthor: true, ip: '1.1.1.1' });
    await decideAppeal(sql, a.ref, { status: 'overturned', note: 'appeal accepted', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden, 'the operator must lift an order explicitly').toBe(true);
  });
});

describe('withholding and labels', () => {
  it('country withholding merges, and removing one country keeps the rest', async () => {
    await withhold(sql, { ...post(), countries: ['IN'], reasonCode: 'legal_order', actor: 'op' });
    await withhold(sql, { ...post(), countries: ['DE', 'in'], reasonCode: 'legal_order', actor: 'op' });
    expect((await showState(sql, 'post', POST)).withheldCountries.sort()).toEqual(['DE', 'IN']);
  });

  it('hiding a hidden post and unhiding a visible one are safe', async () => {
    await unhide(sql, { ...post(), reasonCode: 'review', actor: 'op' });
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op' });
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op' });
    await unhide(sql, { ...post(), reasonCode: 'review', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
  });

  it('labels add and remove without hiding anything', async () => {
    await label(sql, { ...post(), label: 'adult', actor: 'op', reasonCode: 'review' });
    expect((await sql<{ label: string }[]>`select label from labels`)[0]?.label).toBe('adult');
    expect((await showState(sql, 'post', POST)).hidden).toBe(false);
    await unlabel(sql, { ...post(), label: 'adult', actor: 'op', reasonCode: 'review' });
    expect(await sql`select 1 from labels`).toEqual([]);
  });
});

describe('audit log', () => {
  it('records every action in a hash chain that verifies', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'threat', details: 'x', ...reporter });
    await decideReport(sql, filed.ref, { decision: 'removed', reason: 'threat', actor: 'op' });
    await unhide(sql, { ...post(), reasonCode: 'review', actor: 'op' });
    const rows = await sql`select * from audit_log`;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(await verifyAuditChain(sql)).toEqual({ ok: true, rows: rows.length });
  });

  it('cannot be edited or deleted, even directly', async () => {
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op' });
    await expect(sql`update audit_log set actor = 'someone else'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
    await expect(sql`update moderation_actions set actor = 'someone else'`).rejects.toThrow(/append-only/);
  });

  it('detects tampering if the trigger is bypassed', async () => {
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op' });
    await unhide(sql, { ...post(), reasonCode: 'review', actor: 'op' });
    await sql`alter table audit_log disable trigger audit_log_append_only`;
    await sql`update audit_log set actor = 'forged' where seq = 1`;
    await sql`alter table audit_log enable trigger audit_log_append_only`;
    expect((await verifyAuditChain(sql)).ok).toBe(false);
  });

  it('stays a valid chain under concurrent writers', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => hide(sql, { ...post(`${'Z'.repeat(87)}${i % 10}`), reasonCode: 'threat', actor: `op${i}` })));
    expect((await verifyAuditChain(sql)).ok).toBe(true);
  });
});

describe('transparency', () => {
  it('reports counts and actions, but never reveals child safety targets or report details', async () => {
    const a = await fileReport(sql, { ...post(), category: 'child_safety', details: 'SECRET DETAILS', ...reporter });
    await decideReport(sql, a.ref, { decision: 'removed', reason: 'confirmed', actor: 'op', externalReportRef: 'cybercrime-123' });
    const b = await fileReport(sql, { ...post(POST2), category: 'harassment', details: 'x', ...reporter });
    await decideReport(sql, b.ref, { decision: 'removed', reason: 'harassment', actor: 'op' });
    const t = await transparency(sql);
    const text = JSON.stringify(t);
    expect(text).not.toContain('SECRET DETAILS');
    expect(text).not.toContain('person@example.com');
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain(POST);
    expect(text).toContain(POST2);
    expect(t.counts.find((c) => c.category === 'child_safety')?.total).toBe(1);
    expect(t.counts.find((c) => c.category === 'harassment')?.total).toBe(1);
  });

  it('an order marked not for publication stays out of the public list', async () => {
    const o = await fileOrder(sql, order({ orderReference: 'SEALED-1' }));
    await decideOrder(sql, o.ref, { status: 'actioned', note: 'sealed', actor: 'op', publish: false });
    const t = await transparency(sql);
    expect(JSON.stringify(t)).not.toContain('SEALED-1');
    expect(JSON.stringify(t)).not.toContain(POST);
    expect(t.ordersWithheldFromPublication).toBe(1);
  });
});

describe('alarms', () => {
  const channel = () => {
    const sent: string[] = [];
    return { sent, send: async (m: { subject: string }) => void sent.push(m.subject) };
  };

  it('sends new alerts to every channel, and repeats p0 until acknowledged', async () => {
    await fileOrder(sql, order());
    const ch = channel();
    await dispatchAlerts(sql, [ch]);
    expect(ch.sent.length).toBe(1);

    await dispatchAlerts(sql, [ch]);
    expect(ch.sent.length, 'not repeated straight away').toBe(1);

    await sql`update alerts set last_sent_at = now() - interval '16 minutes'`;
    await dispatchAlerts(sql, [ch]);
    expect(ch.sent.length, 'p0 repeats every 15 minutes').toBe(2);

    const id = (await sql<{ id: string }[]>`select id from alerts`)[0]!.id;
    await acknowledgeAlert(sql, id);
    await sql`update alerts set last_sent_at = now() - interval '16 minutes'`;
    await dispatchAlerts(sql, [ch]);
    expect(ch.sent.length, 'silent once acknowledged').toBe(2);
  });

  it('a channel failure is recorded, retried, and does not stop other channels', async () => {
    await fileOrder(sql, order());
    const good = channel();
    const bad = { send: async () => { throw new Error('telegram down'); } };
    await dispatchAlerts(sql, [bad, good]);
    expect(good.sent.length).toBe(1);
    const row = (await sql<{ last_error: string; send_count: number }[]>`select * from alerts`)[0];
    expect(row?.last_error).toContain('telegram down');
  });

  it('with no channels configured, alerts stay pending rather than vanish', async () => {
    await fileOrder(sql, order());
    const r = await dispatchAlerts(sql, []);
    expect(r.unconfigured).toBe(true);
    expect((await sql<{ send_count: number }[]>`select send_count from alerts`)[0]?.send_count).toBe(0);
  });

  it('tick raises a warning before a deadline and a breach after it', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'threat', details: 'x', ...reporter });
    await sql`delete from alerts`;
    await sql`update reports set resolve_due_at = now() + interval '30 minutes' where ref = ${filed.ref}`;
    await tick(sql);
    expect((await sql<{ kind: string; severity: string }[]>`select kind, severity from alerts`).map((a) => a.kind)).toContain('deadline_warning');

    await sql`update reports set resolve_due_at = now() - interval '1 minute' where ref = ${filed.ref}`;
    await tick(sql);
    const breaches = await sql<{ severity: string }[]>`select severity from alerts where kind = 'deadline_breach'`;
    expect(breaches[0]?.severity).toBe('p0');

    const count = (await sql`select 1 from alerts`).length;
    await tick(sql);
    expect((await sql`select 1 from alerts`).length, 'tick does not duplicate alarms').toBe(count);
  });
});

describe('retention and notices', () => {
  it('purges access logs and rate limits past their window, and keeps legal records', async () => {
    await logAccess(sql, { method: 'POST', route: '/api/report', status: 200, ip: '1.1.1.1', userAgent: 'x', country: 'IN' });
    await logAccess(sql, { method: 'POST', route: '/api/report', status: 200, ip: '1.1.1.2', userAgent: 'x', country: 'IN' });
    await sql`update access_log set at = now() - interval '181 days' where ip = '1.1.1.1'`;
    const filed = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await decideReport(sql, filed.ref, { decision: 'no_action', reason: 'lawful', actor: 'op' });
    await sql`update reports set resolved_at = now() - interval '200 days', reporter_ip = '9.9.9.9', reporter_email = 'old@example.com'`;

    const out = await ageOutRecords(sql);
    expect(out.accessLogs).toBe(1);
    expect((await sql`select ip from access_log`).map((r) => r.ip)).toEqual(['1.1.1.2']);

    // The decision stays on record; personal details of the filer go once the 180 days are up.
    const row = (await sql<{ reporter_ip: string | null; reporter_email: string | null; decision: string }[]>`select * from reports`)[0];
    expect(row).toMatchObject({ reporter_ip: null, reporter_email: null, decision: 'no_action' });
  });

  it('keeps personal details within the 180-day window', async () => {
    const filed = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await decideReport(sql, filed.ref, { decision: 'no_action', reason: 'lawful', actor: 'op' });
    await ageOutRecords(sql);
    const row = (await sql<{ reporter_email: string | null }[]>`select * from reports`)[0];
    expect(row?.reporter_email).toBe(reporter.email);
  });

  it('publishes one quarterly notice with the content rule 3(1)(c) requires', async () => {
    const first = await publishQuarterlyNotice(sql, new Date('2026-11-09T00:00:00Z'));
    expect(first?.quarter).toBe('2026-Q4');
    expect(first?.body).toMatch(/terminate|suspend/i);
    expect(first?.body).toMatch(/penalty or punishment/i);
    expect(first?.body).toMatch(/report/i);
    expect(await publishQuarterlyNotice(sql, new Date('2026-12-01T00:00:00Z'))).toBeNull();
    expect((await publishQuarterlyNotice(sql, new Date('2027-01-01T00:00:00Z')))?.quarter).toBe('2027-Q1');
  });
});

describe('rate limits', () => {
  it('allows up to the limit in a window, then refuses', async () => {
    for (let i = 0; i < 3; i++) expect(await checkRateLimit(sql, 'report:1.1.1.1', 3, 60)).toBe(true);
    expect(await checkRateLimit(sql, 'report:1.1.1.1', 3, 60)).toBe(false);
    expect(await checkRateLimit(sql, 'report:2.2.2.2', 3, 60)).toBe(true);
  });

  it('counts correctly under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => checkRateLimit(sql, 'k', 5, 60)));
    expect(results.filter(Boolean).length).toBe(5);
  });
});

describe('independent holds (review findings)', () => {
  const intimate = (over: Partial<Parameters<typeof fileReport>[1]> = {}) =>
    fileReport(sql, { ...post(), category: 'intimate_or_impersonation', details: 'x', declaration: true, onBehalf: false, ...reporter, ...over });

  it('withdrawing one report cannot undo a confirmed removal made on another report', async () => {
    const own = await intimate({ email: 'author@example.com', ip: '198.51.100.7' });
    const victim = await intimate({ email: 'victim@example.com', ip: '198.51.100.8' });
    await decideReport(sql, victim.ref, { decision: 'removed', reason: 'confirmed', actor: 'op' });
    expect(await withdrawReport(sql, own.ref, own.token)).toBe(true);
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);
  });

  it('answering "no action" on a junk report does not restore content removed for another reason', async () => {
    await hide(sql, { ...post(), reasonCode: 'threat', actor: 'op' });
    const junk = await fileReport(sql, { ...post(), category: 'child_safety', details: 'junk', ...reporter });
    await decideReport(sql, junk.ref, { decision: 'no_action', reason: 'not child sexual material', actor: 'op' });
    expect((await showState(sql, 'post', POST)).hidden).toBe(true);
  });

  it('a later removal does not turn a legal order into something a report can lift', async () => {
    const o = await fileOrder(sql, order({ scopeCountries: [] }));
    await decideOrder(sql, o.ref, { status: 'actioned', note: 'verified', actor: 'op' });
    const r = await intimate();
    await decideReport(sql, r.ref, { decision: 'removed', reason: 'also intimate', actor: 'op' });
    const second = await intimate({ email: 'second@example.com', ip: '198.51.100.9' });
    await withdrawReport(sql, second.ref, second.token);
    const junk = await fileReport(sql, { ...post(), category: 'child_safety', details: 'junk', ...reporter, ip: '198.51.100.10' });
    await decideReport(sql, junk.ref, { decision: 'no_action', reason: 'junk', actor: 'op' });
    await decideReport(sql, (await intimate({ email: 'third@example.com', ip: '198.51.100.11' })).ref, { decision: 'restored', reason: 'false', actor: 'op' });
    const state = await showState(sql, 'post', POST);
    expect(state.hidden).toBe(true);
    expect(state.reasonCode).toBe('legal_order');
  });

  it('an operator restore never lifts a legal order, and lifting the order is its own explicit step', async () => {
    const o = await fileOrder(sql, order({ scopeCountries: ['IN'] }));
    await decideOrder(sql, o.ref, { status: 'actioned', note: 'verified', actor: 'op' });
    await unhide(sql, { ...post(), reasonCode: 'review', actor: 'op' });
    await unwithhold(sql, { ...post(), reasonCode: 'review', actor: 'op', countries: ['IN'] });
    expect((await showState(sql, 'post', POST)).withheldCountries).toEqual(['IN']);
    await liftOrder(sql, o.ref, { note: 'Order set aside on appeal', actor: 'op' });
    expect((await showState(sql, 'post', POST)).withheldCountries).toEqual([]);
  });

  it('a child safety report hides a post at once, but only queues a whole account', async () => {
    const filed = await fileReport(sql, { targetType: 'profile', target: 'A'.repeat(44), category: 'child_safety', details: 'x', ...reporter });
    expect(filed.autoHidden).toBe(false);
    expect((await showState(sql, 'profile', 'A'.repeat(44))).hidden).toBe(false);
    expect((await sql<{ severity: string }[]>`select severity from alerts where dedupe_key = ${`report:${filed.ref}`}`)[0]?.severity).toBe('p0');
  });

  it('automatic hiding has a global hourly budget, after which reports only queue', async () => {
    const results = [];
    for (let i = 0; i < AUTO_HIDE_BUDGET_PER_HOUR + 3; i++) {
      results.push(await fileReport(sql, { ...post(`${'B'.repeat(80)}${String(i).padStart(8, '0')}`), category: 'child_safety', details: 'x', ...reporter, ip: `198.51.${Math.floor(i / 250)}.${i % 250}` }));
    }
    expect(results.filter((r) => r.autoHidden).length).toBe(AUTO_HIDE_BUDGET_PER_HOUR);
    const budget = await sql`select 1 from alerts where kind = 'auto_hide_budget'`;
    expect(budget.length).toBe(1);
  });

  it('removed doxxing and threat posts are not pointed to from the public log', async () => {
    for (const [i, category] of ['privacy', 'threat'].entries()) {
      const target = `${'D'.repeat(87)}${i}`;
      const r = await fileReport(sql, { ...post(target), category, details: 'x', ...reporter });
      await decideReport(sql, r.ref, { decision: 'removed', reason: 'confirmed', actor: 'op' });
      expect(JSON.stringify(await transparency(sql))).not.toContain(target);
    }
  });

  it('government and police orders are unpublished unless the operator chooses otherwise; court orders are published', async () => {
    const gov = await fileOrder(sql, order({ kind: 'government', orderReference: 'GOV-69A-1' }));
    await decideOrder(sql, gov.ref, { status: 'actioned', note: 'verified', actor: 'op' });
    const court = await fileOrder(sql, order({ kind: 'court', orderReference: 'COURT-1', targets: [{ type: 'post', target: POST2 }] }));
    await decideOrder(sql, court.ref, { status: 'actioned', note: 'verified', actor: 'op' });
    const text = JSON.stringify(await transparency(sql));
    expect(text).not.toContain('GOV-69A-1');
    expect(text).toContain('COURT-1');
  });

  it('alarms are not sent twice by concurrent dispatchers', async () => {
    await fileOrder(sql, order());
    const sent: string[] = [];
    const slow = { send: async (m: { subject: string }) => { await new Promise((r) => setTimeout(r, 50)); sent.push(m.subject); } };
    await Promise.all([dispatchAlerts(sql, [slow]), dispatchAlerts(sql, [slow]), dispatchAlerts(sql, [slow])]);
    expect(sent.length).toBe(1);
  });

  it('appeal status needs the private token, and reporter hashes are salted', async () => {
    const a = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 's', verifiedAuthor: false, ip: '1.1.1.1' });
    expect(a.token.length).toBeGreaterThan(20);
    expect(await appealStatus(sql, a.ref, 'wrong')).toBeNull();
    expect((await appealStatus(sql, a.ref, a.token))?.status).toBe('open');

    const r = await fileReport(sql, { ...post(), category: 'other', details: 'x', ...reporter });
    await decideReport(sql, r.ref, { decision: 'no_action', reason: 'ok', actor: 'op', falseReport: true });
    const keys = (await sql<{ key: string }[]>`select key from reporter_standing`).map((k) => k.key);
    const { createHash } = await import('node:crypto');
    const unsalted = createHash('sha256').update(`ip:${reporter.ip}`).digest('hex');
    expect(keys).not.toContain(unsalted);
    expect(keys.length).toBe(2);
  });

  it('retention also clears report details and appeal statements after 180 days', async () => {
    const r = await fileReport(sql, { ...post(), category: 'other', details: 'PRIVATE DETAIL', ...reporter });
    await decideReport(sql, r.ref, { decision: 'no_action', reason: 'ok', actor: 'op' });
    const a = await fileAppeal(sql, { ...post(), email: 'me@example.com', statement: 'PRIVATE STATEMENT', verifiedAuthor: false, ip: '1.1.1.1' });
    await decideAppeal(sql, a.ref, { status: 'upheld', note: 'n', actor: 'op' });
    await sql`update reports set resolved_at = now() - interval '200 days'`;
    await sql`update appeals set decided_at = now() - interval '200 days'`;
    await ageOutRecords(sql);
    const text = JSON.stringify([await sql`select * from reports`, await sql`select * from appeals`]);
    expect(text).not.toContain('PRIVATE DETAIL');
    expect(text).not.toContain('PRIVATE STATEMENT');
    expect(text).not.toContain('me@example.com');
  });
});
