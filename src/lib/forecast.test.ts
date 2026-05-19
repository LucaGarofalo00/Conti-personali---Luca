import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateForecast, getMonthlyEstimates } from './forecast'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense, Transaction } from '../types'

function mkFund(id: string, name: string, balance: number, type: 'main' | 'sub' = 'main'): Fund {
  return { id, user_id: 'u1', name, type, parent_id: null, balance, icon: 'wallet', color: '#000', sort_order: 0, created_at: '' }
}

function mkExp(id: string, name: string, amount: number, day: number, fund_id: string | null = null, opts: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id, user_id: 'u1', name, amount, day_of_month: day, fund_id, fund_to_id: null,
    category: 'altro', type: 'expense', is_active: true, auto_deduct: false, end_date: null, created_at: '',
    ...opts,
  }
}

function mkInc(id: string, name: string, amount: number, opts: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id, user_id: 'u1', name, amount, is_variable: false, frequency: 'monthly',
    day_of_month: 27, day_of_week: null, delay_days: 0, fund_id: null, is_active: true, created_at: '',
    ...opts,
  }
}

function mkBudget(id: string, name: string, amount: number, fund_id: string | null = null): WeeklyBudget {
  return { id, user_id: 'u1', name, amount, fund_id, is_active: true, created_at: '' }
}

function mkVar(id: string, name: string, amount: number, frequency: 'weekly' | 'monthly', fund_id: string | null = null): VariableExpense {
  return { id, user_id: 'u1', name, estimated_amount: amount, frequency, fund_id, category: 'trasporti', is_active: true, needs_confirmation: false, created_at: '' }
}

function mkPlanned(id: string, amount: number, type: 'income' | 'expense', date: string, fund_id: string | null = null): Transaction {
  return {
    id, user_id: 'u1', type, amount, description: 'Plan ' + id,
    fund_id, fund_to_id: null, category: 'altro', budget_id: null,
    variable_expense_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: true, date, created_at: '',
  }
}

describe('generateForecast - basic structure', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('starts with current total fund balance', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Sub', 500)]
    const points = generateForecast(funds, [], [], [], [], 1)
    expect(points[0].balance).toBe(1500)
  })

  it('returns at least 2 points for any positive months', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const points = generateForecast(funds, [], [], [], [], 1)
    expect(points.length).toBeGreaterThan(1)
  })

  it('starting balance excludes excluded funds', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Savings', 5000)]
    const points = generateForecast(funds, [], [], [], [], 1, ['b'])
    expect(points[0].balance).toBe(1000)
  })
})

describe("generateForecast - user's scenario (1500 salary + 50/week + recurring)", () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('includes monthly salary on payday', () => {
    const funds = [mkFund('a', 'Main', 0)]
    const income = [mkInc('s', 'Stipendio', 1500, { frequency: 'monthly', day_of_month: 27 })]
    const points = generateForecast(funds, [], income, [], [], 2)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThanOrEqual(1500)
  })

  it('includes weekly Saturday income with 2-day delay', () => {
    const funds = [mkFund('a', 'Main', 0)]
    const income = [mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2 })]
    const points = generateForecast(funds, [], income, [], [], 1)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThan(150)
    expect(total).toBeLessThan(300)
  })

  it('subtracts monthly recurring expenses', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const expenses = [mkExp('rent', 'Affitto', 500, 1, 'a')]
    const points = generateForecast(funds, expenses, [], [], [], 2)
    const total = points[points.length - 1].balance
    expect(total).toBeLessThan(2000)
  })

  it('subtracts weekly budgets every week', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const budgets = [mkBudget('b1', 'Sfizi', 50)]
    const points = generateForecast(funds, [], [], budgets, [], 1)
    const total = points[points.length - 1].balance
    expect(total).toBeLessThan(1000)
    expect(total).toBeGreaterThanOrEqual(700)
  })

  it('subtracts weekly variable expenses (GPL 30€)', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const varExp = [mkVar('gpl', 'GPL', 30, 'weekly')]
    const points = generateForecast(funds, [], [], [], varExp, 1)
    expect(points[points.length - 1].balance).toBeLessThan(1000)
  })

  it('subtracts monthly variable expenses (car 45€)', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const varExp = [mkVar('car', 'Auto', 45, 'monthly')]
    const points = generateForecast(funds, [], [], [], varExp, 1)
    expect(points[points.length - 1].balance).toBeLessThan(1000)
  })

  it("full user scenario: net positive over 3 months", () => {
    const funds = [mkFund('main', 'Conto', 800)]
    const income = [
      mkInc('s', 'Stipendio', 1500, { frequency: 'monthly', day_of_month: 27 }),
      mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2 }),
    ]
    const expenses = [
      mkExp('affitto', 'Affitto', 400, 1, 'main'),
      mkExp('netflix', 'Netflix', 15, 5, 'main'),
      mkExp('finanz', 'Finanziamento', 200, 10, 'main'),
    ]
    const budgets = [mkBudget('sfizi', 'Sfizi', 50)]
    const varExp = [
      mkVar('gpl', 'GPL', 30, 'weekly'),
      mkVar('car', 'Auto', 30, 'monthly'),
    ]
    const points = generateForecast(funds, expenses, income, budgets, varExp, 3)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThan(800)
  })
})

describe('generateForecast - planned transactions', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('REGRESSION: includes planned in CURRENT week (today is Tue May 19)', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const planned = [mkPlanned('thisweek', 100, 'expense', '2026-05-22')]
    const withPlan = generateForecast(funds, [], [], [], [], 1, [], planned)
    const without = generateForecast(funds, [], [], [], [], 1, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 100)
  })

  it('REGRESSION: includes planned tomorrow', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const planned = [mkPlanned('tomorrow', 50, 'expense', '2026-05-20')]
    const withPlan = generateForecast(funds, [], [], [], [], 1, [], planned)
    const without = generateForecast(funds, [], [], [], [], 1, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 50)
  })

  it('subtracts planned future expense', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10')]
    const withPlan = generateForecast(funds, [], [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 500)
  })

  it('adds planned future income', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const planned = [mkPlanned('bonus', 300, 'income', '2026-06-10')]
    const withPlan = generateForecast(funds, [], [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance + 300)
  })

  it('ignores past planned dates', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const planned = [mkPlanned('past', 500, 'expense', '2026-04-10')]
    const withPlan = generateForecast(funds, [], [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance)
  })

  it('skips planned with excluded fund', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Savings', 0)]
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10', 'b')]
    const points = generateForecast(funds, [], [], [], [], 2, ['b'], planned)
    expect(points[points.length - 1].balance).toBe(1000)
  })
})

describe('generateForecast - exclusions', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('skips expenses tied to excluded funds', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Savings', 500)]
    const expenses = [mkExp('inv', 'Investimento', 100, 5, 'b')]
    const points = generateForecast(funds, expenses, [], [], [], 2, ['b'])
    expect(points[points.length - 1].balance).toBe(1000)
  })

  it('skips income tied to excluded funds', () => {
    const funds = [mkFund('a', 'Main', 0), mkFund('b', 'Savings', 0)]
    const income = [mkInc('int', 'Interessi', 50, { frequency: 'monthly', day_of_month: 27, fund_id: 'b' })]
    const points = generateForecast(funds, [], income, [], [], 2, ['b'])
    expect(points[points.length - 1].balance).toBe(0)
  })
})

describe('getMonthlyEstimates', () => {
  it('sums monthly recurring income', () => {
    const income = [mkInc('s', 'Stipendio', 1500)]
    const { monthlyIncome } = getMonthlyEstimates([], income, [], [])
    expect(monthlyIncome).toBe(1500)
  })

  it('converts weekly income to monthly (×4.33)', () => {
    const income = [mkInc('w', 'Sett', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6 })]
    const { monthlyIncome } = getMonthlyEstimates([], income, [], [])
    expect(monthlyIncome).toBeCloseTo(216.5, 1)
  })

  it('sums recurring expenses', () => {
    const expenses = [mkExp('aff', 'Affitto', 400, 1)]
    const { monthlyExpenses } = getMonthlyEstimates(expenses, [], [], [])
    expect(monthlyExpenses).toBe(400)
  })

  it('converts weekly budget to monthly (×4.33)', () => {
    const budgets = [mkBudget('sfizi', 'Sfizi', 50)]
    const { monthlyExpenses } = getMonthlyEstimates([], [], budgets, [])
    expect(monthlyExpenses).toBeCloseTo(216.5, 1)
  })

  it('handles weekly and monthly variable expenses', () => {
    const varExp = [
      mkVar('gpl', 'GPL', 30, 'weekly'),
      mkVar('car', 'Car', 45, 'monthly'),
    ]
    const { monthlyExpenses } = getMonthlyEstimates([], [], [], varExp)
    expect(monthlyExpenses).toBeCloseTo(30 * 4.33 + 45, 1)
  })

  it('computes net = income - expenses', () => {
    const income = [mkInc('s', 'Stipendio', 1500)]
    const expenses = [mkExp('aff', 'Affitto', 400, 1)]
    const { monthlyNet } = getMonthlyEstimates(expenses, income, [], [])
    expect(monthlyNet).toBe(1100)
  })

  it("user's full scenario monthly estimate", () => {
    const income = [
      mkInc('s', 'Stipendio', 1500),
      mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6 }),
    ]
    const expenses = [
      mkExp('affitto', 'Affitto', 400, 1),
      mkExp('netflix', 'Netflix', 15, 5),
      mkExp('finanz', 'Finanziamento', 200, 10),
    ]
    const budgets = [mkBudget('sfizi', 'Sfizi', 50)]
    const varExp = [mkVar('gpl', 'GPL', 30, 'weekly'), mkVar('car', 'Auto', 30, 'monthly')]
    const est = getMonthlyEstimates(expenses, income, budgets, varExp)
    expect(est.monthlyIncome).toBeCloseTo(1500 + 50 * 4.33, 1)
    expect(est.monthlyExpenses).toBeCloseTo(400 + 15 + 200 + 50 * 4.33 + 30 * 4.33 + 30, 1)
    expect(est.monthlyNet).toBeGreaterThan(0)
  })

  it('respects fund exclusions', () => {
    const expenses = [mkExp('a', 'A', 100, 1, 'main'), mkExp('b', 'B', 200, 2, 'savings')]
    const fullEst = getMonthlyEstimates(expenses, [], [], [])
    const filteredEst = getMonthlyEstimates(expenses, [], [], [], ['savings'])
    expect(fullEst.monthlyExpenses).toBe(300)
    expect(filteredEst.monthlyExpenses).toBe(100)
  })

  it('REGRESSION: includes planned expense in monthly estimates', () => {
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10')]
    const est = getMonthlyEstimates([], [], [], [], [], planned)
    expect(est.monthlyExpenses).toBe(500)
    expect(est.plannedExpensesInPeriod).toBe(500)
  })

  it('REGRESSION: includes planned income in monthly estimates', () => {
    const planned = [mkPlanned('bonus', 300, 'income', '2026-06-10')]
    const est = getMonthlyEstimates([], [], [], [], [], planned)
    expect(est.monthlyIncome).toBe(300)
    expect(est.plannedIncomeInPeriod).toBe(300)
  })

  it('skips non-planned transactions in monthly estimates', () => {
    const tx = mkPlanned('actual', 500, 'expense', '2026-06-10')
    tx.is_planned = false
    const est = getMonthlyEstimates([], [], [], [], [], [tx])
    expect(est.monthlyExpenses).toBe(0)
  })
})
