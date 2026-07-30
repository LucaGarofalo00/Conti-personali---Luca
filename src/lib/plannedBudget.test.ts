import { describe, it, expect } from 'vitest'
import { childrenOfPlanned, isPlannedBudgetActive, plannedBudgetStatus, plannedResidualAmount } from './plannedBudget'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import type { Transaction } from '../types'

function mk(opts: Partial<Transaction> & { id: string; amount: number }): Transaction {
  return {
    user_id: 'u', type: 'expense', description: 'x',
    fund_id: null, fund_to_id: null, category: 'altro', budget_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: '2026-08-10', created_at: '',
    ...opts,
  } as Transaction
}

const VACANZA = mk({ id: 'vac', amount: 350, is_planned: true, description: 'Vacanza Calabria' })

describe('plannedBudgetStatus', () => {
  it('senza spese agganciate il tetto è tutto disponibile', () => {
    const s = plannedBudgetStatus(VACANZA, [VACANZA])
    expect(s).toMatchObject({ total: 350, spent: 0, remaining: 350, overspent: 0, count: 0, exhausted: false })
    expect(s.percent).toBe(0)
  })

  it('somma le spese agganciate e scala il residuo', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 120, planned_parent_id: 'vac' }), mk({ id: 'b', amount: 30.5, planned_parent_id: 'vac' })]
    const s = plannedBudgetStatus(VACANZA, all)
    expect(s.spent).toBe(150.5)
    expect(s.remaining).toBe(199.5)
    expect(s.count).toBe(2)
    expect(s.exhausted).toBe(false)
  })

  it('il residuo non va sotto zero e lo sforamento viene esposto a parte', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 400, planned_parent_id: 'vac' })]
    const s = plannedBudgetStatus(VACANZA, all)
    expect(s.remaining).toBe(0)
    expect(s.overspent).toBe(50)
    expect(s.percent).toBe(100)
    expect(s.exhausted).toBe(true)
  })

  it('tetto esattamente raggiunto', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 350, planned_parent_id: 'vac' })]
    const s = plannedBudgetStatus(VACANZA, all)
    expect(s).toMatchObject({ remaining: 0, overspent: 0, exhausted: true })
    expect(s.percent).toBe(100)
  })

  it('non conta le spese di altre pianificate', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 100, planned_parent_id: 'altra' })]
    expect(plannedBudgetStatus(VACANZA, all).spent).toBe(0)
  })

  it('non conta i movimenti scollegati', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 100 })]
    expect(plannedBudgetStatus(VACANZA, all).spent).toBe(0)
  })

  it('un memo a 0 non consuma budget', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 0, is_memo: true, planned_parent_id: 'vac' })]
    const s = plannedBudgetStatus(VACANZA, all)
    expect(s.spent).toBe(0)
    expect(s.count).toBe(0)
  })

  it('un memo CON importo consuma budget (speso senza toccare i fondi)', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 40, is_memo: true, planned_parent_id: 'vac' })]
    expect(plannedBudgetStatus(VACANZA, all).spent).toBe(40)
  })

  it('non conta altre pianificate agganciate', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 100, is_planned: true, planned_parent_id: 'vac' })]
    expect(plannedBudgetStatus(VACANZA, all).spent).toBe(0)
  })

  it('somma i centesimi senza deriva dei float', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 0.1, planned_parent_id: 'vac' }), mk({ id: 'b', amount: 0.2, planned_parent_id: 'vac' })]
    expect(plannedBudgetStatus(VACANZA, all).spent).toBe(0.3)
    expect(plannedBudgetStatus(VACANZA, all).remaining).toBe(349.7)
  })

  it('tetto a zero: qualunque spesa è sforamento', () => {
    const zero = mk({ id: 'z', amount: 0, is_planned: true })
    const s = plannedBudgetStatus(zero, [zero, mk({ id: 'a', amount: 10, planned_parent_id: 'z' })])
    expect(s.percent).toBe(100)
    expect(s.overspent).toBe(10)
  })
})

describe('childrenOfPlanned', () => {
  it('restituisce solo le spese reali agganciate', () => {
    const all = [
      VACANZA,
      mk({ id: 'a', amount: 10, planned_parent_id: 'vac' }),
      mk({ id: 'b', amount: 0, is_memo: true, planned_parent_id: 'vac' }),
      mk({ id: 'c', amount: 10, is_planned: true, planned_parent_id: 'vac' }),
      mk({ id: 'd', amount: 10 }),
    ]
    expect(childrenOfPlanned('vac', all).map(t => t.id)).toEqual(['a'])
  })
})

describe('plannedResidualAmount', () => {
  it('è l\'importo con cui la pianificata entra nei totali', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 120, planned_parent_id: 'vac' })]
    expect(plannedResidualAmount(VACANZA, all)).toBe(230)
  })

  it('residuo + speso = tetto finché non si sfora: il totale del periodo non cambia', () => {
    for (const spesa of [0, 1, 99.99, 175, 349.99, 350]) {
      const all = [VACANZA, mk({ id: 'a', amount: spesa, planned_parent_id: 'vac' })]
      const s = plannedBudgetStatus(VACANZA, all)
      expect(s.remaining + s.spent).toBeCloseTo(350, 2)
    }
  })
})

describe('isPlannedBudgetActive', () => {
  it('falso senza spese agganciate', () => {
    expect(isPlannedBudgetActive(VACANZA, [VACANZA])).toBe(false)
  })
  it('vero mentre si sta spendendo', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 120, planned_parent_id: 'vac' })]
    expect(isPlannedBudgetActive(VACANZA, all)).toBe(true)
  })
  it('falso a tetto esaurito', () => {
    const all = [VACANZA, mk({ id: 'a', amount: 350, planned_parent_id: 'vac' })]
    expect(isPlannedBudgetActive(VACANZA, all)).toBe(false)
  })
})

describe('integrazione col motore dei totali', () => {
  const START = new Date(2026, 6, 14)
  const END = new Date(2026, 7, 13)

  function totals(all: Transaction[]) {
    const out = getPeriodBreakdown({
      startDate: START, endDate: END,
      recurringExpenses: [], recurringIncome: [], weeklyBudgets: [],
      planned: all.filter(t => t.is_planned),
      excludedFundIds: [], fromToday: false,
      actualTx: all.filter(t => !t.is_planned),
      includeActualOneOffs: true,
    })
    return { expenses: totalsFromBreakdown(out).expenses, items: out }
  }

  it('il totale resta il tetto man mano che si spende', () => {
    expect(totals([VACANZA]).expenses).toBe(350)
    expect(totals([VACANZA, mk({ id: 'a', amount: 120, planned_parent_id: 'vac' })]).expenses).toBe(350)
    expect(totals([
      VACANZA,
      mk({ id: 'a', amount: 120, planned_parent_id: 'vac' }),
      mk({ id: 'b', amount: 80, planned_parent_id: 'vac' }),
    ]).expenses).toBe(350)
  })

  it('a tetto esaurito la voce pianificata sparisce e restano le spese reali', () => {
    const r = totals([VACANZA, mk({ id: 'a', amount: 350, planned_parent_id: 'vac' })])
    expect(r.expenses).toBe(350)
    expect(r.items.some(i => i.source === 'planned')).toBe(false)
  })

  it('lo sforamento emerge nei totali invece di restare nascosto sotto il tetto', () => {
    expect(totals([VACANZA, mk({ id: 'a', amount: 400, planned_parent_id: 'vac' })]).expenses).toBe(400)
  })

  it('una spesa NON agganciata si somma al tetto, come qualsiasi altro movimento', () => {
    expect(totals([VACANZA, mk({ id: 'a', amount: 50 })]).expenses).toBe(400)
  })

  it('la voce pianificata mostra il residuo, non il tetto', () => {
    const r = totals([VACANZA, mk({ id: 'a', amount: 120, planned_parent_id: 'vac' })])
    expect(r.items.find(i => i.source === 'planned')?.amount).toBe(230)
  })
})
