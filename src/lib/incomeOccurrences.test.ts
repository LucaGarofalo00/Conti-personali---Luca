import { describe, it, expect } from 'vitest'
import { generateIncomeOccurrences } from './incomeOccurrences'
import type { RecurringIncome, Transaction } from '../types'

function mkInc(id: string, opts: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id, user_id: 'u1', name: 'Income-' + id, amount: 50,
    is_variable: false, frequency: 'weekly',
    day_of_month: null, day_of_week: 6, delay_days: 2,
    fund_id: null, is_active: true, created_at: '',
    ...opts,
  }
}

function mkTx(opts: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', user_id: 'u1', type: 'income', amount: 50,
    description: 'paid', fund_id: null, fund_to_id: null,
    category: 'lavoro', budget_id: null, variable_expense_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    date: '2026-05-16', created_at: '',
    ...opts,
  }
}

describe('generateIncomeOccurrences - weekly Saturday in May 15 - June 14', () => {
  it('returns 5 Saturdays in the period (May 16, 23, 30, June 6, 13)', () => {
    const inc = mkInc('sab', { day_of_week: 6, delay_days: 2 })
    const start = new Date(2026, 4, 15)
    const end = new Date(2026, 5, 14)
    const out = generateIncomeOccurrences([inc], start, end, [])
    expect(out).toHaveLength(5)
    expect(out.map(o => o.workDateStr)).toEqual([
      '2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06', '2026-06-13',
    ])
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
    expect(out.length).toBeGreaterThan(5)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].workDate.getTime()).toBeGreaterThanOrEqual(out[i - 1].workDate.getTime())
    }
  })
})

describe('generateIncomeOccurrences - matching is precise (no false positives)', () => {
  it('does not match transaction with different recurring_income_id', () => {
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'OTHER', date: '2026-05-16' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('pending')
  })

  it('does not match transaction with different date', () => {
    const inc = mkInc('sab')
    const tx = mkTx({ recurring_income_id: 'sab', date: '2026-05-17' })
    const out = generateIncomeOccurrences([inc], new Date(2026, 4, 15), new Date(2026, 5, 14), [tx])
    expect(out[0].status).toBe('pending')
  })
})
