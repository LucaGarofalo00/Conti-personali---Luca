import { describe, it, expect } from 'vitest'
import { aggregateStats } from './stats'
import type { Transaction } from '../types'

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u', type: 'expense', amount: 0, description: '',
    fund_id: null, fund_to_id: null, category: 'altro',
    budget_id: null, recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: '2026-06-01', created_at: '2026-06-01T00:00:00Z',
    ...p,
  }
}

describe('aggregateStats', () => {
  it('su lista vuota restituisce zeri e array vuoti', () => {
    const r = aggregateStats([])
    expect(r).toEqual({ income: 0, expenses: 0, net: 0, byCategory: [], byMonth: [] })
  })

  it('somma entrate e uscite e calcola il netto', () => {
    const r = aggregateStats([
      tx({ type: 'income', amount: 1500 }),
      tx({ type: 'expense', amount: 200 }),
      tx({ type: 'expense', amount: 50 }),
    ])
    expect(r.income).toBe(1500)
    expect(r.expenses).toBe(250)
    expect(r.net).toBe(1250)
  })

  it('raggruppa le uscite per categoria, ordinate dalla più alta, con percentuale sul totale uscite', () => {
    const r = aggregateStats([
      tx({ type: 'expense', amount: 300, category: 'casa' }),
      tx({ type: 'expense', amount: 100, category: 'cibo' }),
      tx({ type: 'expense', amount: 100, category: 'cibo' }),
    ])
    expect(r.byCategory.map(c => c.category)).toEqual(['casa', 'cibo'])
    expect(r.byCategory[0]).toMatchObject({ category: 'casa', amount: 300, pct: 60 })
    expect(r.byCategory[1]).toMatchObject({ category: 'cibo', amount: 200, pct: 40 })
  })

  it('esclude i trasferimenti da entrate, uscite, categorie e andamento mensile', () => {
    const r = aggregateStats([
      tx({ type: 'transfer', amount: 500, fund_id: 'a', fund_to_id: 'b', category: 'trasferimento' }),
      tx({ type: 'expense', amount: 80, category: 'svago' }),
    ])
    expect(r.income).toBe(0)
    expect(r.expenses).toBe(80)
    expect(r.byCategory).toHaveLength(1)
    expect(r.byMonth).toEqual([{ key: '2026-06', income: 0, expenses: 80 }])
  })

  it('aggrega per mese (YYYY-MM) e ordina cronologicamente', () => {
    const r = aggregateStats([
      tx({ type: 'expense', amount: 100, date: '2026-05-10' }),
      tx({ type: 'income', amount: 1000, date: '2026-06-02' }),
      tx({ type: 'expense', amount: 40, date: '2026-06-20' }),
    ])
    expect(r.byMonth).toEqual([
      { key: '2026-05', income: 0, expenses: 100 },
      { key: '2026-06', income: 1000, expenses: 40 },
    ])
  })
})
