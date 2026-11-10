import { describe, expect, it } from 'vitest';
import {
  MAX_WEIGHTED_LENGTH,
  extractHashtags,
  extractMentions,
  extractUrls,
  stripBidiControls,
  tokenize,
  weightedLength,
} from '../src/text';

describe('weightedLength', () => {
  it('counts latin characters as one', () => {
    expect(weightedLength('hello')).toBe(5);
    expect(weightedLength('a'.repeat(280))).toBe(MAX_WEIGHTED_LENGTH);
  });

  it('counts Devanagari as one per code point', () => {
    expect(weightedLength('नमस्ते')).toBe([...'नमस्ते'].length);
  });

  it('counts CJK as two', () => {
    expect(weightedLength('人間')).toBe(4);
  });

  it('counts each emoji as two, including multi-code-point sequences', () => {
    expect(weightedLength('😀')).toBe(2);
    expect(weightedLength('👨‍👩‍👧‍👦')).toBe(2);
    expect(weightedLength('🇮🇳')).toBe(2);
  });

  it('counts every link as 23 no matter how long', () => {
    expect(weightedLength('https://a.co')).toBe(23);
    expect(weightedLength(`https://example.com/${'x'.repeat(200)}`)).toBe(23);
    expect(weightedLength('see https://a.co now')).toBe(4 + 23 + 4);
  });

  it('counts an empty string as zero', () => {
    expect(weightedLength('')).toBe(0);
  });
});

describe('extractMentions', () => {
  it('finds and lowercases mentions, without duplicates', () => {
    expect(extractMentions('hi @Rishab and @rishab, @other_1')).toEqual(['rishab', 'other_1']);
  });

  it('ignores email addresses and too-short or too-long names', () => {
    expect(extractMentions('mail me@example.com')).toEqual([]);
    expect(extractMentions('@ab')).toEqual([]);
    expect(extractMentions(`@${'a'.repeat(16)}`)).toEqual([]);
  });

  it('finds mentions after punctuation and newlines', () => {
    expect(extractMentions('(@abc)\n@def.')).toEqual(['abc', 'def']);
  });
});

describe('extractHashtags', () => {
  it('finds and lowercases hashtags, without duplicates', () => {
    expect(extractHashtags('#Solana is #solana #web3')).toEqual(['solana', 'web3']);
  });

  it('supports Hindi with combining marks', () => {
    expect(extractHashtags('आज #भारत और #स्वतंत्रता')).toEqual(['भारत', 'स्वतंत्रता']);
  });

  it('ignores pure numbers and hashes inside words', () => {
    expect(extractHashtags('#123 abc#def')).toEqual([]);
    expect(extractHashtags('#123abc')).toEqual(['123abc']);
  });

  it('does not read a URL fragment as a hashtag', () => {
    expect(extractHashtags('https://a.co/x#frag')).toEqual([]);
  });
});

describe('extractUrls', () => {
  it('finds http and https links and drops trailing punctuation', () => {
    expect(extractUrls('go https://a.co/x, or (http://b.io).')).toEqual(['https://a.co/x', 'http://b.io']);
  });

  it('never treats javascript or data schemes as links', () => {
    expect(extractUrls('javascript:alert(1) data:text/html,hi')).toEqual([]);
  });
});

describe('tokenize', () => {
  it('splits text into renderable tokens that rebuild the original', () => {
    const text = 'hi @abc see https://a.co #tag!';
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.value).join('')).toBe(text);
    expect(tokens.filter((t) => t.type !== 'text').map((t) => [t.type, t.value])).toEqual([
      ['mention', '@abc'],
      ['url', 'https://a.co'],
      ['hashtag', '#tag'],
    ]);
  });

  it('does not split a mention out of a URL', () => {
    const tokens = tokenize('https://a.co/@abc');
    expect(tokens).toEqual([{ type: 'url', value: 'https://a.co/@abc' }]);
  });
});

describe('stripBidiControls', () => {
  it('removes direction overrides that can disguise text', () => {
    expect(stripBidiControls('abc‮gnp.exe‬⁦x⁩')).toBe('abcgnp.exex');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripBidiControls('नमस्ते مرحبا')).toBe('नमस्ते مرحبا');
  });
});
