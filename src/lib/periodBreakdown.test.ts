import { describe, it, expect } from 'vitest'
import { addDays } from 'date-fns'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import { toDateString } from './utils'
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
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date, created_at: '',
  }
}
function mkActualTx(opts: {
  amount: number
  date: string
  recurring_income_id?: string
  recurring_expense_id?: string
  is_memo?: boolean
}): Transaction {
  return {
    id: 'tx-' + Math.random(), user_id: 'u',
    type: opts.recurring_income_id ? 'income' : 'expense',
    amount: opts.amount, description: 'actual',
    fund_id: null, fund_to_id: null, category: 'altro', budget_id: null,
    recurring_expense_id: opts.recurring_expense_id ?? null,
    recurring_income_id: opts.recurring_income_id ?? null,
    is_memo: opts.is_memo ?? false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, created_at: '',
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

describe('getPeriodBreakdown - reconciliation with actual transactions', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringExpenses: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('senza actualTx resta una pura proiezione', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const out = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] })
    const projected = out.filter(i => i.source === 'recurring_income')
    expect(projected.length).toBeGreaterThan(0)
    expect(totalsFromBreakdown(out).income).toBe(projected.length * 50)
  })

  it('un\'occorrenza settimanale segnata "non lavorato" (memo) non viene contata', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const projection = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] })
    const occurrences = projection.filter(i => i.source === 'recurring_income')
    const skipDate = occurrences[0].date // delay 0 → data emissione = data lavoro

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 0, date: skipDate, recurring_income_id: 'w', is_memo: true })],
    })
    const after = reconciled.filter(i => i.source === 'recurring_income')
    expect(after).toHaveLength(occurrences.length - 1)
    expect(after.some(i => i.date === skipDate)).toBe(false)
    expect(totalsFromBreakdown(reconciled).income).toBe((occurrences.length - 1) * 50)
  })

  it('un\'occorrenza confermata usa l\'importo effettivo, non quello previsto', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const occurrences = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] }).filter(i => i.source === 'recurring_income')
    const paidDate = occurrences[0].date

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 30, date: paidDate, recurring_income_id: 'w' })],
    })
    const item = reconciled.find(i => i.source === 'recurring_income' && i.date === paidDate)
    expect(item?.amount).toBe(30)
    expect(totalsFromBreakdown(reconciled).income).toBe((occurrences.length - 1) * 50 + 30)
  })

  it('riconcilia le entrate settimanali con ritardo usando la data di LAVORO', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2, amount: 50 })
    const occurrences = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] }).filter(i => i.source === 'recurring_income')
    const emitDate = occurrences[0].date // data di pagamento (lavoro + 2)
    const workDate = toDateString(addDays(new Date(emitDate), -2))

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 0, date: workDate, recurring_income_id: 'w', is_memo: true })],
    })
    const after = reconciled.filter(i => i.source === 'recurring_income')
    expect(after.some(i => i.date === emitDate)).toBe(false)
    expect(after).toHaveLength(occurrences.length - 1)
  })

  it('riconcilia anche le spese ricorrenti (importo effettivo e memo)', () => {
    const exp = mkExp('aff', 20, 400) // cade il 20 maggio
    const paid = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [], recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 380, date: '2026-05-20', recurring_expense_id: 'aff' })],
    })
    expect(paid.find(i => i.source === 'recurring_expense')?.amount).toBe(380)

    const memo = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [], recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 400, date: '2026-05-20', recurring_expense_id: 'aff', is_memo: true })],
    })
    expect(memo.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
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

function mkOneOff(opts: {
  amount: number
  date: string
  type?: 'income' | 'expense' | 'transfer'
  budget_id?: string | null
  fund_id?: string | null
  is_memo?: boolean
}): Transaction {
  return {
    id: 'o-' + Math.random(), user_id: 'u',
    type: opts.type ?? 'expense',
    amount: opts.amount, description: 'manuale',
    fund_id: opts.fund_id ?? null, fund_to_id: null, category: 'cibo',
    budget_id: opts.budget_id ?? null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: opts.is_memo ?? false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, created_at: '',
  }
}

describe('getPeriodBreakdown - includeActualOneOffs', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const empty = { recurringExpenses: [], recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('does NOT count manual one-offs by default (flag off)', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-20' })],
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(0)
  })

  it('counts a manual one-off expense when flag is on', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-20' })],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(1)
    expect(totalsFromBreakdown(out).expenses).toBe(30)
  })

  it('counts a manual one-off income when flag is on', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 100, date: '2026-05-20', type: 'income' })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(100)
  })

  it('excludes memo, transfer, recurring-linked and budget-linked transactions', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [
        mkOneOff({ amount: 10, date: '2026-05-20', is_memo: true }),
        mkOneOff({ amount: 10, date: '2026-05-20', type: 'transfer' }),
        mkActualTx({ amount: 10, date: '2026-05-20', recurring_expense_id: 'x' }),
        mkOneOff({ amount: 10, date: '2026-05-20', budget_id: 'b' }),
      ],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
  })

  it('excludes one-offs outside the period and on excluded funds', () => {
    const out = getPeriodBreakdown({
      ...period, recurringExpenses: [], recurringIncome: [], weeklyBudgets: [], planned: [],
      excludedFundIds: ['savings'],
      actualTx: [
        mkOneOff({ amount: 30, date: '2026-07-01' }),
        mkOneOff({ amount: 30, date: '2026-05-20', fund_id: 'savings' }),
      ],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
  })

  it('does not double-count: reconciled recurring + manual one-off coexist', () => {
    const out = getPeriodBreakdown({
      ...period, recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [],
      recurringExpenses: [mkExp('aff', 20, 400)],
      actualTx: [
        mkActualTx({ amount: 380, date: '2026-05-20', recurring_expense_id: 'aff' }),
        mkOneOff({ amount: 30, date: '2026-05-21' }),
      ],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).expenses).toBe(410)
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(1)
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(1)
  })
})

describe('getPeriodBreakdown - budget reconciliation', () => {
  // 2026-05-11 è lunedì: periodo di una sola settimana per isolare una quota di budget.
  const period = { startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 17) }
  const base = { recurringExpenses: [], recurringIncome: [], planned: [], excludedFundIds: [] }
  const budget = mkBudget('sfizi', 50)

  it('adds overspend as an extra expense (Sforamento)', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, now: new Date(2026, 4, 25),
    })
    expect(out.find(i => i.source === 'budget_extra')?.amount).toBe(20)
    expect(totalsFromBreakdown(out).expenses).toBe(70) // quota 50 + sforamento 20
  })

  it('gives back unspent budget as income (Residuo) once the week has ended', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, now: new Date(2026, 4, 25),
    })
    const residuo = out.find(i => i.source === 'budget_residual')
    expect(residuo?.amount).toBe(20)
    expect(residuo?.description).toContain('Residuo budget')
    expect(totalsFromBreakdown(out).expenses).toBe(50)
    expect(totalsFromBreakdown(out).income).toBe(20) // impatto netto budget = 30
  })

  it('does NOT give back residuo while the week is still in progress', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, now: new Date(2026, 4, 13),
    })
    expect(out.filter(i => i.source === 'budget_residual')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(50) // resta la quota piena
  })

  it('keeps budget as a flat weekly quota when the flag is off', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      now: new Date(2026, 4, 25),
    })
    expect(out.filter(i => i.source === 'budget_extra')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(50)
  })
})
