import { describe, expect, it } from 'vitest';
import { formatMonth } from './format';

describe('formatMonth', () => {
  it('renders month name and year', () => {
    expect(formatMonth({ year: 2027, month: 1 })).toBe('January 2027');
    expect(formatMonth({ year: 2040, month: 12 })).toBe('December 2040');
  });
});
