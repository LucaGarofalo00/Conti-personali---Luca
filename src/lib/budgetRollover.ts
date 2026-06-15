import { startOfWeek, addDays, isBefore } from 'date-fns'
import { parseLocalDate } from './utils'
import type { WeeklyBudget, Transaction } from '../types'

// Quante settimane passate al massimo tenere nello storico informativo, per non costruire
// centinaia di voci per budget molto vecchi (la UI ne mostra comunque solo le ultime).
const MAX_PAST_WEEKS = 52

export interface BudgetRolloverInfo {
  effectiveBudget: number
  spentThisWeek: number
  remaining: number
  overBudget: boolean
  // Le transazioni della settimana corrente (già filtrate: niente memo, dentro [lun, lun+7)),
  // così la UI non deve ricalcolare lo stesso filtro (ed evita di mostrare voci future/memo).
  txsThisWeek: Transaction[]
  pastWeeks: { weekStart: Date; spent: number; surplus: number; over: number; txs: Transaction[] }[]
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

  // Lo storico delle settimane passate resta solo informativo (avanzo/sforo per settimana):
  // l'avanzo NON si accumula nel budget corrente e NON viene conteggiato come entrata.
  const pastWeeks: BudgetRolloverInfo['pastWeeks'] = []
  // Non risalire oltre MAX_PAST_WEEKS settimane: limita il costo per budget molto vecchi.
  const earliestWeek = addDays(currentWeekStart, -7 * MAX_PAST_WEEKS)
  let cursorWeek = isBefore(firstTrackedWeek, earliestWeek) ? new Date(earliestWeek) : new Date(firstTrackedWeek)

  while (isBefore(cursorWeek, currentWeekStart)) {
    const weekEnd = addDays(cursorWeek, 7)
    const txsInWeek = myTxs.filter(t => {
      const txDate = parseLocalDate(t.date)
      return txDate >= cursorWeek && txDate < weekEnd
    })
    const spent = Math.round(txsInWeek.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100
    const surplus = Math.max(0, Math.round((budgetBase - spent) * 100) / 100)
    const over = Math.max(0, Math.round((spent - budgetBase) * 100) / 100)
    pastWeeks.push({ weekStart: new Date(cursorWeek), spent, surplus, over, txs: txsInWeek })
    cursorWeek = addDays(cursorWeek, 7)
  }

  // Settimana CORRENTE: doppio limite [inizio, inizio+7), così una spesa budget datata in una
  // settimana FUTURA non viene conteggiata qui (falserebbe "speso questa settimana"/over budget).
  const currentWeekEnd = addDays(currentWeekStart, 7)
  const txsThisWeek = myTxs.filter(t => {
    const txDate = parseLocalDate(t.date)
    return txDate >= currentWeekStart && txDate < currentWeekEnd
  })
  const spentThisWeek = txsThisWeek.reduce((s, t) => s + Number(t.amount), 0)

  // Ogni settimana riparte dal valore base: nessun rollover dell'avanzo precedente.
  const effectiveBudget = budgetBase
  const remaining = effectiveBudget - spentThisWeek
  const overBudget = remaining < 0

  return {
    effectiveBudget: Math.round(effectiveBudget * 100) / 100,
    spentThisWeek: Math.round(spentThisWeek * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    overBudget,
    txsThisWeek,
    pastWeeks,
  }
}
