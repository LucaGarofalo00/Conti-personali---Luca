import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { toDateString, todayString, getBillingPeriod, getBillingPeriodFor, getDateInCurrentPeriod, getCurrentPeriod, getNextSalaryDate, currentPeriodLabel, monthlyOccurrencesInCurrentPeriod, formatDayMonth, sameWeekWeekday } from './utils'
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

  it('override 10 giu (anchor 15), today 20 giu → fine ancorata al 14 lug (giorno prima del 15), non al 9', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-10', end: '2026-07-14' })
  })

  it('accredito in ritardo: stipendio il 18 giu (anchor 15) → 18 giu – 14 lug', () => {
    vi.setSystemTime(new Date(2026, 5, 21))
    setLocalPeriodSettings({ periodStart: '2026-06-18' })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-18', end: '2026-07-14' })
  })

  it('open period: oggi ha superato la fine provvisoria (14 lug) → si estende a oggi', () => {
    vi.setSystemTime(new Date(2026, 6, 20)) // 20 lug, oltre il 14 lug provvisorio
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(getBillingPeriod()).toEqual({ start: '2026-06-10', end: '2026-07-20' })
  })

  it('la data d\'inizio sposta solo l\'inizio: 31 gen (anchor 15) → 31 gen – 14 feb', () => {
    vi.setSystemTime(new Date(2026, 1, 10)) // 10 feb
    setLocalPeriodSettings({ periodStart: '2026-01-31' })
    expect(getBillingPeriod()).toEqual({ start: '2026-01-31', end: '2026-02-14' })
  })

  it('currentPeriodLabel reflects the override range', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' })
    expect(currentPeriodLabel()).toBe('10 giu – 14 lug')
  })
})

// REGRESSIONE — "nel periodo mi viene segnato anche il prossimo stipendio".
// Il periodo finisce il giorno prima dell'anchor del mese successivo, quindi l'anchor DEVE essere
// il giorno atteso dello stipendio (= day_of_month dell'entrata-stipendio, vedi
// anchorFromSalaryIncome). Se divergono — stipendio il 14, anchor 15 rimasto al default — la fine
// scivola sul 14 del mese dopo e il giorno 14 ricade DUE volte nello stesso periodo: due stipendi.
describe('periodo coerente col giorno dello stipendio (anchor = day_of_month)', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('stipendio il 14 con anchor 14 → periodo 14 lug – 13 ago (fino al giorno prima del prossimo)', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 14 })
    expect(getBillingPeriod()).toEqual({ start: '2026-07-14', end: '2026-08-13' })
  })

  it('con anchor coerente il giorno dello stipendio ricorre UNA sola volta nel periodo', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 14 })
    expect(monthlyOccurrencesInCurrentPeriod(14).map(toDateString)).toEqual(['2026-07-14'])
  })

  it('BUG STORICO: con anchor 15 e stipendio il 14 il giorno 14 ricorre DUE volte', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 15 })
    expect(getBillingPeriod()).toEqual({ start: '2026-07-14', end: '2026-08-14' })
    expect(monthlyOccurrencesInCurrentPeriod(14).map(toDateString)).toEqual(['2026-07-14', '2026-08-14'])
  })

  it('accredito in RITARDO (atteso il 14, arrivato il 18): sposta solo l\'inizio → 18 lug – 13 ago', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-18', anchorDay: 14 })
    expect(getBillingPeriod()).toEqual({ start: '2026-07-18', end: '2026-08-13' })
    // Il prossimo stipendio (14 ago) resta FUORI: nessun doppio conteggio.
    expect(monthlyOccurrencesInCurrentPeriod(14)).toEqual([])
  })

  it('accredito in ANTICIPO (atteso il 14, arrivato il 12): 12 lug – 13 ago, un solo stipendio', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-12', anchorDay: 14 })
    expect(getBillingPeriod()).toEqual({ start: '2026-07-12', end: '2026-08-13' })
    expect(monthlyOccurrencesInCurrentPeriod(14).map(toDateString)).toEqual(['2026-07-14'])
  })
})

// La card "Saldo il …" della dashboard punta alla FINE DEL PERIODO, e il giorno atteso del prossimo
// stipendio è il giorno dopo. Prima puntava alla "prossima occorrenza mensile in calendario": con
// stipendio atteso il 15 già incassato il 14, quella restava il 15 di QUESTO mese, quindi la card
// proiettava a ieri/oggi e mostrava di fatto il saldo attuale invece del saldo a fine periodo.
describe('getNextSalaryDate', () => {
  beforeAll(() => { vi.useFakeTimers() })
  afterAll(() => { vi.useRealTimers() })
  afterEach(() => { __resetPeriodSettingsForTest() })

  it('stipendio atteso il 15, incassato il 14 lug: il prossimo è il 15 AGO, non il 15 lug', () => {
    vi.setSystemTime(new Date(2026, 6, 14))
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 15 })
    expect(toDateString(getNextSalaryDate())).toBe('2026-08-15')
    // La fine del periodo è il giorno PRIMA: è lì che punta la proiezione, non a oggi.
    expect(getBillingPeriod().end).toBe('2026-08-14')
  })

  it('il prossimo stipendio è sempre il giorno dopo la fine naturale del periodo', () => {
    vi.setSystemTime(new Date(2026, 6, 20))
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 14 })
    expect(getBillingPeriod().end).toBe('2026-08-13')
    expect(toDateString(getNextSalaryDate())).toBe('2026-08-14')
  })

  it('stipendio in RITARDO: la data attesa resta nel passato (è così che si riconosce il ritardo)', () => {
    vi.setSystemTime(new Date(2026, 7, 18)) // 18 ago, atteso il 14 ago
    setLocalPeriodSettings({ periodStart: '2026-07-14', anchorDay: 14 })
    expect(toDateString(getNextSalaryDate())).toBe('2026-08-14')
    // Periodo aperto: si estende a oggi finché l'accredito non arriva.
    expect(getBillingPeriod().end).toBe('2026-08-18')
  })

  it('senza periodStart (giorno fisso) resta coerente con la fine del periodo', () => {
    vi.setSystemTime(new Date(2026, 4, 19)) // periodo 15 mag – 14 giu
    expect(getBillingPeriod().end).toBe('2026-06-14')
    expect(toDateString(getNextSalaryDate())).toBe('2026-06-15')
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

  it('un giorno dopo l\'inizio occorre una volta sola nel periodo 10 giu – 14 lug', () => {
    vi.setSystemTime(new Date(2026, 5, 20))
    setLocalPeriodSettings({ periodStart: '2026-06-10' }) // period 10 giu - 14 lug
    // Il 20 cade nel mese d'inizio (20 giu); il 20 lug è oltre la fine (14 lug) → una sola.
    const occ = monthlyOccurrencesInCurrentPeriod(20).map(toDateString)
    expect(occ).toEqual(['2026-06-20'])
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

describe('sameWeekWeekday (ri-ancoraggio giorno occorrenza, robusto ai confini settimana)', () => {
  // 15 giu 2026 = lunedì, 21 giu = domenica (settimana lun 15 – dom 21).
  it('mer → mar resta nella stessa settimana (17 giu → 16 giu)', () => {
    expect(toDateString(sameWeekWeekday(new Date(2026, 5, 17), 2))).toBe('2026-06-16')
  })
  it('stesso giorno → invariato (17 giu mer → mer)', () => {
    expect(toDateString(sameWeekWeekday(new Date(2026, 5, 17), 3))).toBe('2026-06-17')
  })
  it('CONFINE lun → dom = domenica della STESSA settimana (15 giu → 21 giu), non quella precedente', () => {
    expect(toDateString(sameWeekWeekday(new Date(2026, 5, 15), 0))).toBe('2026-06-21')
  })
  it('CONFINE dom → lun = lunedì della STESSA settimana (21 giu → 15 giu), non quello successivo', () => {
    expect(toDateString(sameWeekWeekday(new Date(2026, 5, 21), 1))).toBe('2026-06-15')
  })
  it('sab → lun nella stessa settimana (20 giu → 15 giu)', () => {
    expect(toDateString(sameWeekWeekday(new Date(2026, 5, 20), 1))).toBe('2026-06-15')
  })
})
