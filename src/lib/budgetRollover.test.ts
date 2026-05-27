import { describe, it, expect } from 'vitest'
import { computeBudgetRollover } from './budgetRollover'
import type { WeeklyBudget, Transaction } from '../types'

function mkBudget(amount: number, createdAt: string): WeeklyBudget {
  return {
    id: 'b1', user_id: 'u', name: 'Sfizi', amount,
    fund_id: null, is_active: true, created_at: createdAt,
  }
}

function mkTx(date: string, amount: number): Transaction {
  return {
    id: 't-' + date + '-' + amount, user_id: 'u', type: 'expense', amount,
    description: 'spesa', fund_id: null, fund_to_id: null, category: 'budget',
    budget_id: 'b1', recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date, created_at: date,
  }
}

describe('computeBudgetRollover', () => {
  it('no past weeks → no rollover', () => {
    // today Monday 19 mag 2026 (Tuesday actually, but for week start logic)
    // Budget created today, no rollover possible
    const budget = mkBudget(50, '2026-05-19')
    const info = computeBudgetRollover(budget, [], new Date(2026, 4, 19))
    expect(info.rollover).toBe(0)
    expect(info.weeksTracked).toBe(0)
    expect(info.effectiveBudget).toBe(50)
  })

  it('1 past week with full spending → no rollover', () => {
    const budget = mkBudget(50, '2026-05-12')
    // Past week: 12-18 mag, spent 50€
    const txs = [mkTx('2026-05-15', 50)]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.rollover).toBe(0)
    expect(info.weeksTracked).toBe(1)
    expect(info.effectiveBudget).toBe(50)
  })

  it('1 past week with surplus → accumulates rollover', () => {
    const budget = mkBudget(50, '2026-05-12')
    // Past week: spent 30€, surplus 20€
    const txs = [mkTx('2026-05-14', 30)]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.rollover).toBe(20)
    expect(info.effectiveBudget).toBe(70)
  })

  it('overspending in past week does NOT create negative rollover', () => {
    const budget = mkBudget(50, '2026-05-12')
    // Past week: spent 80€, NOT counted as -30 rollover
    const txs = [mkTx('2026-05-14', 80)]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.rollover).toBe(0)
    expect(info.effectiveBudget).toBe(50)
  })

  it('multiple past weeks: surplus accumulates', () => {
    const budget = mkBudget(50, '2026-04-28')
    // Week of 28 apr: spent 20€, surplus 30
    // Week of 5 mag: spent 35€, surplus 15
    // Week of 12 mag: spent 50€, surplus 0
    // Current week of 19 mag: 0 spent
    // Rollover total: 30 + 15 + 0 = 45
    const txs = [
      mkTx('2026-04-30', 20),
      mkTx('2026-05-06', 35),
      mkTx('2026-05-13', 50),
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.rollover).toBe(45)
    expect(info.weeksTracked).toBe(3)
    expect(info.effectiveBudget).toBe(95)
  })

  it('current week spending is tracked separately from rollover', () => {
    const budget = mkBudget(50, '2026-05-12')
    const txs = [
      mkTx('2026-05-14', 30),  // past week: surplus 20
      mkTx('2026-05-20', 25),  // current week
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 20))
    expect(info.rollover).toBe(20)
    expect(info.spentThisWeek).toBe(25)
    expect(info.effectiveBudget).toBe(70)
    expect(info.remaining).toBe(45)
    expect(info.overBudget).toBe(false)
  })

  it('overspending current week with rollover available', () => {
    const budget = mkBudget(50, '2026-05-12')
    const txs = [
      mkTx('2026-05-14', 10),  // past: surplus 40
      mkTx('2026-05-20', 100), // current: spent 100
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 20))
    expect(info.rollover).toBe(40)
    expect(info.effectiveBudget).toBe(90)
    expect(info.spentThisWeek).toBe(100)
    expect(info.remaining).toBe(-10)
    expect(info.overBudget).toBe(true)
  })

  it('skips memo transactions', () => {
    const budget = mkBudget(50, '2026-05-12')
    const memoTx = { ...mkTx('2026-05-14', 30), is_memo: true }
    const info = computeBudgetRollover(budget, [memoTx], new Date(2026, 4, 19))
    expect(info.rollover).toBe(50)
  })

  it('past weeks expose overspend amount and their transactions', () => {
    const budget = mkBudget(50, '2026-05-05')
    const txs = [
      mkTx('2026-05-06', 80), // settimana 4-10 mag: sforata di 30
      mkTx('2026-05-13', 30), // settimana 11-17 mag: avanzo 20
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.pastWeeks).toHaveLength(2)
    const [w1, w2] = info.pastWeeks
    expect(w1.spent).toBe(80)
    expect(w1.over).toBe(30)
    expect(w1.surplus).toBe(0)
    expect(w1.txs).toHaveLength(1)
    expect(w2.spent).toBe(30)
    expect(w2.over).toBe(0)
    expect(w2.surplus).toBe(20)
  })
})
