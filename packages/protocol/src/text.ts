/**
 * Canonical text rules. Indexers and clients share them, so a hashtag or mention means the same
 * thing everywhere. Weighting follows the familiar 280-character convention: most scripts count
 * one per code point, ideographic scripts and emoji count two, and any link counts 23.
 */

export const MAX_WEIGHTED_LENGTH = 280;
const URL_WEIGHT = 23;

const ONE_WEIGHT_RANGES: readonly (readonly [number, number])[] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»”’…]+$/;
const MENTION_RE = /(?<![\p{L}\p{M}\p{N}_@./])@([a-zA-Z0-9_]{3,15})(?![a-zA-Z0-9_])/gu;
const HASHTAG_RE = /(?<![\p{L}\p{M}\p{N}_#&/])#([\p{L}\p{M}\p{N}_]{1,64})/gu;
const HAS_NON_DIGIT = /[\p{L}\p{M}_]/u;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function codePointWeight(cp: number): number {
  return ONE_WEIGHT_RANGES.some(([start, end]) => cp >= start && cp <= end) ? 1 : 2;
}

function plainWeight(text: string): number {
  let total = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (EMOJI_RE.test(segment)) {
      total += 2;
      continue;
    }
    for (const ch of segment) total += codePointWeight(ch.codePointAt(0) as number);
  }
  return total;
}

function urlSpans(text: string): { start: number; end: number; url: string }[] {
  const spans: { start: number; end: number; url: string }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCTUATION, '');
    spans.push({ start: m.index, end: m.index + url.length, url });
  }
  return spans;
}

export function weightedLength(text: string): number {
  let total = 0;
  let cursor = 0;
  for (const { start, end } of urlSpans(text)) {
    total += plainWeight(text.slice(cursor, start)) + URL_WEIGHT;
    cursor = end;
  }
  return total + plainWeight(text.slice(cursor));
}

export function extractUrls(text: string): string[] {
  return urlSpans(text).map((s) => s.url);
}

function withoutUrls(text: string): string {
  // Replacing with spaces keeps offsets and stops a URL's @ or # from being read as a token.
  return text.replace(URL_RE, (m) => ' '.repeat(m.length));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function extractMentions(text: string): string[] {
  return unique([...withoutUrls(text).matchAll(MENTION_RE)].map((m) => (m[1] as string).toLowerCase()));
}

export function extractHashtags(text: string): string[] {
  return unique(
    [...withoutUrls(text).matchAll(HASHTAG_RE)]
      .map((m) => m[1] as string)
      .filter((tag) => HAS_NON_DIGIT.test(tag))
      .map((tag) => tag.normalize('NFC').toLowerCase()),
  );
}

export type TextToken = { type: 'text' | 'mention' | 'hashtag' | 'url'; value: string };

/** Splits text into tokens whose values concatenate back to the original string. */
export function tokenize(text: string): TextToken[] {
  const marks: { start: number; end: number; type: TextToken['type'] }[] = [];
  for (const { start, end } of urlSpans(text)) marks.push({ start, end, type: 'url' });
  const masked = withoutUrls(text);
  for (const m of masked.matchAll(MENTION_RE)) {
    marks.push({ start: m.index, end: m.index + m[0].length, type: 'mention' });
  }
  for (const m of masked.matchAll(HASHTAG_RE)) {
    if (HAS_NON_DIGIT.test(m[1] as string)) marks.push({ start: m.index, end: m.index + m[0].length, type: 'hashtag' });
  }
  marks.sort((a, b) => a.start - b.start);

  const tokens: TextToken[] = [];
  let cursor = 0;
  for (const { start, end, type } of marks) {
    if (start > cursor) tokens.push({ type: 'text', value: text.slice(cursor, start) });
    tokens.push({ type, value: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) });
  return tokens;
}

/** Removes direction-override controls, which can make text read differently from its bytes. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}
