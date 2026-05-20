import { describe, it, expect } from 'vitest'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import type { RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

function mkInc(id: string, opts: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id, user_id: 'u', name: 'Inc-' + id, amount: 1500,
    is_variable: false, frequency: 'monthly', day_of_month: 27, day_of_week: null,
    delay_days: 0, fund_id: null, is_active: true, start_date: null, end_date: null, created_at: '',
    ...opts,
  }
}
function mkExp(id: string, day: number, amount: number): RecurringExpense {
  return {
    id, user_id: 'u', name: 'Exp-' + id, amount,
    frequency: 'monthly', day_of_month: day, day_of_week: null, month_of_year: null,
    fund_id: null, fund_to_id: null, category: 'altro',
    type: 'expense', is_active: true, auto_deduct: false, start_date: null, end_date: null, created_at: '',
  }
}
function mkBudget(id: string, amount: number): WeeklyBudget {
  return { id, user_id: 'u', name: 'B-' + id, amount, fund_id: null, is_active: true, created_at: '' }
}
function mkPlanned(amount: number, type: 'income' | 'expense', date: string): Transaction {
  return {
    id: 'p-' + Math.random(), user_id: 'u', type, amount, description: 'plan ' + type,
    fund_id: null, fund_to_id: null, category: 'altro', budget_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: true,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null,
    date, created_at: '',
  }
}

describe('getPeriodBreakdown - includes all source types', () => {
  it('returns recurring income on its day_of_month', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [mkInc('s', { day_of_month: 27 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const stipendi = out.filter(i => i.source === 'recurring_income')
    expect(stipendi).toHaveLength(1)
    expect(stipendi[0].date).toBe('2026-05-27')
    expect(stipendi[0].amount).toBe(1500)
  })

  it('returns weekly income with delay (Saturday + 2 = Monday)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2, amount: 50 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const sabati = out.filter(i => i.source === 'recurring_income')
    expect(sabati.length).toBeGreaterThan(0)
  })

  it('returns recurring expenses on their day_of_month', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [mkExp('aff', 1, 400)], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(1)
    expect(out[0].amount).toBe(400)
  })

  it('returns one weekly budget entry per Monday in the period', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [],
      weeklyBudgets: [mkBudget('sfizi', 50)], planned: [], excludedFundIds: [],
    })
    const sfizi = out.filter(i => i.source === 'weekly_budget')
    expect(sfizi.length).toBeGreaterThanOrEqual(4)
    expect(sfizi.every(i => i.amount === 50)).toBe(true)
  })

  it('returns planned only on their exact date', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [],
      weeklyBudgets: [],
      planned: [mkPlanned(500, 'expense', '2026-06-05'), mkPlanned(200, 'income', '2026-05-20')],
      excludedFundIds: [],
    })
    const plannedItems = out.filter(i => i.source === 'planned')
    expect(plannedItems).toHaveLength(2)
  })

  it('skips inactive recurring', () => {
    const inactive = mkExp('inactive', 5, 999)
    inactive.is_active = false
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [inactive], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    expect(out).toHaveLength(0)
  })
})

describe('getPeriodBreakdown - expense start_date / end_date window', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('skips a recurring expense before its start_date', () => {
    const exp = mkExp('aff', 20, 400) // cade il 20 maggio
    exp.start_date = '2026-06-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })

  it('keeps a recurring expense on/after its start_date', () => {
    const exp = mkExp('aff', 20, 400)
    exp.start_date = '2026-05-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    const items = out.filter(i => i.source === 'recurring_expense')
    expect(items).toHaveLength(1)
    expect(items[0].date).toBe('2026-05-20')
  })

  it('skips a recurring expense after its end_date', () => {
    const exp = mkExp('aff', 20, 400)
    exp.end_date = '2026-05-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })
})

describe('totalsFromBreakdown', () => {
  it('correctly sums income and expenses separately', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [mkExp('a', 1, 400)],
      recurringIncome: [mkInc('s', { day_of_month: 27, amount: 1500 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const totals = totalsFromBreakdown(out)
    expect(totals.income).toBe(1500)
    expect(totals.expenses).toBe(400)
  })
})

describe('getPeriodBreakdown - exclusions', () => {
  it('skips items linked to excluded funds', () => {
    const exp = mkExp('a', 5, 100)
    exp.fund_id = 'savings'
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [exp], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: ['savings'],
    })
    expect(out).toHaveLength(0)
  })
})
