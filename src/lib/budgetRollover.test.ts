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

describe('computeBudgetRollover - nessun accumulo dell\'avanzo', () => {
  it('nessuna settimana passata → budget effettivo = base', () => {
    const budget = mkBudget(50, '2026-05-19')
    const info = computeBudgetRollover(budget, [], new Date(2026, 4, 19))
    expect(info.effectiveBudget).toBe(50)
    expect(info.pastWeeks).toHaveLength(0)
  })

  it('una settimana passata con avanzo NON si accumula: budget resta alla base', () => {
    const budget = mkBudget(50, '2026-05-12')
    // Settimana passata: speso 30€, avanzo 20€ → NON deve aumentare il budget corrente
    const txs = [mkTx('2026-05-14', 30)]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.effectiveBudget).toBe(50)
    expect(info.pastWeeks).toHaveLength(1)
    expect(info.pastWeeks[0].surplus).toBe(20)
  })

  it('sforamento in settimana passata non intacca il budget corrente', () => {
    const budget = mkBudget(50, '2026-05-12')
    const txs = [mkTx('2026-05-14', 80)]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.effectiveBudget).toBe(50)
    expect(info.pastWeeks[0].over).toBe(30)
    expect(info.pastWeeks[0].surplus).toBe(0)
  })

  it('più settimane passate: il budget corrente resta sempre alla base', () => {
    const budget = mkBudget(50, '2026-04-28')
    const txs = [
      mkTx('2026-04-30', 20),
      mkTx('2026-05-06', 35),
      mkTx('2026-05-13', 50),
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 19))
    expect(info.effectiveBudget).toBe(50)
    expect(info.pastWeeks).toHaveLength(3)
  })

  it('la spesa della settimana corrente è tracciata sul budget base', () => {
    const budget = mkBudget(50, '2026-05-12')
    const txs = [
      mkTx('2026-05-14', 30),  // settimana passata: avanzo 20 (ignorato)
      mkTx('2026-05-20', 25),  // settimana corrente
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 20))
    expect(info.spentThisWeek).toBe(25)
    expect(info.effectiveBudget).toBe(50)
    expect(info.remaining).toBe(25)
    expect(info.overBudget).toBe(false)
  })

  it('sforamento della settimana corrente rispetto al solo budget base', () => {
    const budget = mkBudget(50, '2026-05-12')
    const txs = [
      mkTx('2026-05-14', 10),  // passata: avanzo 40 (ignorato, non aiuta questa settimana)
      mkTx('2026-05-20', 100), // corrente: speso 100
    ]
    const info = computeBudgetRollover(budget, txs, new Date(2026, 4, 20))
    expect(info.effectiveBudget).toBe(50)
    expect(info.spentThisWeek).toBe(100)
    expect(info.remaining).toBe(-50)
    expect(info.overBudget).toBe(true)
  })

  it('salta le transazioni memo', () => {
    const budget = mkBudget(50, '2026-05-12')
    const memoTx = { ...mkTx('2026-05-14', 30), is_memo: true }
    const info = computeBudgetRollover(budget, [memoTx], new Date(2026, 4, 19))
    expect(info.pastWeeks[0].spent).toBe(0)
    expect(info.pastWeeks[0].surplus).toBe(50)
  })

  it('lo storico espone avanzo, sforo e transazioni di ogni settimana', () => {
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
