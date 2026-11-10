/**
 * The operator's legal machinery: reports, clocks, holds, appeals, an append-only audit log and
 * alarms. Hiding here only changes what this app shows. It never touches the ledger, which is why
 * the reasons, the audit trail and the appeal path all live here.
 *
 * Every reason a target is hidden or withheld is a separate hold, owned by the report, legal order or
 * operator action that placed it. A decision releases only its own hold, so withdrawing one report
 * can never undo a removal made on another, and nothing but an explicit lift ends a legal order.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Sql, Tx } from '@uproar/indexer-core';
import { CATEGORIES, LABELS, type Severity, type TargetType } from './catalog';

export * from './catalog';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MODERATION_LOCK = 7_141_593;
const FALSE_REPORT_LIMIT = 3;
const RETENTION_DAYS = 180;
const ERASED = 'erased after retention period';

/** At most this many targets are hidden automatically per hour. Past it, reports wait for a person. */
export const AUTO_HIDE_BUDGET_PER_HOUR = 20;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const BASE32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function makeRef(prefix: string): string {
  const bytes = randomBytes(8);
  let out = `${prefix}-`;
  for (const b of bytes) out += BASE32[b % BASE32.length];
  return out;
}

function required(value: string | undefined | null, what: string): string {
  const v = value?.trim();
  if (!v) throw new SafetyError(`${what} is required`);
  return v;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_DETAILS = 2_000;

/** An error whose message is safe to show to the person who caused it. */
export class SafetyError extends Error {}

/**
 * IPv6 clients get a whole /64 each, so per-address limits group by the /64 rather than the address.
 * IPv4 addresses are used as they are.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// ---- salted identifiers ----------------------------------------------------------------------

/** Reporter emails and addresses are stored only as salted hashes, so the table can't be reversed. */
async function salt(t: Sql | Tx): Promise<string> {
  await t`insert into settings (key, value) values ('hash_salt', ${randomBytes(32).toString('hex')}) on conflict do nothing`;
  return ((await t<{ value: string }[]>`select value from settings where key = 'hash_salt'`)[0] as { value: string }).value;
}
const keyed = (s: string, label: string, value: string) => createHmac('sha256', s).update(`${label}:${value}`).digest('hex');
const emailKey = (s: string, email: string) => keyed(s, 'email', email.trim().toLowerCase());
const ipKey = (s: string, ip: string) => keyed(s, 'ip', ipBucket(ip));

// ---- audit log -------------------------------------------------------------------------------

const GENESIS = '0'.repeat(64);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function auditHash(prev: string, at: Date, actor: string, action: string, subject: string | null, detail: unknown): string {
  return sha256(`${prev}\n${canonical([at.toISOString(), actor, action, subject, detail])}`);
}

async function audit(t: Tx, actor: string, action: string, subject: string | null, detail: Record<string, unknown> = {}) {
  const last = (await t<{ hash: string }[]>`select hash from audit_log order by seq desc limit 1`)[0];
  const prev = last?.hash ?? GENESIS;
  const at = new Date();
  const hash = auditHash(prev, at, actor, action, subject, detail);
  await t`
    insert into audit_log (at, actor, action, subject, detail, prev_hash, hash)
    values (${at}, ${actor}, ${action}, ${subject}, ${t.json(detail as never)}, ${prev}, ${hash})`;
}

export async function verifyAuditChain(sql: Sql): Promise<{ ok: boolean; rows: number; brokenAt?: number }> {
  const rows = await sql<{ seq: string; at: Date; actor: string; action: string; subject: string | null; detail: unknown; prev_hash: string; hash: string }[]>`
    select * from audit_log order by seq`;
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || auditHash(prev, r.at, r.actor, r.action, r.subject, r.detail) !== r.hash) {
      return { ok: false, rows: rows.length, brokenAt: Number(r.seq) };
    }
    prev = r.hash;
  }
  return { ok: true, rows: rows.length };
}

/** Moderation writes run one at a time. They're rare, and it keeps the audit chain strictly linear. */
function moderationTx<T>(sql: Sql, fn: (t: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    await t`select pg_advisory_xact_lock(${MODERATION_LOCK})`;
    return fn(t);
  }) as Promise<T>;
}

// ---- holds and the visible state -------------------------------------------------------------

export type ShowState = { hidden: boolean; withheldCountries: string[]; reasonCode: string | null; publicNote: string | null };

async function readState(t: Sql | Tx, type: TargetType, target: string): Promise<ShowState> {
  const row = (await t<{ hidden: boolean; withheld_countries: string[]; reason_code: string | null; public_note: string | null }[]>`
    select hidden, withheld_countries, reason_code, public_note from content_state where target_type = ${type} and target = ${target}`)[0];
  return {
    hidden: row?.hidden ?? false,
    withheldCountries: row?.withheld_countries ?? [],
    reasonCode: row?.reason_code ?? null,
    publicNote: row?.public_note ?? null,
  };
}

export const showState = (sql: Sql, type: TargetType, target: string) => readState(sql, type, target);

export type ActionInput = {
  targetType: TargetType;
  target: string;
  reasonCode: string;
  actor: string;
  legalBasis?: string;
  note?: string;
  publicNote?: string;
  publishTarget?: boolean;
  reportId?: string;
  orderId?: string;
  appealId?: string;
};

type HoldSource = 'report' | 'order' | 'operator';
type NewHold = { kind: 'hide' | 'withhold'; countries?: string[]; source: HoldSource; automatic?: boolean; reportId?: string; orderId?: string; reasonCode: string; publicNote?: string };
type HoldFilter = { reportId?: string; orderId?: string; sources?: HoldSource[]; kind?: 'hide' | 'withhold' };

function cleanCountries(countries: readonly string[]): string[] {
  return [...new Set(countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
}

async function insertHold(t: Tx, type: TargetType, target: string, h: NewHold, actor: string) {
  await t`
    insert into content_holds (target_type, target, kind, countries, source, automatic, report_id, order_id, reason_code, public_note, created_by)
    values (${type}, ${target}, ${h.kind}, ${h.countries ?? []}, ${h.source}, ${h.automatic ?? false}, ${h.reportId ?? null}, ${h.orderId ?? null},
            ${h.reasonCode}, ${h.publicNote ?? null}, ${actor})`;
  await audit(t, actor, 'hold_placed', `${type}:${target}`, { kind: h.kind, source: h.source, reason: h.reasonCode, ...(h.countries?.length ? { countries: h.countries } : {}) });
}

async function releaseHolds(t: Tx, type: TargetType, target: string, f: HoldFilter, actor: string, note: string): Promise<number> {
  const released = await t<{ id: string }[]>`
    update content_holds set released_at = now(), released_by = ${actor}, release_note = ${note}
    where target_type = ${type} and target = ${target} and released_at is null
      ${f.reportId ? t`and report_id = ${f.reportId}` : t``}
      ${f.orderId ? t`and order_id = ${f.orderId}` : t``}
      ${f.sources ? t`and source = any(${f.sources})` : t``}
      ${f.kind ? t`and kind = ${f.kind}` : t``}
    returning id`;
  if (released.length) await audit(t, actor, 'hold_released', `${type}:${target}`, { count: released.length, note });
  return released.length;
}

/** Recomputes what the app shows from the active holds. A legal order always names the reason. */
/**
 * Pages cached for logged-out readers are keyed on this number, so a removal shows everywhere at once
 * instead of when a cache runs out. Every change to what's hidden, withheld or labelled bumps it.
 */
export async function bumpVisibility(t: Tx | Sql): Promise<void> {
  await t`
    insert into chain_state (key, value) values ('visibility_version', '1')
    on conflict (key) do update set value = (chain_state.value::bigint + 1)::text, updated_at = now()`;
}

export async function visibilityVersion(sql: Sql): Promise<string> {
  const rows = await sql<{ value: string }[]>`select value from chain_state where key = 'visibility_version'`;
  return rows[0]?.value ?? '0';
}

async function materialise(t: Tx, type: TargetType, target: string): Promise<ShowState> {
  await bumpVisibility(t);
  const holds = await t<{ kind: string; countries: string[]; source: HoldSource; reason_code: string; public_note: string | null }[]>`
    select kind, countries, source, reason_code, public_note from content_holds
    where target_type = ${type} and target = ${target} and released_at is null
    order by created_at desc, id desc`;
  if (holds.length === 0) {
    await t`delete from content_state where target_type = ${type} and target = ${target}`;
    return { hidden: false, withheldCountries: [], reasonCode: null, publicNote: null };
  }
  const hidden = holds.some((h) => h.kind === 'hide');
  const withheld = cleanCountries(holds.filter((h) => h.kind === 'withhold').flatMap((h) => h.countries));
  const lead = holds.find((h) => h.source === 'order') ?? holds.find((h) => h.kind === 'hide') ?? (holds[0] as (typeof holds)[number]);
  const reason = lead.source === 'order' ? 'legal_order' : lead.reason_code;
  await t`
    insert into content_state (target_type, target, hidden, withheld_countries, reason_code, public_note, updated_at)
    values (${type}, ${target}, ${hidden}, ${withheld}, ${reason}, ${lead.public_note}, now())
    on conflict (target_type, target) do update set
      hidden = excluded.hidden, withheld_countries = excluded.withheld_countries,
      reason_code = excluded.reason_code, public_note = excluded.public_note, updated_at = now()`;
  return { hidden, withheldCountries: withheld, reasonCode: reason, publicNote: lead.public_note };
}

async function logAction(t: Tx, action: string, a: ActionInput, reasonCode: string, extra: { countries?: string[]; label?: string } = {}) {
  await bumpVisibility(t);
  await t`
    insert into moderation_actions (actor, action, target_type, target, countries, label, reason_code, legal_basis, report_id, order_id, appeal_id, note, publish_target)
    values (${a.actor}, ${action}, ${a.targetType}, ${a.target}, ${extra.countries ?? []}, ${extra.label ?? null}, ${reasonCode}, ${a.legalBasis ?? null},
            ${a.reportId ?? null}, ${a.orderId ?? null}, ${a.appealId ?? null}, ${a.note ?? null}, ${a.publishTarget ?? true})`;
  await audit(t, a.actor, action, `${a.targetType}:${a.target}`, {
    reason: reasonCode,
    ...(extra.countries?.length ? { countries: extra.countries } : {}),
    ...(extra.label ? { label: extra.label } : {}),
    ...(a.note ? { note: a.note } : {}),
  });
}

/**
 * Runs hold changes for one target, then records only what visibly changed. Adding a second reason to
 * an already hidden post changes nothing the public can see, so it isn't a new public action.
 */
async function changeHolds(t: Tx, a: ActionInput, mutate: () => Promise<void>): Promise<ShowState> {
  const before = await readState(t, a.targetType, a.target);
  await mutate();
  const after = await materialise(t, a.targetType, a.target);
  if (!before.hidden && after.hidden) await logAction(t, 'hide', a, after.reasonCode ?? a.reasonCode);
  if (before.hidden && !after.hidden) await logAction(t, 'unhide', a, a.reasonCode);
  const added = after.withheldCountries.filter((c) => !before.withheldCountries.includes(c));
  const removed = before.withheldCountries.filter((c) => !after.withheldCountries.includes(c));
  if (added.length) await logAction(t, 'withhold', a, after.reasonCode ?? a.reasonCode, { countries: added });
  if (removed.length) await logAction(t, 'unwithhold', a, a.reasonCode, { countries: removed });
  return after;
}

/** An operator hides a target everywhere. */
export const hide = (sql: Sql, a: ActionInput) =>
  moderationTx(sql, (t) =>
    changeHolds(t, a, () => insertHold(t, a.targetType, a.target, { kind: 'hide', source: 'operator', reasonCode: a.reasonCode, ...(a.publicNote ? { publicNote: a.publicNote } : {}) }, a.actor)),
  );

/** An operator restores a target. Legal orders stay in force: lifting one is its own step. */
export const unhide = (sql: Sql, a: ActionInput) =>
  moderationTx(sql, (t) => changeHolds(t, a, async () => void (await releaseHolds(t, a.targetType, a.target, { sources: ['report', 'operator'], kind: 'hide' }, a.actor, a.note ?? a.reasonCode))));

export const withhold = (sql: Sql, a: ActionInput & { countries: string[] }) =>
  moderationTx(sql, async (t) => {
    const countries = cleanCountries(a.countries);
    if (countries.length === 0) throw new SafetyError('Name at least one two-letter country code');
    return changeHolds(t, a, () => insertHold(t, a.targetType, a.target, { kind: 'withhold', countries, source: 'operator', reasonCode: a.reasonCode, ...(a.publicNote ? { publicNote: a.publicNote } : {}) }, a.actor));
  });

/** Lifts withholding in some countries. Holds placed by legal orders are left alone. */
export const unwithhold = (sql: Sql, a: ActionInput & { countries: string[] }) =>
  moderationTx(sql, (t) =>
    changeHolds(t, a, async () => {
      const lift = new Set(cleanCountries(a.countries));
      const holds = await t<{ id: string; countries: string[]; source: HoldSource; report_id: string | null; reason_code: string; public_note: string | null }[]>`
        select id, countries, source, report_id, reason_code, public_note from content_holds
        where target_type = ${a.targetType} and target = ${a.target} and released_at is null and kind = 'withhold' and source <> 'order'`;
      for (const h of holds) {
        if (!h.countries.some((c) => lift.has(c))) continue;
        await t`update content_holds set released_at = now(), released_by = ${a.actor}, release_note = ${a.note ?? 'withholding lifted'} where id = ${h.id}`;
        const rest = h.countries.filter((c) => !lift.has(c));
        if (rest.length) {
          await insertHold(t, a.targetType, a.target, { kind: 'withhold', countries: rest, source: h.source, ...(h.report_id ? { reportId: h.report_id } : {}), reasonCode: h.reason_code, ...(h.public_note ? { publicNote: h.public_note } : {}) }, a.actor);
        }
      }
    }),
  );

export const label = (sql: Sql, a: ActionInput & { label: string; source?: 'operator' | 'auto'; score?: number }) =>
  moderationTx(sql, async (t) => {
    if (!LABELS[a.label]) throw new SafetyError('Unknown label');
    const inserted = await t`
      insert into labels (target_type, target, label, source, score)
      values (${a.targetType}, ${a.target}, ${a.label}, ${a.source ?? 'operator'}, ${a.score ?? null})
      on conflict do nothing returning label`;
    if (inserted.length) await logAction(t, 'label', a, a.reasonCode, { label: a.label });
  });

export const unlabel = (sql: Sql, a: ActionInput & { label: string }) =>
  moderationTx(sql, async (t) => {
    const removed = await t`
      delete from labels where target_type = ${a.targetType} and target = ${a.target} and label = ${a.label} returning label`;
    if (removed.length) await logAction(t, 'unlabel', a, a.reasonCode, { label: a.label });
  });

// ---- alerts ----------------------------------------------------------------------------------

export type AlertInput = { severity: Severity; kind: string; subject: string; body: string; link?: string; dedupeKey?: string; dueAt?: Date };

async function raiseAlert(t: Sql | Tx, a: AlertInput) {
  await t`
    insert into alerts (severity, kind, subject, body, link, dedupe_key, due_at)
    values (${a.severity}, ${a.kind}, ${a.subject}, ${a.body}, ${a.link ?? null}, ${a.dedupeKey ?? null}, ${a.dueAt ?? null})
    on conflict (dedupe_key) do nothing`;
}

/** Closes every alarm for an item, once it has been dealt with. */
async function closeAlerts(t: Tx, ref: string) {
  await t`update alerts set acknowledged_at = now() where acknowledged_at is null and dedupe_key like ${`%:${ref}`}`;
}

export type AlertMessage = { severity: Severity; subject: string; body: string; link: string | null; dueAt: Date | null };
export type AlertChannel = { send: (message: AlertMessage) => Promise<void> };

/**
 * Sends due alarms to every channel. Each alarm is claimed with a row lock first, so two dispatchers
 * running at once never send the same alarm twice. A send that reaches no channel is retried.
 */
export async function dispatchAlerts(sql: Sql, channels: readonly AlertChannel[]): Promise<{ sent: number; failed: number; unconfigured: boolean; pending: number }> {
  const pending = (await sql<{ n: number }[]>`select count(*)::int as n from alerts where acknowledged_at is null`)[0]?.n ?? 0;
  if (channels.length === 0) return { sent: 0, failed: 0, unconfigured: true, pending };

  const claimed = await sql<{ id: string; severity: Severity; subject: string; body: string; link: string | null; due_at: Date | null; previous: Date | null }[]>`
    with due as (
      select id, last_sent_at from alerts
      where acknowledged_at is null and (
        last_sent_at is null
        or (severity in ('p0', 'p1') and last_sent_at < now() - interval '15 minutes')
        or (severity = 'p2' and last_sent_at < now() - interval '6 hours')
      )
      order by severity, created_at
      limit 50
      for update skip locked
    )
    update alerts a set last_sent_at = now()
    from due where a.id = due.id
    returning a.id, a.severity, a.subject, a.body, a.link, a.due_at, due.last_sent_at as previous`;

  let sent = 0;
  let failed = 0;
  for (const alert of claimed) {
    const errors: string[] = [];
    let delivered = 0;
    for (const channel of channels) {
      try {
        await channel.send({ severity: alert.severity, subject: alert.subject, body: alert.body, link: alert.link, dueAt: alert.due_at });
        delivered += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (delivered > 0) {
      await sql`update alerts set send_count = send_count + ${delivered}, last_error = ${errors.length ? errors.join('; ') : null} where id = ${alert.id}`;
      sent += 1;
    } else {
      await sql`update alerts set last_sent_at = ${alert.previous}, last_error = ${errors.join('; ')} where id = ${alert.id}`;
      failed += 1;
    }
  }
  return { sent, failed, unconfigured: false, pending };
}

export async function acknowledgeAlert(sql: Sql, id: string): Promise<void> {
  await sql`update alerts set acknowledged_at = now() where id = ${id}`;
}

export function telegramChannel(token: string, chatId: string): AlertChannel {
  return {
    send: async ({ severity, subject, body, link }) => {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `[${severity.toUpperCase()}] ${subject}\n\n${body}${link ? `\n\n${link}` : ''}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Telegram responded ${res.status}`);
    },
  };
}

export function emailChannel(apiKey: string, from: string, to: string): AlertChannel {
  return {
    send: async ({ severity, subject, body, link }) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from, to, subject: `[${severity.toUpperCase()}] ${subject}`, text: `${body}${link ? `\n\n${link}` : ''}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
    },
  };
}

// ---- reports ---------------------------------------------------------------------------------

export type ReportInput = {
  targetType: TargetType;
  target: string;
  category: string;
  details: string;
  name?: string;
  email?: string;
  onBehalf?: boolean;
  declaration?: boolean;
  ip?: string;
  country?: string;
};

async function standingAllowsAutoHide(t: Tx, keys: string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const rows = await t<{ max: number | null }[]>`select max(false_count) as max from reporter_standing where key = any(${keys})`;
  return (rows[0]?.max ?? 0) < FALSE_REPORT_LIMIT;
}

async function autoHideBudgetLeft(t: Tx): Promise<boolean> {
  const used = (await t<{ n: number }[]>`select count(*)::int as n from content_holds where automatic and created_at > now() - interval '1 hour'`)[0]?.n ?? 0;
  return used < AUTO_HIDE_BUDGET_PER_HOUR;
}

const hourStamp = () => new Date().toISOString().slice(0, 13);

export async function fileReport(sql: Sql, input: ReportInput): Promise<{ ref: string; token: string; autoHidden: boolean; rule: string; resolveDueAt: Date; category: string }> {
  const category = CATEGORIES[input.category];
  if (!category) throw new SafetyError('Pick a reason for your report');
  const target = required(input.target, 'What you are reporting');
  if (category.requiresDeclaration && !input.declaration) {
    throw new SafetyError('This type of complaint needs your signed declaration');
  }
  const email = input.email?.trim() || undefined;
  if (category.requiresEmail && !email) throw new SafetyError('An email address is required, so we can reach you about this complaint');
  if (email && !EMAIL_RE.test(email)) throw new SafetyError('That email address does not look right');
  const details = (input.details ?? '').slice(0, MAX_DETAILS);

  const ref = makeRef('R');
  const token = randomBytes(24).toString('base64url');
  const created = new Date();
  const resolveDue = new Date(created.getTime() + category.clockMs);
  const ackDue = new Date(created.getTime() + DAY);

  return moderationTx(sql, async (t) => {
    const s = await salt(t);
    const keys = [...(email ? [emailKey(s, email)] : []), ...(input.ip ? [ipKey(s, input.ip)] : [])];
    const eligible = category.autoHide && (input.targetType === 'post' || category.autoHideProfiles);
    const trusted = eligible && (await standingAllowsAutoHide(t, keys));
    const budget = trusted && (await autoHideBudgetLeft(t));
    const autoHidden = trusted && budget;

    const rows = await t<{ id: string }[]>`
      insert into reports (ref, status_token_hash, category, rule, target_type, target, details, reporter_name, reporter_email, on_behalf, declaration,
                           reporter_key, reporter_ip, country, auto_hidden, created_at, ack_due_at, acknowledged_at, resolve_due_at)
      values (${ref}, ${sha256(token)}, ${input.category}, ${category.rule}, ${input.targetType}, ${target}, ${details}, ${input.name?.trim() || null}, ${email ?? null},
              ${input.onBehalf ?? false}, ${input.declaration ?? false}, ${email ? emailKey(s, email) : null}, ${input.ip ?? null}, ${input.country ?? null},
              ${autoHidden}, ${created}, ${ackDue}, ${created}, ${resolveDue})
      returning id`;
    const reportId = (rows[0] as { id: string }).id;
    await audit(t, 'system', 'report_filed', ref, { category: input.category, target: `${input.targetType}:${target}`, autoHidden });

    if (autoHidden) {
      await changeHolds(
        t,
        { targetType: input.targetType, target, reasonCode: input.category, actor: 'system', legalBasis: category.rule, reportId, publishTarget: !category.privateTarget, note: `Automatic hold pending review of ${ref}` },
        () => insertHold(t, input.targetType, target, { kind: 'hide', source: 'report', automatic: true, reportId, reasonCode: input.category }, 'system'),
      );
    }

    if (trusted && !budget) {
      // Someone may be flooding the form. One alarm an hour, not one per report.
      await raiseAlert(t, {
        severity: 'p0',
        kind: 'auto_hide_budget',
        subject: 'Automatic hiding paused: too many reports this hour',
        body: `More than ${AUTO_HIDE_BUDGET_PER_HOUR} targets were hidden automatically in the last hour. New reports are queued without hiding. Check the queue for a flood.`,
        link: '/admin',
        dedupeKey: `budget:${hourStamp()}`,
      });
    } else {
      await raiseAlert(t, {
        severity: category.severity,
        kind: 'report',
        subject: `${category.label}: ${ref}`,
        body: autoHidden ? 'Hidden automatically. Review it in the console.' : 'Waiting in the review queue.',
        link: '/admin',
        dedupeKey: `report:${ref}`,
        dueAt: resolveDue,
      });
    }
    return { ref, token, autoHidden, rule: category.rule, resolveDueAt: resolveDue, category: input.category };
  });
}

export type ReportStatus = { ref: string; status: string; category: string; decision: string | null; decisionReason: string | null; createdAt: Date; resolvedAt: Date | null };

export async function reportStatus(sql: Sql, ref: string, token: string): Promise<ReportStatus | null> {
  const row = (await sql<{ status_token_hash: string; ref: string; status: string; category: string; decision: string | null; decision_reason: string | null; created_at: Date; resolved_at: Date | null }[]>`
    select ref, status_token_hash, status, category, decision, decision_reason, created_at, resolved_at from reports where ref = ${ref}`)[0];
  if (!row || row.status_token_hash !== sha256(token)) return null;
  return { ref: row.ref, status: row.status, category: row.category, decision: row.decision, decisionReason: row.decision_reason, createdAt: row.created_at, resolvedAt: row.resolved_at };
}

/** A reporter can take back their own complaint, except for child safety, which is always reviewed. */
export async function withdrawReport(sql: Sql, ref: string, token: string): Promise<boolean> {
  return moderationTx(sql, async (t) => {
    const row = (await t<{ id: string; status: string; status_token_hash: string; category: string; target_type: TargetType; target: string }[]>`
      select id, status, status_token_hash, category, target_type, target from reports where ref = ${ref}`)[0];
    if (!row || row.status_token_hash !== sha256(token) || row.status !== 'open') return false;
    if (row.category === 'child_safety') return false;

    await t`update reports set status = 'withdrawn', resolved_at = now() where id = ${row.id}`;
    await audit(t, 'reporter', 'report_withdrawn', ref);
    await closeAlerts(t, ref);
    // Only this report's own hold is released. Any other reason to keep it hidden still stands.
    await changeHolds(
      t,
      { targetType: row.target_type, target: row.target, reasonCode: 'report_withdrawn', actor: 'system', reportId: row.id, publishTarget: !CATEGORIES[row.category]?.privateTarget },
      async () => void (await releaseHolds(t, row.target_type, row.target, { reportId: row.id }, 'system', 'report withdrawn')),
    );
    return true;
  });
}

export type ReportDecision = {
  decision: 'removed' | 'withheld' | 'restored' | 'no_action' | 'labelled';
  reason: string;
  actor: string;
  falseReport?: boolean;
  countries?: string[];
  label?: string;
  externalReportRef?: string;
  publicNote?: string;
};

export async function decideReport(sql: Sql, ref: string, d: ReportDecision): Promise<void> {
  const reason = required(d.reason, 'A written reason');
  await moderationTx(sql, async (t) => {
    const row = (await t<{ id: string; status: string; category: string; rule: string; target_type: TargetType; target: string; reporter_key: string | null; reporter_ip: string | null }[]>`
      select id, status, category, rule, target_type, target, reporter_key, reporter_ip from reports where ref = ${ref}`)[0];
    if (!row) throw new SafetyError('No such report');
    if (row.status !== 'open') throw new SafetyError('This report has already been closed');
    const category = CATEGORIES[row.category];
    const action: ActionInput = {
      targetType: row.target_type,
      target: row.target,
      reasonCode: d.decision === 'removed' || d.decision === 'withheld' ? row.category : 'restored_after_review',
      actor: d.actor,
      legalBasis: row.rule,
      reportId: row.id,
      note: reason,
      publishTarget: !category?.privateTarget,
      ...(d.publicNote ? { publicNote: d.publicNote } : {}),
    };
    if (d.decision === 'withheld' && cleanCountries(d.countries ?? []).length === 0) throw new SafetyError('Name at least one two-letter country code');
    if (d.decision === 'labelled' && (!d.label || !LABELS[d.label])) throw new SafetyError('Pick a label');

    // The report's own hold is replaced by whatever this decision places. Nothing else is touched.
    await changeHolds(t, action, async () => {
      await releaseHolds(t, row.target_type, row.target, { reportId: row.id }, d.actor, `decided: ${d.decision}`);
      if (d.decision === 'removed') {
        await insertHold(t, row.target_type, row.target, { kind: 'hide', source: 'report', reportId: row.id, reasonCode: row.category, ...(d.publicNote ? { publicNote: d.publicNote } : {}) }, d.actor);
      } else if (d.decision === 'withheld') {
        await insertHold(t, row.target_type, row.target, { kind: 'withhold', countries: cleanCountries(d.countries ?? []), source: 'report', reportId: row.id, reasonCode: row.category, ...(d.publicNote ? { publicNote: d.publicNote } : {}) }, d.actor);
      }
    });
    if (d.decision === 'labelled' && d.label) {
      const inserted = await t`
        insert into labels (target_type, target, label, source) values (${row.target_type}, ${row.target}, ${d.label}, 'operator')
        on conflict do nothing returning label`;
      if (inserted.length) await logAction(t, 'label', action, row.category, { label: d.label });
    }

    if (d.falseReport) {
      const s = await salt(t);
      for (const key of [row.reporter_key, row.reporter_ip ? ipKey(s, row.reporter_ip) : null]) {
        if (!key) continue;
        await t`
          insert into reporter_standing (key, false_count, last_false_at) values (${key}, 1, now())
          on conflict (key) do update set false_count = reporter_standing.false_count + 1, last_false_at = now()`;
      }
    }

    await t`
      update reports set status = 'resolved', resolved_at = now(), decision = ${d.decision}, decision_reason = ${reason},
        decided_by = ${d.actor}, false_report = ${d.falseReport ?? false}, external_report_ref = ${d.externalReportRef ?? null}
      where id = ${row.id}`;
    await audit(t, d.actor, 'report_decided', ref, { decision: d.decision, reason, falseReport: d.falseReport ?? false });
    await closeAlerts(t, ref);
  });
}

// ---- legal orders ----------------------------------------------------------------------------

export type OrderInput = {
  kind: 'court' | 'government' | 'police';
  authority: string;
  officerName: string;
  officerDesignation: string;
  orderReference: string;
  contactEmail: string;
  targets: { type: TargetType; target: string }[];
  scopeCountries: string[];
  documentUrl?: string;
  details?: string;
  ip?: string;
};

export async function fileOrder(sql: Sql, o: OrderInput): Promise<{ ref: string; dueAt: Date }> {
  if (!o.targets?.length) throw new SafetyError('Name at least one target post or account');
  for (const [value, what] of [
    [o.authority, 'The issuing authority'],
    [o.officerName, 'The officer name'],
    [o.officerDesignation, 'The officer designation'],
    [o.orderReference, 'The order reference'],
    [o.contactEmail, 'A contact email'],
  ] as const) {
    required(value, what);
  }
  const ref = makeRef('O');
  const received = new Date();
  const due = new Date(received.getTime() + 3 * HOUR);
  await moderationTx(sql, async (t) => {
    await t`
      insert into legal_orders (ref, kind, authority, officer_name, officer_designation, order_reference, contact_email, targets, scope_countries, document_url, details, submitter_ip, received_at, due_at, publish)
      values (${ref}, ${o.kind}, ${o.authority}, ${o.officerName}, ${o.officerDesignation}, ${o.orderReference}, ${o.contactEmail}, ${t.json(o.targets as never)},
              ${cleanCountries(o.scopeCountries)}, ${o.documentUrl ?? null}, ${o.details ?? ''}, ${o.ip ?? null}, ${received}, ${due}, ${o.kind === 'court'})`;
    await audit(t, 'system', 'order_received', ref, { kind: o.kind, authority: o.authority, reference: o.orderReference });
    await raiseAlert(t, {
      severity: 'p0',
      kind: 'order',
      subject: `Legal order from ${o.authority}: ${ref}`,
      body: 'Verify and act within 3 hours. Nothing changes until you decide.',
      link: '/admin',
      dedupeKey: `order:${ref}`,
      dueAt: due,
    });
  });
  return { ref, dueAt: due };
}

/**
 * Court orders are published by default. Government and police orders aren't, because blocking
 * orders under Section 69A must be kept confidential. The operator can override either way.
 */
export async function decideOrder(sql: Sql, ref: string, d: { status: 'actioned' | 'rejected' | 'challenged'; note: string; actor: string; publish?: boolean }): Promise<void> {
  const note = required(d.note, 'A written note');
  await moderationTx(sql, async (t) => {
    const row = (await t<{ id: string; status: string; kind: string; targets: { type: TargetType; target: string }[]; scope_countries: string[] }[]>`
      select id, status, kind, targets, scope_countries from legal_orders where ref = ${ref}`)[0];
    if (!row) throw new SafetyError('No such order');
    if (row.status !== 'received') throw new SafetyError('This order has already been decided');
    const publish = d.publish ?? row.kind === 'court';

    if (d.status === 'actioned') {
      for (const { type, target } of row.targets) {
        const action: ActionInput = { targetType: type, target, reasonCode: 'legal_order', actor: d.actor, legalBasis: `${row.kind} order`, orderId: row.id, publishTarget: publish, note };
        await changeHolds(t, action, () =>
          insertHold(t, type, target, row.scope_countries.length
            ? { kind: 'withhold', countries: row.scope_countries, source: 'order', orderId: row.id, reasonCode: 'legal_order' }
            : { kind: 'hide', source: 'order', orderId: row.id, reasonCode: 'legal_order' }, d.actor),
        );
      }
    }
    await t`
      update legal_orders set status = ${d.status}, actioned_at = now(), actioned_by = ${d.actor}, decision_note = ${note}, publish = ${publish}
      where id = ${row.id}`;
    await audit(t, d.actor, 'order_decided', ref, { status: d.status, note, publish });
    await closeAlerts(t, ref);
  });
}

/** Ends a legal order, for example after a court sets it aside. Only this order's holds are released. */
export async function liftOrder(sql: Sql, ref: string, d: { note: string; actor: string }): Promise<void> {
  const note = required(d.note, 'A written note');
  await moderationTx(sql, async (t) => {
    const row = (await t<{ id: string; status: string; kind: string; targets: { type: TargetType; target: string }[]; publish: boolean }[]>`
      select id, status, kind, targets, publish from legal_orders where ref = ${ref}`)[0];
    if (!row) throw new SafetyError('No such order');
    if (row.status !== 'actioned') throw new SafetyError('Only an order that was acted on can be lifted');
    for (const { type, target } of row.targets) {
      const action: ActionInput = { targetType: type, target, reasonCode: 'legal_order_lifted', actor: d.actor, legalBasis: `${row.kind} order lifted`, orderId: row.id, publishTarget: row.publish, note };
      await changeHolds(t, action, async () => void (await releaseHolds(t, type, target, { orderId: row.id }, d.actor, note)));
    }
    await t`update legal_orders set status = 'lifted', lifted_at = now(), lifted_by = ${d.actor}, lift_note = ${note} where id = ${row.id}`;
    await audit(t, d.actor, 'order_lifted', ref, { note });
  });
}

// ---- data requests ---------------------------------------------------------------------------

export type DataRequestInput = {
  authority: string;
  officerName: string;
  officerDesignation: string;
  legalBasis: string;
  contactEmail: string;
  subject: string;
  details?: string;
  ip?: string;
};

export async function fileDataRequest(sql: Sql, r: DataRequestInput): Promise<{ ref: string; dueAt: Date }> {
  for (const [value, what] of [
    [r.authority, 'The requesting authority'],
    [r.officerName, 'The officer name'],
    [r.officerDesignation, 'The officer designation'],
    [r.legalBasis, 'The legal basis'],
    [r.contactEmail, 'A contact email'],
    [r.subject, 'What the request concerns'],
  ] as const) {
    required(value, what);
  }
  const ref = makeRef('D');
  const received = new Date();
  const due = new Date(received.getTime() + 72 * HOUR);
  await moderationTx(sql, async (t) => {
    await t`
      insert into data_requests (ref, authority, officer_name, officer_designation, legal_basis, contact_email, subject, details, submitter_ip, received_at, due_at)
      values (${ref}, ${r.authority}, ${r.officerName}, ${r.officerDesignation}, ${r.legalBasis}, ${r.contactEmail}, ${r.subject}, ${r.details ?? ''}, ${r.ip ?? null}, ${received}, ${due})`;
    await audit(t, 'system', 'data_request_received', ref, { authority: r.authority, basis: r.legalBasis });
    await raiseAlert(t, {
      severity: 'p1',
      kind: 'data_request',
      subject: `Data request from ${r.authority}: ${ref}`,
      body: 'Verify and respond within 72 hours.',
      link: '/admin',
      dedupeKey: `data:${ref}`,
      dueAt: due,
    });
  });
  return { ref, dueAt: due };
}

export async function respondToDataRequest(sql: Sql, ref: string, d: { status: 'responded' | 'rejected'; note: string; actor: string }): Promise<void> {
  const note = required(d.note, 'A written note');
  await moderationTx(sql, async (t) => {
    const updated = await t`
      update data_requests set status = ${d.status}, responded_at = now(), responded_by = ${d.actor}, response_note = ${note}
      where ref = ${ref} and status = 'received' returning ref`;
    if (updated.length === 0) throw new SafetyError('No open data request with that reference');
    await audit(t, d.actor, 'data_request_decided', ref, { status: d.status, note });
    await closeAlerts(t, ref);
  });
}

// ---- appeals ---------------------------------------------------------------------------------

export type AppealInput = { targetType: TargetType; target: string; email: string; statement: string; verifiedAuthor?: boolean; ip?: string };

export async function fileAppeal(sql: Sql, a: AppealInput): Promise<{ ref: string; dueAt: Date; token: string }> {
  const target = required(a.target, 'What you are appealing');
  const email = required(a.email, 'An email address');
  if (!EMAIL_RE.test(email)) throw new SafetyError('That email address does not look right');
  const statement = required(a.statement, 'Your statement').slice(0, MAX_DETAILS);
  const ref = makeRef('A');
  const token = randomBytes(24).toString('base64url');
  const created = new Date();
  const due = new Date(created.getTime() + 7 * DAY);
  await moderationTx(sql, async (t) => {
    await t`
      insert into appeals (ref, target_type, target, appellant_email, statement, verified_author, submitter_ip, created_at, due_at, status_token_hash)
      values (${ref}, ${a.targetType}, ${target}, ${email}, ${statement}, ${a.verifiedAuthor ?? false}, ${a.ip ?? null}, ${created}, ${due}, ${sha256(token)})`;
    await audit(t, 'system', 'appeal_filed', ref, { target: `${a.targetType}:${target}` });
    await raiseAlert(t, {
      severity: 'p3',
      kind: 'appeal',
      subject: `Appeal: ${ref}`,
      body: 'Review within 7 days.',
      link: '/admin',
      dedupeKey: `appeal:${ref}`,
      dueAt: due,
    });
  });
  return { ref, dueAt: due, token };
}

/** Overturning restores what reports and operators hid. It never lifts a legal order. */
export async function decideAppeal(sql: Sql, ref: string, d: { status: 'upheld' | 'overturned'; note: string; actor: string }): Promise<void> {
  const note = required(d.note, 'A written note');
  await moderationTx(sql, async (t) => {
    const row = (await t<{ id: string; status: string; target_type: TargetType; target: string }[]>`
      select id, status, target_type, target from appeals where ref = ${ref}`)[0];
    if (!row) throw new SafetyError('No such appeal');
    if (row.status !== 'open') throw new SafetyError('This appeal has already been decided');
    if (d.status === 'overturned') {
      const action: ActionInput = { targetType: row.target_type, target: row.target, reasonCode: 'appeal_overturned', actor: d.actor, appealId: row.id, note };
      await changeHolds(t, action, async () => void (await releaseHolds(t, row.target_type, row.target, { sources: ['report', 'operator'] }, d.actor, note)));
    }
    await t`update appeals set status = ${d.status}, decided_at = now(), decided_by = ${d.actor}, decision_note = ${note} where id = ${row.id}`;
    await audit(t, d.actor, 'appeal_decided', ref, { status: d.status, note });
    await closeAlerts(t, ref);
  });
}

export async function appealStatus(sql: Sql, ref: string, token: string): Promise<{ ref: string; status: string; decidedAt: Date | null; note: string | null; dueAt: Date } | null> {
  const row = (await sql<{ ref: string; status: string; decided_at: Date | null; decision_note: string | null; due_at: Date; status_token_hash: string | null }[]>`
    select ref, status, decided_at, decision_note, due_at, status_token_hash from appeals where ref = ${ref}`)[0];
  if (!row || !row.status_token_hash || row.status_token_hash !== sha256(token)) return null;
  return { ref: row.ref, status: row.status, decidedAt: row.decided_at, note: row.decision_note, dueAt: row.due_at };
}

// ---- operator queue --------------------------------------------------------------------------

export type QueueItem = { kind: 'report' | 'order' | 'data_request' | 'appeal'; ref: string; dueAt: Date; createdAt: Date; title: string; severity: Severity; target: string | null; targetType: TargetType | null };

export async function queue(sql: Sql): Promise<QueueItem[]> {
  const [reports, orders, requests, appeals] = await Promise.all([
    sql<{ ref: string; resolve_due_at: Date; created_at: Date; category: string; target: string; target_type: TargetType }[]>`
      select ref, resolve_due_at, created_at, category, target, target_type from reports where status = 'open'`,
    sql<{ ref: string; due_at: Date; received_at: Date; authority: string }[]>`select ref, due_at, received_at, authority from legal_orders where status = 'received'`,
    sql<{ ref: string; due_at: Date; received_at: Date; authority: string }[]>`select ref, due_at, received_at, authority from data_requests where status = 'received'`,
    sql<{ ref: string; due_at: Date; created_at: Date; target: string; target_type: TargetType }[]>`select ref, due_at, created_at, target, target_type from appeals where status = 'open'`,
  ]);
  const items: QueueItem[] = [
    ...reports.map((r): QueueItem => ({ kind: 'report', ref: r.ref, dueAt: r.resolve_due_at, createdAt: r.created_at, title: CATEGORIES[r.category]?.label ?? r.category, severity: CATEGORIES[r.category]?.severity ?? 'p3', target: r.target, targetType: r.target_type })),
    ...orders.map((o): QueueItem => ({ kind: 'order', ref: o.ref, dueAt: o.due_at, createdAt: o.received_at, title: `Legal order: ${o.authority}`, severity: 'p0', target: null, targetType: null })),
    ...requests.map((d): QueueItem => ({ kind: 'data_request', ref: d.ref, dueAt: d.due_at, createdAt: d.received_at, title: `Data request: ${d.authority}`, severity: 'p1', target: null, targetType: null })),
    ...appeals.map((a): QueueItem => ({ kind: 'appeal', ref: a.ref, dueAt: a.due_at, createdAt: a.created_at, title: 'Appeal', severity: 'p3', target: a.target, targetType: a.target_type })),
  ];
  return items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** Active orders, for the console's "lift" control. */
export async function activeOrders(sql: Sql): Promise<{ ref: string; authority: string; reference: string; kind: string; actionedAt: Date | null }[]> {
  const rows = await sql<{ ref: string; authority: string; order_reference: string; kind: string; actioned_at: Date | null }[]>`
    select ref, authority, order_reference, kind, actioned_at from legal_orders where status = 'actioned' order by actioned_at desc limit 200`;
  return rows.map((r) => ({ ref: r.ref, authority: r.authority, reference: r.order_reference, kind: r.kind, actionedAt: r.actioned_at }));
}

// ---- transparency ----------------------------------------------------------------------------

export type Transparency = {
  counts: { category: string; label: string; total: number; removed: number; withheld: number; restored: number; noAction: number; open: number }[];
  actions: { at: Date; action: string; reasonCode: string; legalBasis: string | null; countries: string[]; targetType: string; target: string | null }[];
  orders: { receivedAt: Date; kind: string; authority: string; reference: string; status: string; countries: string[]; targets: { type: string; target: string }[] }[];
  ordersWithheldFromPublication: number;
  dataRequests: { received: number; responded: number; rejected: number; open: number };
  appeals: { received: number; upheld: number; overturned: number; open: number };
};

/** The public record. It holds no reporter details, no complaint text and no harmful pointers. */
export async function transparency(sql: Sql, limit = 100): Promise<Transparency> {
  const [counts, actions, orders, sealed, data, appeals] = await Promise.all([
    sql<{ category: string; total: number; removed: number; withheld: number; restored: number; no_action: number; open: number }[]>`
      select category, count(*)::int as total,
        count(*) filter (where decision = 'removed')::int as removed,
        count(*) filter (where decision = 'withheld')::int as withheld,
        count(*) filter (where decision = 'restored')::int as restored,
        count(*) filter (where decision = 'no_action')::int as no_action,
        count(*) filter (where status = 'open')::int as open
      from reports where status <> 'withdrawn' group by category order by category`,
    sql<{ at: Date; action: string; reason_code: string; legal_basis: string | null; countries: string[]; target_type: string; target: string; publish_target: boolean }[]>`
      select at, action, reason_code, legal_basis, countries, target_type, target, publish_target
      from moderation_actions order by id desc limit ${limit}`,
    sql<{ received_at: Date; kind: string; authority: string; order_reference: string; status: string; scope_countries: string[]; targets: { type: string; target: string }[] }[]>`
      select received_at, kind, authority, order_reference, status, scope_countries, targets
      from legal_orders where publish and status <> 'received' order by received_at desc limit ${limit}`,
    sql<{ n: number }[]>`select count(*)::int as n from legal_orders where not publish and status <> 'received'`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int as n from data_requests group by status`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int as n from appeals group by status`,
  ]);
  const tally = (rows: readonly { status: string; n: number }[], key: string) => rows.find((r) => r.status === key)?.n ?? 0;
  return {
    counts: counts.map((c) => ({ category: c.category, label: CATEGORIES[c.category]?.label ?? c.category, total: c.total, removed: c.removed, withheld: c.withheld, restored: c.restored, noAction: c.no_action, open: c.open })),
    actions: actions.map((a) => ({ at: a.at, action: a.action, reasonCode: a.reason_code, legalBasis: a.legal_basis, countries: a.countries, targetType: a.target_type, target: a.publish_target ? a.target : null })),
    orders: orders.map((o) => ({ receivedAt: o.received_at, kind: o.kind, authority: o.authority, reference: o.order_reference, status: o.status, countries: o.scope_countries, targets: o.targets })),
    ordersWithheldFromPublication: sealed[0]?.n ?? 0,
    dataRequests: { received: data.reduce((s, r) => s + r.n, 0), responded: tally(data, 'responded'), rejected: tally(data, 'rejected'), open: tally(data, 'received') },
    appeals: { received: appeals.reduce((s, r) => s + r.n, 0), upheld: tally(appeals, 'upheld'), overturned: tally(appeals, 'overturned'), open: tally(appeals, 'open') },
  };
}

// ---- housekeeping ----------------------------------------------------------------------------

export async function checkRateLimit(sql: Sql, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await sql<{ count: number }[]>`
    insert into rate_limits (bucket, window_start, count) values (${bucket}, ${windowStart}, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count`;
  return (rows[0]?.count ?? 0) <= limit;
}

export type AccessEntry = { method: string; route: string; status?: number; ip?: string | null; userAgent?: string | null; country?: string | null; profile?: string | null };

export async function logAccess(sql: Sql, e: AccessEntry): Promise<void> {
  await sql`
    insert into access_log (method, route, status, ip, user_agent, country, profile)
    values (${e.method}, ${e.route}, ${e.status ?? null}, ${e.ip ?? null}, ${e.userAgent?.slice(0, 300) ?? null}, ${e.country ?? null}, ${e.profile ?? null})`;
}

/** Removes data past its retention window. Decisions, holds, actions and the audit log are kept. */
export async function ageOutRecords(sql: Sql): Promise<{ accessLogs: number; reports: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY);
  const logs = await sql`delete from access_log where at < ${cutoff} returning id`;
  await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  await sql`delete from admin_logins where created_at < now() - interval '1 day'`;
  await sql`delete from reporter_standing where last_false_at < ${cutoff}`;
  const reports = await sql`
    update reports set reporter_email = null, reporter_name = null, reporter_ip = null, reporter_key = null, details = ''
    where status <> 'open' and resolved_at < ${cutoff}
      and (reporter_email is not null or reporter_ip is not null or reporter_name is not null or reporter_key is not null or details <> '')
    returning id`;
  await sql`update legal_orders set submitter_ip = null where status <> 'received' and actioned_at < ${cutoff} and submitter_ip is not null`;
  await sql`update data_requests set submitter_ip = null where status <> 'received' and responded_at < ${cutoff} and submitter_ip is not null`;
  await sql`
    update appeals set submitter_ip = null, appellant_email = ${ERASED}, statement = ${ERASED}
    where status <> 'open' and decided_at < ${cutoff} and appellant_email <> ${ERASED}`;
  return { accessLogs: logs.length, reports: reports.length };
}

/** Rule 3(1)(c): tell users every three months what non-compliance means. Publishes once per quarter. */
export async function publishQuarterlyNotice(sql: Sql, now: Date = new Date()): Promise<{ quarter: string; title: string; body: string } | null> {
  const quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  const title = 'A reminder of the rules';
  const body =
    'If you break the Rules, Terms or Privacy Policy, this app can suspend or terminate your access at once and remove or disable access to what you posted. ' +
    'If what you post breaks the law, you may be liable to penalty or punishment under the Information Technology Act or other law. ' +
    'Where an offence must by law be reported, including under the Bharatiya Nagarik Suraksha Sanhita, 2023 or the POCSO Act, 2012, it will be reported to the authorities.';
  const rows = await sql<{ quarter: string }[]>`
    insert into notices (quarter, title, body, published_at) values (${quarter}, ${title}, ${body}, ${now})
    on conflict do nothing returning quarter`;
  return rows.length ? { quarter, title, body } : null;
}

export async function currentNotice(sql: Sql): Promise<{ quarter: string; title: string; body: string; publishedAt: Date } | null> {
  const row = (await sql<{ quarter: string; title: string; body: string; published_at: Date }[]>`
    select quarter, title, body, published_at from notices order by published_at desc limit 1`)[0];
  return row ? { quarter: row.quarter, title: row.title, body: row.body, publishedAt: row.published_at } : null;
}

const warnThresholdMs = (totalMs: number) => (totalMs >= DAY ? 6 * HOUR : HOUR);

/** The heartbeat: escalates deadlines, ages out old data and publishes the quarterly notice. */
export async function tick(sql: Sql, options: { channels?: readonly AlertChannel[]; now?: Date } = {}): Promise<{ warnings: number; breaches: number; notice: string | null; aged: { accessLogs: number; reports: number }; dispatch: Awaited<ReturnType<typeof dispatchAlerts>> | null }> {
  const now = options.now ?? new Date();
  let warnings = 0;
  let breaches = 0;
  for (const item of await queue(sql)) {
    const left = item.dueAt.getTime() - now.getTime();
    const total = item.dueAt.getTime() - item.createdAt.getTime();
    if (left < 0) {
      await raiseAlert(sql, { severity: 'p0', kind: 'deadline_breach', subject: `DEADLINE MISSED: ${item.title} (${item.ref})`, body: 'Act now, and record why it was late.', link: '/admin', dedupeKey: `breach:${item.ref}`, dueAt: item.dueAt });
      breaches += 1;
    } else if (left <= warnThresholdMs(total)) {
      await raiseAlert(sql, { severity: 'p1', kind: 'deadline_warning', subject: `Deadline close: ${item.title} (${item.ref})`, body: `Due ${item.dueAt.toISOString()}.`, link: '/admin', dedupeKey: `warn:${item.ref}`, dueAt: item.dueAt });
      warnings += 1;
    }
  }
  const notice = await publishQuarterlyNotice(sql, now);
  const aged = await ageOutRecords(sql);
  const dispatch = options.channels ? await dispatchAlerts(sql, options.channels) : null;
  return { warnings, breaches, notice: notice?.quarter ?? null, aged, dispatch };
}
