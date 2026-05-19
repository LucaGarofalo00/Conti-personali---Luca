import { startOfWeek, addDays, isBefore } from 'date-fns'
import type { WeeklyBudget, Transaction } from '../types'

export interface BudgetRolloverInfo {
  rollover: number
  weeksTracked: number
  effectiveBudget: number
  spentThisWeek: number
  remaining: number
  overBudget: boolean
  pastWeeks: { weekStart: Date; spent: number; surplus: number }[]
}

export function computeBudgetRollover(
  budget: WeeklyBudget,
  allBudgetTxs: Transaction[],
  today: Date = new Date()
): BudgetRolloverInfo {
  const budgetBase = Number(budget.amount)
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 })
  const created = new Date(budget.created_at || today)
  const firstTrackedWeek = startOfWeek(created, { weekStartsOn: 1 })

  const myTxs = allBudgetTxs.filter(t => t.budget_id === budget.id && !t.is_memo)

  let rollover = 0
  let weeksTracked = 0
  const pastWeeks: { weekStart: Date; spent: number; surplus: number }[] = []
  let cursorWeek = new Date(firstTrackedWeek)

  while (isBefore(cursorWeek, currentWeekStart)) {
    const weekEnd = addDays(cursorWeek, 7)
    const txsInWeek = myTxs.filter(t => {
      const txDate = new Date(t.date)
      return txDate >= cursorWeek && txDate < weekEnd
    })
    const spent = txsInWeek.reduce((s, t) => s + Number(t.amount), 0)
    const surplus = Math.max(0, budgetBase - spent)
    rollover += surplus
    weeksTracked++
    pastWeeks.push({ weekStart: new Date(cursorWeek), spent, surplus })
    cursorWeek = addDays(cursorWeek, 7)
  }

  const txsThisWeek = myTxs.filter(t => {
    const txDate = new Date(t.date)
    return txDate >= currentWeekStart
  })
  const spentThisWeek = txsThisWeek.reduce((s, t) => s + Number(t.amount), 0)

  const effectiveBudget = budgetBase + rollover
  const remaining = effectiveBudget - spentThisWeek
  const overBudget = remaining < 0

  return {
    rollover: Math.round(rollover * 100) / 100,
    weeksTracked,
    effectiveBudget: Math.round(effectiveBudget * 100) / 100,
    spentThisWeek: Math.round(spentThisWeek * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    overBudget,
    pastWeeks,
  }
}
