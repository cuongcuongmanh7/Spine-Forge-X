import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './time';

describe('formatDate / formatDateTime', () => {
  it('formats as dd/mm/yyyy with zero-padding', () => {
    // Local-time constructor + local getters → timezone-stable assertion.
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(formatDate(new Date(2026, 11, 31))).toBe('31/12/2026');
  });

  it('formats date + time as dd/mm/yyyy HH:mm (24h)', () => {
    expect(formatDateTime(new Date(2026, 5, 20, 9, 3))).toBe('20/06/2026 09:03');
    expect(formatDateTime(new Date(2026, 5, 20, 14, 30))).toBe('20/06/2026 14:30');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDate(NaN)).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});
