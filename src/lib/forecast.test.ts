import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateForecast, getMonthlyEstimates, projectBalanceAtDate, findNextMonthlyIncomeDate } from './forecast'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

function mkFund(id: string, name: string, balance: number, type: 'main' | 'sub' = 'main'): Fund {
  return { id, user_id: 'u1', name, type, parent_id: null, balance, icon: 'wallet', color: '#000', sort_order: 0, created_at: '' }
}

function mkExp(id: string, name: string, amount: number, day: number, fund_id: string | null = null, opts: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id, user_id: 'u1', name, amount,
    frequency: 'monthly', day_of_month: day, day_of_week: null,
    fund_id, fund_to_id: null,
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

function mkPlanned(id: string, amount: number, type: 'income' | 'expense', date: string, fund_id: string | null = null): Transaction {
  return {
    id, user_id: 'u1', type, amount, description: 'Plan ' + id,
    fund_id, fund_to_id: null, category: 'altro', budget_id: null,
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
    const points = generateForecast(funds, [], [], [], 1)
    expect(points[0].balance).toBe(1500)
  })

  it('returns at least 2 points for any positive months', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const points = generateForecast(funds, [], [], [], 1)
    expect(points.length).toBeGreaterThan(1)
  })

  it('starting balance excludes excluded funds', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Savings', 5000)]
    const points = generateForecast(funds, [], [], [], 1, ['b'])
    expect(points[0].balance).toBe(1000)
  })
})

describe("generateForecast - user's scenario", () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('includes monthly salary on payday', () => {
    const funds = [mkFund('a', 'Main', 0)]
    const income = [mkInc('s', 'Stipendio', 1500, { frequency: 'monthly', day_of_month: 27 })]
    const points = generateForecast(funds, [], income, [], 2)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThanOrEqual(1500)
  })

  it('includes weekly Saturday income with 2-day delay', () => {
    const funds = [mkFund('a', 'Main', 0)]
    const income = [mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2 })]
    const points = generateForecast(funds, [], income, [], 1)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThan(150)
    expect(total).toBeLessThan(300)
  })

  it('subtracts monthly recurring expenses', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const expenses = [mkExp('rent', 'Affitto', 500, 1, 'a')]
    const points = generateForecast(funds, expenses, [], [], 2)
    const total = points[points.length - 1].balance
    expect(total).toBeLessThan(2000)
  })

  it('subtracts weekly recurring expenses (GPL ogni venerdì 30€)', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const gpl = mkExp('gpl', 'GPL', 30, 1, 'a', { frequency: 'weekly', day_of_week: 5, day_of_month: null })
    const points = generateForecast(funds, [gpl], [], [], 1)
    const total = points[points.length - 1].balance
    expect(total).toBeLessThan(1000)
    expect(total).toBeLessThanOrEqual(880)
    expect(total).toBeGreaterThanOrEqual(800)
  })

  it('weekly recurring expense generates exact occurrences per period', () => {
    const funds = [mkFund('a', 'Main', 0)]
    const inc = mkInc('s', 'Stipendio', 0, { day_of_month: 1, amount: 0 })
    const gpl = mkExp('gpl', 'GPL', 100, 1, 'a', { frequency: 'weekly', day_of_week: 5, day_of_month: null })
    const points = generateForecast(funds, [gpl], [inc], [], 1)
    const total = points[points.length - 1].balance
    expect(Math.abs(total)).toBeGreaterThanOrEqual(400)
    expect(Math.abs(total)).toBeLessThanOrEqual(500)
  })

  it('subtracts weekly budgets every week', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const budgets = [mkBudget('b1', 'Sfizi', 50)]
    const points = generateForecast(funds, [], [], budgets, 1)
    const total = points[points.length - 1].balance
    expect(total).toBeLessThan(1000)
    expect(total).toBeGreaterThanOrEqual(700)
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
    const points = generateForecast(funds, expenses, income, budgets, 3)
    const total = points[points.length - 1].balance
    expect(total).toBeGreaterThan(800)
  })
})

describe('generateForecast - weekly budgets respect date range', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('REGRESSION: weekly budget NOT counted for 1-day range (Tue→Wed, no Monday in range)', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)
    const points = generateForecast(funds, [], [], [sfizi], new Date(2026, 4, 20))
    const total = points[points.length - 1].balance
    expect(total).toBe(1000)
  })

  it('REGRESSION: weekly budget counted ONCE per Monday in range', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)
    const points = generateForecast(funds, [], [], [sfizi], new Date(2026, 4, 26))
    const total = points[points.length - 1].balance
    expect(total).toBe(950)
  })

  it('weekly budget counted for each Monday in 1-month range', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)
    const points = generateForecast(funds, [], [], [sfizi], new Date(2026, 5, 19))
    const total = points[points.length - 1].balance
    expect(total).toBe(1000 - 50 * 4)
  })

  it("REGRESSION: user's exact scenario: 15 mag - 14 giu period totals match breakdown", () => {
    // Today: Tue 19 mag 2026. Budget end: 14 giu.
    // Mondays >= today in [19 mag, 14 giu]: 25 mag, 1 giu, 8 giu = 3 Mondays
    // Expected: 3 × Sfizi (50€) + 3 × GPL (30€) + 1 × Parrucchiere (17€) = 257€
    const funds = [mkFund('a', 'Main', 1000)]
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)
    const parrucchiere = mkExp('par', 'Parrucchiere', 17, 20, 'a')
    const gpl = mkExp('gpl', 'GPL', 30, 1, 'a', { frequency: 'weekly', day_of_week: 1, day_of_month: null })
    const points = generateForecast(funds, [parrucchiere, gpl], [], [sfizi], new Date(2026, 5, 14))
    const total = points[points.length - 1].balance
    expect(total).toBe(1000 - 257)
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
    const withPlan = generateForecast(funds, [], [], [], 1, [], planned)
    const without = generateForecast(funds, [], [], [], 1, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 100)
  })

  it('REGRESSION: includes planned tomorrow', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const planned = [mkPlanned('tomorrow', 50, 'expense', '2026-05-20')]
    const withPlan = generateForecast(funds, [], [], [], 1, [], planned)
    const without = generateForecast(funds, [], [], [], 1, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 50)
  })

  it('subtracts planned future expense', () => {
    const funds = [mkFund('a', 'Main', 2000)]
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10')]
    const withPlan = generateForecast(funds, [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance - 500)
  })

  it('adds planned future income', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const planned = [mkPlanned('bonus', 300, 'income', '2026-06-10')]
    const withPlan = generateForecast(funds, [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance + 300)
  })

  it('ignores past planned dates', () => {
    const funds = [mkFund('a', 'Main', 1000)]
    const planned = [mkPlanned('past', 500, 'expense', '2026-04-10')]
    const withPlan = generateForecast(funds, [], [], [], 2, [], planned)
    const without = generateForecast(funds, [], [], [], 2, [], [])
    expect(withPlan[withPlan.length - 1].balance).toBe(without[without.length - 1].balance)
  })

  it('skips planned with excluded fund', () => {
    const funds = [mkFund('a', 'Main', 1000), mkFund('b', 'Savings', 0)]
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10', 'b')]
    const points = generateForecast(funds, [], [], [], 2, ['b'], planned)
    expect(points[points.length - 1].balance).toBe(1000)
  })
})

describe('generateForecast - transfers NOT counted as expenses (user choice)', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it("transfer source incluso → dest esclusa NOT counted", () => {
    // Bollo €50 from Sella (incl) → Spese MG (excl) — internal movement, not an expense
    const funds = [mkFund('sella', 'Sella', 1000), mkFund('mg', 'Spese MG', 100)]
    const bollo = mkExp('bollo', 'Bollo', 50, 15, 'sella', { type: 'transfer', fund_to_id: 'mg' })
    const points = generateForecast(funds, [bollo], [], [], new Date(2026, 6, 15), ['mg'])
    expect(points[points.length - 1].balance).toBe(1000)
  })

  it("transfer source esclusa → dest incluso NOT counted as income", () => {
    const funds = [mkFund('sella', 'Sella', 100), mkFund('mg', 'Spese MG', 1000)]
    const giro = mkExp('giro', 'Rimborso', 50, 20, 'mg', { type: 'transfer', fund_to_id: 'sella' })
    const points = generateForecast(funds, [giro], [], [], new Date(2026, 5, 14), ['mg'])
    expect(points[points.length - 1].balance).toBe(100)
  })

  it("transfer between two included funds NOT counted as expense", () => {
    const funds = [mkFund('a', 'A', 1000), mkFund('b', 'B', 500)]
    const giro = mkExp('giro', 'Risparmio', 100, 20, 'a', { type: 'transfer', fund_to_id: 'b' })
    const points = generateForecast(funds, [giro], [], [], new Date(2026, 5, 14))
    expect(points[points.length - 1].balance).toBe(1500)
  })

  it("transfer between two excluded funds NOT counted", () => {
    const funds = [mkFund('a', 'A', 1000), mkFund('mg1', 'MG1', 0), mkFund('mg2', 'MG2', 0)]
    const giro = mkExp('giro', 'Giro', 50, 20, 'mg1', { type: 'transfer', fund_to_id: 'mg2' })
    const points = generateForecast(funds, [giro], [], [], new Date(2026, 5, 14), ['mg1', 'mg2'])
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
    const points = generateForecast(funds, expenses, [], [], 2, ['b'])
    expect(points[points.length - 1].balance).toBe(1000)
  })

  it('skips income tied to excluded funds', () => {
    const funds = [mkFund('a', 'Main', 0), mkFund('b', 'Savings', 0)]
    const income = [mkInc('int', 'Interessi', 50, { frequency: 'monthly', day_of_month: 27, fund_id: 'b' })]
    const points = generateForecast(funds, [], income, [], 2, ['b'])
    expect(points[points.length - 1].balance).toBe(0)
  })
})

describe('getMonthlyEstimates', () => {
  it('sums monthly recurring income', () => {
    const income = [mkInc('s', 'Stipendio', 1500)]
    const { monthlyIncome } = getMonthlyEstimates([], income, [])
    expect(monthlyIncome).toBe(1500)
  })

  it('converts weekly income to monthly (×4.33)', () => {
    const income = [mkInc('w', 'Sett', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6 })]
    const { monthlyIncome } = getMonthlyEstimates([], income, [])
    expect(monthlyIncome).toBeCloseTo(216.5, 1)
  })

  it('sums recurring expenses', () => {
    const expenses = [mkExp('aff', 'Affitto', 400, 1)]
    const { monthlyExpenses } = getMonthlyEstimates(expenses, [], [])
    expect(monthlyExpenses).toBe(400)
  })

  it('converts weekly budget to monthly (×4.33)', () => {
    const budgets = [mkBudget('sfizi', 'Sfizi', 50)]
    const { monthlyExpenses } = getMonthlyEstimates([], [], budgets)
    expect(monthlyExpenses).toBeCloseTo(216.5, 1)
  })

  it('computes net = income - expenses', () => {
    const income = [mkInc('s', 'Stipendio', 1500)]
    const expenses = [mkExp('aff', 'Affitto', 400, 1)]
    const { monthlyNet } = getMonthlyEstimates(expenses, income, [])
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
    const est = getMonthlyEstimates(expenses, income, budgets)
    expect(est.monthlyIncome).toBeCloseTo(1500 + 50 * 4.33, 1)
    expect(est.monthlyExpenses).toBeCloseTo(400 + 15 + 200 + 50 * 4.33, 1)
    expect(est.monthlyNet).toBeGreaterThan(0)
  })

  it('respects fund exclusions', () => {
    const expenses = [mkExp('a', 'A', 100, 1, 'main'), mkExp('b', 'B', 200, 2, 'savings')]
    const fullEst = getMonthlyEstimates(expenses, [], [])
    const filteredEst = getMonthlyEstimates(expenses, [], [], ['savings'])
    expect(fullEst.monthlyExpenses).toBe(300)
    expect(filteredEst.monthlyExpenses).toBe(100)
  })

  it('weekly recurring expense in monthly estimate = importo × 4.33', () => {
    const gpl = mkExp('gpl', 'GPL', 30, 1, null, { frequency: 'weekly', day_of_week: 5, day_of_month: null })
    const est = getMonthlyEstimates([gpl], [], [])
    expect(est.monthlyExpenses).toBeCloseTo(30 * 4.33, 1)
  })

  it('REGRESSION: includes planned expense in monthly estimates', () => {
    const planned = [mkPlanned('vacanza', 500, 'expense', '2026-06-10')]
    const est = getMonthlyEstimates([], [], [], [], planned)
    expect(est.monthlyExpenses).toBe(500)
    expect(est.plannedExpensesInPeriod).toBe(500)
  })

  it('REGRESSION: includes planned income in monthly estimates', () => {
    const planned = [mkPlanned('bonus', 300, 'income', '2026-06-10')]
    const est = getMonthlyEstimates([], [], [], [], planned)
    expect(est.monthlyIncome).toBe(300)
    expect(est.plannedIncomeInPeriod).toBe(300)
  })

  it('skips non-planned transactions in monthly estimates', () => {
    const tx = mkPlanned('actual', 500, 'expense', '2026-06-10')
    tx.is_planned = false
    const est = getMonthlyEstimates([], [], [], [], [tx])
    expect(est.monthlyExpenses).toBe(0)
  })
})

describe('findNextMonthlyIncomeDate', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('returns the next upcoming monthly income (day 27 = May 27)', () => {
    const inc = mkInc('s', 'Stipendio', 1500, { day_of_month: 27 })
    const result = findNextMonthlyIncomeDate([inc])
    expect(result).not.toBeNull()
    expect(result?.date.getDate()).toBe(27)
    expect(result?.date.getMonth()).toBe(4)
  })

  it('rolls to next month if day already passed', () => {
    const inc = mkInc('s', 'Stipendio', 1500, { day_of_month: 10 })
    const result = findNextMonthlyIncomeDate([inc])
    expect(result?.date.getDate()).toBe(10)
    expect(result?.date.getMonth()).toBe(5)
  })

  it('returns null when no monthly income is active', () => {
    expect(findNextMonthlyIncomeDate([])).toBeNull()
    const weeklyOnly = mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6 })
    expect(findNextMonthlyIncomeDate([weeklyOnly])).toBeNull()
  })

  it('picks earliest when multiple monthly incomes', () => {
    const inc1 = mkInc('a', 'A', 1000, { day_of_month: 27 })
    const inc2 = mkInc('b', 'B', 500, { day_of_month: 20 })
    const result = findNextMonthlyIncomeDate([inc1, inc2])
    expect(result?.income.id).toBe('b')
    expect(result?.date.getDate()).toBe(20)
  })
})

describe('projectBalanceAtDate', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })

  it('projects balance the day before next salary, including ALL expenses', () => {
    const stipendio = mkInc('s', 'Stipendio', 1500, { day_of_month: 27 })
    const sabato = mkInc('w', 'Sabato', 50, { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2 })
    const affitto = mkExp('aff', 'Affitto', 400, 1, 'main')
    const netflix = mkExp('netflix', 'Netflix', 15, 22, 'main')
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)

    const target = new Date(2026, 4, 26)
    const proj = projectBalanceAtDate(target, 1000, [affitto, netflix], [stipendio, sabato], [sfizi], [], [])

    expect(proj.totalIncome).toBeGreaterThan(0)
    expect(proj.totalExpenses).toBeGreaterThan(0)
  })

  it('includes planned expenses in projection', () => {
    const planned = [mkPlanned('vacanza', 300, 'expense', '2026-05-25')]
    const withPlan = projectBalanceAtDate(new Date(2026, 4, 26), 1000, [], [], [], planned, [])
    const without = projectBalanceAtDate(new Date(2026, 4, 26), 1000, [], [], [], [], [])
    expect(withPlan.balance).toBe(without.balance - 300)
  })

  it('returns currentBalance if target is in the past', () => {
    const proj = projectBalanceAtDate(new Date(2026, 4, 10), 1000, [], [], [], [], [])
    expect(proj.balance).toBe(1000)
    expect(proj.totalIncome).toBe(0)
  })

  it('handles cross-billing-period projection', () => {
    const sfizi = mkBudget('sfizi', 'Sfizi', 50)
    const proj = projectBalanceAtDate(new Date(2026, 5, 26), 1000, [], [], [sfizi], [], [])
    expect(proj.totalExpenses).toBeGreaterThanOrEqual(50 * 4)
  })
})
