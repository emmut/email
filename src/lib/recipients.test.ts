import { describe, expect, it } from 'vitest';

import { splitAddressList } from '@/lib/recipients';

describe('splitAddressList', () => {
  it('trims entries while preserving the empty autocomplete token', () => {
    expect(splitAddressList(' ann@example.com, Bob <bob@example.com>, ')).toEqual([
      'ann@example.com',
      'Bob <bob@example.com>',
      '',
    ]);
    expect(splitAddressList('')).toEqual(['']);
  });

  it('keeps commas inside quoted names and local parts', () => {
    expect(splitAddressList('"Öberg, Ann" <ann@example.com>, "last,first"@example.com')).toEqual([
      '"Öberg, Ann" <ann@example.com>',
      '"last,first"@example.com',
    ]);
  });

  it('distinguishes escaped quotes from the end of a quoted name', () => {
    expect(
      splitAddressList(String.raw`"Ann \"A\", Öberg" <ann@example.com>, bob@example.com`),
    ).toEqual([String.raw`"Ann \"A\", Öberg" <ann@example.com>`, 'bob@example.com']);
  });

  it('handles escaped backslashes before a closing quote', () => {
    expect(splitAddressList(String.raw`"Ann\\" <ann@example.com>, bob@example.com`)).toEqual([
      String.raw`"Ann\\" <ann@example.com>`,
      'bob@example.com',
    ]);
  });

  it('keeps nested comments and their commas attached to the address', () => {
    const entry = 'ann@example.com (Sales, (North, Team))';
    expect(splitAddressList(`${entry}, bob@example.com`)).toEqual([entry, 'bob@example.com']);
  });

  it('keeps an unfinished quoted entry together while typing', () => {
    expect(splitAddressList('ann@example.com, "Öberg, A')).toEqual([
      'ann@example.com',
      '"Öberg, A',
    ]);
  });
});
