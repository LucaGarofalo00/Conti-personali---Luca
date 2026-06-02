import { describe, it, expect } from 'vitest'
import { generateIncomeOccurrences } from './incomeOccurrences'
import type { RecurringIncome, Transaction } from '../types'

function mkInc(id: string, opts: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id, user_id: 'u1', name: 'Income-' + id, amount: 50,
    is_variable: false, frequency: 'weekly',
    day_of_month: null, day_of_week: 6, delay_days: 2,
    fund_id: null, is_active: true, start_date: null, end_date: null, created_at: '',
    ...opts,
  }
}

function mkTx(opts: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', user_id: 'u1', type: 'income', amount: 50,
    description: 'paid', fund_id: null, fund_to_id: null,
    category: 'lavoro', budget_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: '2026-05-16', created_at: '',
    ...opts,
  }
}

describe('generateIncomeOccurrences - weekly Saturday in May 15 - June 14', () => {
  it('include i sabati il cui PAGAMENTO (lavoro + 2) cade nel periodo', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2 })
    const start = new Date(2026, 4, 15)
    const end = new Date(2026, 5, 14)
    const out = generateIncomeOccurrences([inc], start, end, [])
    // il sabato 13 giu è escluso: il pagamento (15 giu) cade nel periodo successivo
    expect(out.map(o => o.workDateStr)).toEqual([
      '2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06',
    ])
  })

  it('un sabato lavorato a fine periodo ma pagato dopo il 15 va nel periodo SUCCESSIVO', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2 })
    // sabato 13 giu → pagamento lunedì 15 giu
    const corrente = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(corrente.some(o => o.workDateStr === '2026-06-13')).toBe(false)
    const successivo = generateIncomeOccurrences([inc], new Date(2026, 5, 15), new Date(2026, 6, 14), [])
    const occ = successivo.find(o => o.workDateStr === '2026-06-13')
    expect(occ).toBeTruthy()
    expect(occ?.paymentDateStr).toBe('2026-06-15')
  })

  it('payment date = work date + delay_days', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2 })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out[0].paymentDateStr).toBe('2026-05-18')
    expect(out[1].paymentDateStr).toBe('2026-05-25')
  })

  it('all start as pending', () => {
    const inc = mkInc('sab')
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out.every(o => o.status === 'pending')).toBe(true)
  })

  it('marks occurrences as paid when matching transaction exists', () => {
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'sab', date: '2026-05-16', is_memo: false })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('paid')
    expect(out[1].status).toBe('pending')
  })

  it('marks occurrences as skipped when memo transaction exists', () => {
    const inc = mkInc('sab')
    const memoTx = mkTx({ recurring_income_id: 'sab', date: '2026-05-23', is_memo: true, amount: 0 })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [memoTx])
    expect(out[1].status).toBe('skipped')
    expect(out[0].status).toBe('pending')
  })

  it('handles inactive income (skipped)', () => {
    const inc = mkInc('sab', { is_active: false })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out).toHaveLength(0)
  })
})

describe('generateIncomeOccurrences - monthly', () => {
  it('returns 1 occurrence per period for monthly salary on day 27', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out).toHaveLength(1)
    expect(out[0].workDateStr).toBe('2026-05-27')
  })

  it('day_of_month 1 falls in end month (June 1)', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 1, day_of_week: null })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out).toHaveLength(1)
    expect(out[0].workDateStr).toBe('2026-06-01')
  })

  it('include lo stipendio del 15 (primo giorno del ciclo) anche col periodo passato come stringa', () => {
    // La Dashboard passa il periodo come stringhe: il parsing non deve causare shift di fuso
    // che esclude l\'occorrenza del primo giorno.
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 15, day_of_week: null, amount: 1500 })
    const out = generateIncomeOccurrences([inc], '2026-05-15', '2026-06-14', [])
    expect(out.map(o => o.workDateStr)).toContain('2026-05-15')
  })

  it('clamps day 31 in February-like months', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 31, day_of_week: null })
    // Period Jan 15 - Feb 14 — day 31 → Jan 31
    const out = generateIncomeOccurrences([inc], new Date(2026, 0, 15), new Date(2026, 1, 14), [])
    expect(out).toHaveLength(1)
    expect(out[0].workDateStr).toBe('2026-01-31')
  })
})

describe('generateIncomeOccurrences - multiple incomes', () => {
  it('returns sorted by date', () => {
    const stip = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null, amount: 1500 })
    const sab = mkInc('sab', { frequency: 'weekly', day_of_week: 6, delay_days: 2, amount: 50 })
    const out = generateIncomeOccurrences([stip, sab], new Date(2026, 4, 15), new Date(2026, 5, 14), [])
    expect(out.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].workDate.getTime()).toBeGreaterThanOrEqual(out[i - 1].workDate.getTime())
    }
  })
})

describe('generateIncomeOccurrences - start_date / end_date window', () => {
  const start = new Date(2026, 4, 15)
  const end = new Date(2026, 5, 14)

  it('start_date excludes weekly occurrences before it', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2, start_date: '2026-05-25' })
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out.map(o => o.workDateStr)).toEqual(['2026-05-30', '2026-06-06'])
  })

  it('end_date excludes weekly occurrences after it', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2, end_date: '2026-05-30' })
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out.map(o => o.workDateStr)).toEqual(['2026-05-16', '2026-05-23', '2026-05-30'])
  })

  it('start_date in the future excludes a monthly salary entirely', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null, start_date: '2026-06-01' })
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out).toHaveLength(0)
  })

  it('past end_date excludes a monthly salary entirely', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null, end_date: '2026-05-01' })
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out).toHaveLength(0)
  })

  it('boundary dates are inclusive (occurrence exactly on start/end is kept)', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2, start_date: '2026-05-16', end_date: '2026-06-13' })
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out.map(o => o.workDateStr)).toEqual([
      '2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06',
    ])
  })
})

describe('generateIncomeOccurrences - aggancio per finestra (settimana/mese)', () => {
  it('non aggancia una transazione di un altro recurring_income_id', () => {
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'OTHER', date: '2026-05-16' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('pending')
  })

  it('aggancia una transazione nella stessa settimana anche se in un giorno diverso', () => {
    // occorrenza sabato 16 mag, ricevuta domenica 17 mag (stessa settimana lun→dom)
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'sab', date: '2026-05-17' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('paid')
    expect(out[1].status).toBe('pending')
  })

  it('non aggancia una transazione di un\'altra settimana', () => {
    // tx del 20 mag (settimana 18-24): non tocca l'occorrenza di sabato 16 mag (settimana 11-17)
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'sab', date: '2026-05-20' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('pending')
  })

  it('mensile: aggancia un pagamento nello stesso ciclo anche in un giorno diverso', () => {
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null })
    const tx = mkTx({ recurring_income_id: 'stip', date: '2026-05-30' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('paid')
  })

  it('mensile: aggancia anche a inizio mese successivo se nello stesso ciclo 15→14', () => {
    // occorrenza 27 mag (ciclo 15 mag–14 giu); pagamento il 1 giu = stesso ciclo
    const inc = mkInc('stip', { frequency: 'monthly', day_of_month: 27, day_of_week: null })
    const tx = mkTx({ recurring_income_id: 'stip', date: '2026-06-01' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('paid')
  })

  it('greedy: una sola transazione copre una sola occorrenza settimanale', () => {
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'sab', date: '2026-05-16' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out.filter(o => o.status === 'paid')).toHaveLength(1)
    expect(out[0].status).toBe('paid')
    expect(out[1].status).toBe('pending')
  })
})
