import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { toDateString, todayString, getBillingPeriod, getDateInCurrentPeriod, formatDayMonth } from './utils'

describe('toDateString', () => {
  it('returns local-time YYYY-MM-DD for a Date constructed with local components', () => {
    const d = new Date(2026, 4, 15)
    expect(toDateString(d)).toBe('2026-05-15')
  })

  it('does NOT shift the date due to UTC conversion (bug fix)', () => {
    const d = new Date(2026, 4, 15, 0, 0, 0)
    expect(toDateString(d)).toBe('2026-05-15')
    expect(d.toISOString().split('T')[0]).not.toBe('2026-05-15')
  })

  it('handles year boundary correctly', () => {
    expect(toDateString(new Date(2026, 11, 31))).toBe('2026-12-31')
    expect(toDateString(new Date(2027, 0, 1))).toBe('2027-01-01')
  })

  it('pads month and day with leading zero', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toDateString(new Date(2026, 8, 9))).toBe('2026-09-09')
  })
})

describe('todayString', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 14, 30, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('returns today as YYYY-MM-DD in local time', () => {
    expect(todayString()).toBe('2026-05-19')
  })
})

describe('getBillingPeriod', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })

  it('returns May 15 - Jun 14 when today is May 19', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(getBillingPeriod()).toEqual({ start: '2026-05-15', end: '2026-06-14' })
  })

  it('returns Apr 15 - May 14 when today is May 10', () => {
    vi.setSystemTime(new Date(2026, 4, 10))
    expect(getBillingPeriod()).toEqual({ start: '2026-04-15', end: '2026-05-14' })
  })

  it('boundary: on day 15 starts new period', () => {
    vi.setSystemTime(new Date(2026, 4, 15))
    expect(getBillingPeriod()).toEqual({ start: '2026-05-15', end: '2026-06-14' })
  })

  it('boundary: on day 14 still in previous period', () => {
    vi.setSystemTime(new Date(2026, 4, 14))
    expect(getBillingPeriod()).toEqual({ start: '2026-04-15', end: '2026-05-14' })
  })

  it('crosses year correctly: Dec → Jan period', () => {
    vi.setSystemTime(new Date(2026, 11, 20))
    expect(getBillingPeriod()).toEqual({ start: '2026-12-15', end: '2027-01-14' })
  })

  it('crosses year correctly: Jan still belongs to Dec period', () => {
    vi.setSystemTime(new Date(2027, 0, 10))
    expect(getBillingPeriod()).toEqual({ start: '2026-12-15', end: '2027-01-14' })
  })
})

describe('getDateInCurrentPeriod', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })

  it('places day 20 in start month when today is May 19', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(toDateString(getDateInCurrentPeriod(20))).toBe('2026-05-20')
  })

  it('places day 5 in end month when today is May 19', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(toDateString(getDateInCurrentPeriod(5))).toBe('2026-06-05')
  })

  it('places day 14 (last of period) in end month', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(toDateString(getDateInCurrentPeriod(14))).toBe('2026-06-14')
  })

  it('places day 15 (first of period) in start month', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(toDateString(getDateInCurrentPeriod(15))).toBe('2026-05-15')
  })

  it('handles year boundary: Dec 20 + day 5 → Jan 5', () => {
    vi.setSystemTime(new Date(2026, 11, 20))
    expect(toDateString(getDateInCurrentPeriod(5))).toBe('2027-01-05')
  })
})

describe('formatDayMonth', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })

  it('formats day 15 as 15 mag (current period), not jun', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(formatDayMonth(15)).toBe('15 mag')
  })

  it('formats day 1 as 1 giu (in current period end month)', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(formatDayMonth(1)).toBe('1 giu')
  })

  it('does not jump to next billing period for early-period days', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    expect(formatDayMonth(18)).toBe('18 mag')
  })
})
