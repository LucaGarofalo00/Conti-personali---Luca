import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { toDateString, todayString, getBillingPeriod, getBillingPeriodFor, getDateInCurrentPeriod, getCurrentPeriod, currentPeriodLabel, monthlyOccurrencesInCurrentPeriod, formatDayMonth } from './utils'
import { setLocalPeriodSettings, __resetPeriodSettingsForTest } from './periodSettings'

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

// ---------------------------------------------------------------------------
// Periodo configurabile: giorno fisso (anchorDay) e periodo variabile ancorato
// alla data reale dello stipendio (periodStart). Reset dopo ogni test ai default.
// ---------------------------------------------------------------------------
describe('getBillingPeriod with configurable anchorDay', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('anchor 27: May 20 → period 27 apr - 26 mag (still in previous cycle)', () => {
    vi.setSystemTime(new Date(2026, 4, 20))
    setLocalPeriodSettings({ anchorDay: 27 })
    expect(getBillingPeriod()).toEqual({ start: '2026-04-27', end: '2026-05-26' })
  })

  it('anchor 27: May 28 → period 27 mag - 26 giu (new cycle)', () => {
    vi.setSystemTime(new Date(2026, 4, 28))
    setLocalPeriodSettings({ anchorDay: 27 })
    expect(getBillingPeriod()).toEqual({ start: '2026-05-27', end: '2026-06-26' })
  })

  it('anchor 1: behaves like a calendar month', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ anchorDay: 1 })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-01', end: '2026-06-30' })
  })
})

describe('getCurrentPeriod with salary-anchored override', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('override 10 giu, today 20 giu → period 10 giu - 9 lug (same day next month minus 1)', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-10', end: '2026-07-09' })
  })

  it('open period: today is past the provisional end → end extends to today', () => {
    vi.setSystemTime(new Date(2026, 6, 15)) // 15 lug, oltre il 9 lug provvisorio
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-10', end: '2026-07-15' })
  })

  it('handles end-of-month start: 31 gen → 28 feb (addMonths clamps)', () => {
    vi.setSystemTime(new Date(2026, 1, 10)) // 10 feb
    setLocalPeriodSettings({ periodStart: '2026-01-31' })
    // addMonths(31 gen, 1) = 28 feb; -1 giorno = 27 feb
    expect(getBillingPeriod()).toEqual({ start: '2026-01-31', end: '2026-02-27' })
  })

  it('currentPeriodLabel reflects the override range', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(currentPeriodLabel()).toBe('10 giu – 9 lug')
  })
})

describe('getBillingPeriodFor with override', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('a date inside the current override period returns the current period', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10', anchorDay: 10 })
    const p = getBillingPeriodFor(new Date(2026, 5, 25))
    expect({ start: p.start, end: p.end }).toEqual({ start: '2026-06-10', end: '2026-07-09' })
  })

  it('a date outside the current period falls back to the fixed anchor', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10', anchorDay: 10 })
    // 5 mar è fuori dal periodo corrente → ancora a giorno fisso 10: 10 feb - 9 mar
    const p = getBillingPeriodFor(new Date(2026, 2, 5))
    expect({ start: p.start, end: p.end }).toEqual({ start: '2026-02-10', end: '2026-03-09' })
  })
})

describe('getDateInCurrentPeriod with override', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('places a day >= start day in the start month', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(toDateString(getDateInCurrentPeriod(12))).toBe('2026-06-12')
  })

  it('places a day < start day in the next month', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(toDateString(getDateInCurrentPeriod(5))).toBe('2026-07-05')
  })
})

describe('monthlyOccurrencesInCurrentPeriod', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('normal ~1-month period: exactly one occurrence (start month)', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' }) // period 10 giu - 9 lug
    const occ = monthlyOccurrencesInCurrentPeriod(12).map(toDateString)
    expect(occ).toEqual(['2026-06-12'])
  })

  it('normal period: day before start day lands in the next month, still one occurrence', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    const occ = monthlyOccurrencesInCurrentPeriod(5).map(toDateString)
    expect(occ).toEqual(['2026-07-05'])
  })

  it('extended/open period (late salary) spanning >1 month: TWO occurrences', () => {
    vi.setSystemTime(new Date(2026, 6, 20)) // 20 lug, oltre il 9 lug provvisorio → fine estesa a oggi
    setLocalPeriodSettings({ periodStart: '2026-06-10' }) // period 10 giu - 20 lug
    const occ = monthlyOccurrencesInCurrentPeriod(12).map(toDateString)
    expect(occ).toEqual(['2026-06-12', '2026-07-12'])
  })

  it('default cycle: one occurrence, matching the old single-date behavior', () => {
    vi.setSystemTime(new Date(2026, 4, 19)) // period 15 mag - 14 giu
    const occ = monthlyOccurrencesInCurrentPeriod(20).map(toDateString)
    expect(occ).toEqual(['2026-05-20'])
  })
})

describe('getCurrentPeriod default (no settings) is unchanged 15→14', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('matches the historic billing period', () => {
    vi.setSystemTime(new Date(2026, 4, 19))
    const p = getCurrentPeriod()
    expect({ start: p.start, end: p.end }).toEqual({ start: '2026-05-15', end: '2026-06-14' })
  })
})
