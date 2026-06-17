import type { Transaction } from '../types'

export interface CategorySlice { category: string; amount: number; pct: number }
export interface MonthSlice { key: string; income: number; expenses: number }
export interface StatsResult {
  income: number
  expenses: number
  net: number
  byCategory: CategorySlice[]
  byMonth: MonthSlice[]
}

// Aggrega i movimenti in totali, uscite per categoria e andamento mensile.
// Funzione PURA: il chiamante deve passare già SOLO i movimenti reali (no memo, no pianificate).
// I trasferimenti tra fondi non contano in entrate/uscite (sono movimenti interni), ma le spese
// per categoria considerano solo le uscite vere.
export function aggregateStats(txs: Transaction[]): StatsResult {
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  const catMap = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== 'expense') continue
    catMap.set(t.category, (catMap.get(t.category) || 0) + Number(t.amount))
  }
  const byCategory = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount, pct: expenses > 0 ? (amount / expenses) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)

  const monthMap = new Map<string, { income: number; expenses: number }>()
  for (const t of txs) {
    if (t.type === 'transfer') continue
    const key = t.date.slice(0, 7)
    const m = monthMap.get(key) || { income: 0, expenses: 0 }
    if (t.type === 'income') m.income += Number(t.amount)
    else m.expenses += Number(t.amount)
    monthMap.set(key, m)
  }
  const byMonth = [...monthMap.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([key, v]) => ({ key, income: Math.round(v.income * 100) / 100, expenses: Math.round(v.expenses * 100) / 100 }))

  return { income, expenses, net: income - expenses, byCategory, byMonth }
}
