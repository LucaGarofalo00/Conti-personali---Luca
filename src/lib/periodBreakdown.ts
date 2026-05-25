import { addDays, getDate, getDay, getDaysInMonth, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns'
import { toDateString } from './utils'
import type { RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

export type BreakdownSource =
  | 'recurring_income'
  | 'recurring_expense'
  | 'weekly_budget'
  | 'planned'
  | 'transfer'
  | 'actual'

export interface BreakdownItem {
  date: string
  description: string
  amount: number
  kind: 'income' | 'expense'
  source: BreakdownSource
  sourceLabel: string
  category?: string
}

interface Args {
  startDate: Date
  endDate: Date
  recurringExpenses: RecurringExpense[]
  recurringIncome: RecurringIncome[]
  weeklyBudgets: WeeklyBudget[]
  planned: Transaction[]
  excludedFundIds: string[]
  fromToday?: boolean
  // Transazioni reali (non pianificate) del periodo, per riconciliare le occorrenze ricorrenti
  // con ciò che è davvero successo: se un'occorrenza è stata confermata si usa l'importo
  // effettivo, se è stata segnata come memo (es. "non lavorato") non viene contata.
  // Se omesso, il breakdown resta una pura proiezione (comportamento storico).
  actualTx?: Transaction[]
}

const SOURCE_LABELS: Record<BreakdownSource, string> = {
  recurring_income: 'Entrata ricorrente',
  recurring_expense: 'Spesa ricorrente',
  weekly_budget: 'Budget settimanale',
  planned: 'Pianificata',
  transfer: 'Trasferimento',
  actual: 'Già avvenuta',
}

type Reconciled = { amount: number } | 'skip' | null

export function getPeriodBreakdown(args: Args): BreakdownItem[] {
  const { startDate, endDate, recurringExpenses, recurringIncome, weeklyBudgets, planned, excludedFundIds, fromToday = false, actualTx } = args
  const excluded = new Set(excludedFundIds)
  const items: BreakdownItem[] = []
  const today = startOfDay(new Date())
  const lowerBound = fromToday && isAfter(today, startDate) ? today : startDate

  // Mappe per riconciliare le occorrenze con le transazioni reali collegate.
  const incomeActual = new Map<string, Transaction>()
  const expenseActual = new Map<string, Transaction>()
  if (actualTx) {
    for (const tx of actualTx) {
      if (tx.is_planned) continue
      if (tx.recurring_income_id) incomeActual.set(`${tx.recurring_income_id}|${tx.date}`, tx)
      if (tx.recurring_expense_id) expenseActual.set(`${tx.recurring_expense_id}|${tx.date}`, tx)
    }
  }

  // null  → nessuna riconciliazione (usa l'importo previsto)
  // 'skip' → occorrenza gestita ma senza movimento reale (memo / "non lavorato"): non contare
  // {amount} → occorrenza confermata: usa l'importo effettivo
  const reconcile = (map: Map<string, Transaction>, key: string): Reconciled => {
    if (!actualTx) return null
    const tx = map.get(key)
    if (!tx) return null
    if (tx.is_memo) return 'skip'
    return { amount: Number(tx.amount) }
  }

  const cursor = new Date(lowerBound)
  while (!isAfter(cursor, endDate)) {
    const dom = getDate(cursor)
    const dim = getDaysInMonth(cursor)
    const dateStr = toDateString(cursor)

    for (const inc of recurringIncome) {
      if (!inc.is_active) continue
      if (inc.fund_id && excluded.has(inc.fund_id)) continue
      if (inc.start_date && dateStr < inc.start_date) continue
      if (inc.end_date && dateStr > inc.end_date) continue
      if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
        const adjusted = Math.min(inc.day_of_month, dim)
        if (dom === adjusted) {
          const r = reconcile(incomeActual, `${inc.id}|${dateStr}`)
          if (r !== 'skip') {
            items.push({
              date: dateStr, description: inc.name, amount: r ? r.amount : Number(inc.amount),
              kind: 'income', source: 'recurring_income', sourceLabel: SOURCE_LABELS.recurring_income,
            })
          }
        }
      } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
        const delayDays = inc.delay_days || 0
        const baseDay = addDays(cursor, -delayDays)
        if (getDay(baseDay) === inc.day_of_week) {
          const r = reconcile(incomeActual, `${inc.id}|${toDateString(baseDay)}`)
          if (r !== 'skip') {
            items.push({
              date: dateStr, description: inc.name, amount: r ? r.amount : Number(inc.amount),
              kind: 'income', source: 'recurring_income', sourceLabel: SOURCE_LABELS.recurring_income,
            })
          }
        }
      }
    }

    for (const exp of recurringExpenses) {
      if (!exp.is_active) continue
      if (exp.start_date && dateStr < exp.start_date) continue
      if (exp.end_date && isAfter(cursor, new Date(exp.end_date))) continue
      if ((exp.type || 'expense') === 'transfer') continue
      if (exp.fund_id && excluded.has(exp.fund_id)) continue
      const freq = exp.frequency || 'monthly'
      let occurs = false
      if (freq === 'monthly' && exp.day_of_month !== null) {
        const adjusted = Math.min(exp.day_of_month, dim)
        if (dom === adjusted) occurs = true
      } else if (freq === 'weekly' && exp.day_of_week !== null) {
        if (getDay(cursor) === exp.day_of_week) occurs = true
      } else if (freq === 'yearly' && exp.day_of_month !== null && exp.month_of_year !== null) {
        const adjusted = Math.min(exp.day_of_month, dim)
        if (dom === adjusted && cursor.getMonth() + 1 === exp.month_of_year) occurs = true
      }
      if (occurs) {
        const r = reconcile(expenseActual, `${exp.id}|${dateStr}`)
        if (r !== 'skip') {
          items.push({
            date: dateStr,
            description: exp.name + (freq === 'yearly' ? ' (annuale)' : ''),
            amount: r ? r.amount : Number(exp.amount),
            kind: 'expense',
            source: 'recurring_expense',
            sourceLabel: SOURCE_LABELS.recurring_expense,
            category: exp.category,
          })
        }
      }
    }

    for (const p of planned) {
      if (!p.is_planned) continue
      if (p.fund_id && excluded.has(p.fund_id)) continue
      if (p.type === 'transfer' && p.fund_to_id && excluded.has(p.fund_to_id)) continue
      const pDate = startOfDay(new Date(p.date))
      if (!isSameDay(pDate, cursor)) continue
      if (p.type === 'income') {
        items.push({
          date: dateStr, description: p.description || 'Pianificata',
          amount: Number(p.amount), kind: 'income', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
        })
      } else if (p.type === 'expense') {
        items.push({
          date: dateStr, description: p.description || 'Pianificata',
          amount: Number(p.amount), kind: 'expense', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
          category: p.category,
        })
      }
    }

    if (getDay(cursor) === 1 && !isBefore(cursor, startDate)) {
      for (const b of weeklyBudgets) {
        if (!b.is_active) continue
        if (b.fund_id && excluded.has(b.fund_id)) continue
        items.push({
          date: dateStr, description: `${b.name} (settimana)`, amount: Number(b.amount),
          kind: 'expense', source: 'weekly_budget', sourceLabel: SOURCE_LABELS.weekly_budget,
        })
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  return items
}

export function totalsFromBreakdown(items: BreakdownItem[]): { income: number; expenses: number } {
  let income = 0, expenses = 0
  for (const it of items) {
    if (it.kind === 'income') income += it.amount
    else expenses += it.amount
  }
  return { income: Math.round(income * 100) / 100, expenses: Math.round(expenses * 100) / 100 }
}
