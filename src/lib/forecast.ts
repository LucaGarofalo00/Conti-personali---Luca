import { addDays, addMonths, startOfWeek, getDate, getDay, getDaysInMonth, format, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns'
import { it } from 'date-fns/locale'
import { inSameRecurrenceWindow } from './recurrenceMatch'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, Transaction, ForecastPoint } from '../types'

function isExcluded(fundId: string | null, excluded: Set<string>): boolean {
  return fundId !== null && excluded.has(fundId)
}

export function generateForecast(
  funds: Fund[],
  recurringExpenses: RecurringExpense[],
  recurringIncome: RecurringIncome[],
  weeklyBudgets: WeeklyBudget[],
  endDateOrMonths: Date | number = 6,
  excludedFundIds: string[] = [],
  plannedTransactions: Transaction[] = [],
  // Transazioni reali del periodo corrente: le occorrenze ricorrenti già realizzate (saldate)
  // o segnate "non lavorato"/"non avvenuto" (memo) non vengono riproiettate, perché il loro
  // effetto è già nel saldo di partenza (o non deve contare). Se omesso → pura proiezione.
  actualTx: Transaction[] = []
): ForecastPoint[] {
  const excluded = new Set(excludedFundIds)
  const today = startOfDay(new Date())
  const endDate = endDateOrMonths instanceof Date ? startOfDay(endDateOrMonths) : addMonths(today, endDateOrMonths)
  if (isBefore(endDate, today)) {
    return [{
      date: format(today, 'yyyy-MM-dd'),
      balance: Math.round(funds.filter(f => !excluded.has(f.id)).reduce((s, f) => s + Number(f.balance), 0) * 100) / 100,
      income: 0, expenses: 0, label: format(today, 'dd MMM', { locale: it }),
    }]
  }
  const totalBalance = funds.filter(f => !excluded.has(f.id)).reduce((sum, f) => sum + Number(f.balance), 0)

  const pendingPlanned = plannedTransactions
    .filter(p => p.is_planned && !isExcluded(p.fund_id, excluded))
    .filter(p => p.type !== 'transfer' || !isExcluded(p.fund_to_id, excluded))
    .map(p => ({ ...p, dateObj: startOfDay(parseLocalDate(p.date)) }))

  // Riconciliazione col reale: occorrenze ricorrenti già realizzate o memo "non lavorato"
  // vengono saltate. L'aggancio preferisce planned_date (data prevista) e ricade sulla finestra
  // della data effettiva. Consumo greedy: una transazione copre al più un'occorrenza.
  const incomeByRec = new Map<string, Transaction[]>()
  const expenseByRec = new Map<string, Transaction[]>()
  for (const tx of actualTx) {
    if (tx.is_planned) continue
    if (tx.recurring_income_id) {
      const arr = incomeByRec.get(tx.recurring_income_id) || []
      arr.push(tx); incomeByRec.set(tx.recurring_income_id, arr)
    }
    if (tx.recurring_expense_id) {
      const arr = expenseByRec.get(tx.recurring_expense_id) || []
      arr.push(tx); expenseByRec.set(tx.recurring_expense_id, arr)
    }
  }
  const byDate = (a: Transaction, b: Transaction) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  for (const arr of incomeByRec.values()) arr.sort(byDate)
  for (const arr of expenseByRec.values()) arr.sort(byDate)
  const consumedRealized = new Set<string>()
  const isRealized = (map: Map<string, Transaction[]>, recId: string, occDateStr: string, windowFn: (txDate: string) => boolean): boolean => {
    const arr = map.get(recId)
    if (!arr) return false
    const tx = arr.find(t => !consumedRealized.has(t.id) && (t.planned_date ? t.planned_date === occDateStr : windowFn(t.date)))
    if (!tx) return false
    consumedRealized.add(tx.id)
    return true
  }

  function aggregateRange(start: Date, end: Date): { income: number; expenses: number } {
    let income = 0, expenses = 0
    const cursor = new Date(start)
    while (!isAfter(cursor, end) && !isAfter(cursor, endDate)) {
      if (!isBefore(cursor, today)) {
        const dom = getDate(cursor)
        const dim = getDaysInMonth(cursor)
        const curStr = format(cursor, 'yyyy-MM-dd')

        for (const inc of recurringIncome) {
          if (!inc.is_active) continue
          if (isExcluded(inc.fund_id, excluded)) continue
          if (inc.start_date && curStr < inc.start_date) continue
          if (inc.end_date && curStr > inc.end_date) continue
          if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
            const adjusted = Math.min(inc.day_of_month, dim)
            if (dom === adjusted && !isRealized(incomeByRec, inc.id, curStr, d => inSameRecurrenceWindow(d, curStr, 'monthly'))) {
              income += Number(inc.amount)
            }
          } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
            const delayDays = inc.delay_days || 0
            const baseDay = addDays(cursor, -delayDays)
            if (getDay(baseDay) === inc.day_of_week) {
              const workStr = format(baseDay, 'yyyy-MM-dd')
              if (!isRealized(incomeByRec, inc.id, curStr, d => d >= workStr && d <= curStr)) {
                income += Number(inc.amount)
              }
            }
          }
        }

        for (const exp of recurringExpenses) {
          if (!exp.is_active) continue
          if (exp.start_date && curStr < exp.start_date) continue
          // end_date INCLUSIVO confrontato come stringa locale (coerente col ramo entrate sopra,
          // evita lo shift UTC di new Date('YYYY-MM-DD')).
          if (exp.end_date && curStr > exp.end_date) continue
          if ((exp.type || 'expense') === 'transfer') continue
          if (isExcluded(exp.fund_id, excluded)) continue
          const freq = exp.frequency || 'monthly'
          if (freq === 'monthly' && exp.day_of_month !== null) {
            const adjusted = Math.min(exp.day_of_month, dim)
            if (dom === adjusted && !isRealized(expenseByRec, exp.id, curStr, d => inSameRecurrenceWindow(d, curStr, 'monthly'))) expenses += Number(exp.amount)
          } else if (freq === 'weekly' && exp.day_of_week !== null) {
            if (getDay(cursor) === exp.day_of_week && !isRealized(expenseByRec, exp.id, curStr, d => inSameRecurrenceWindow(d, curStr, 'weekly'))) expenses += Number(exp.amount)
          } else if (freq === 'yearly' && exp.day_of_month !== null && exp.month_of_year !== null) {
            const adjusted = Math.min(exp.day_of_month, dim)
            if (dom === adjusted && cursor.getMonth() + 1 === exp.month_of_year && !isRealized(expenseByRec, exp.id, curStr, d => inSameRecurrenceWindow(d, curStr, 'yearly'))) expenses += Number(exp.amount)
          }
        }

        for (const planned of pendingPlanned) {
          if (!isSameDay(planned.dateObj, cursor)) continue
          if (planned.type === 'income') income += Number(planned.amount)
          else if (planned.type === 'expense') expenses += Number(planned.amount)
        }

        if (getDay(cursor) === 1) {
          for (const b of weeklyBudgets) {
            if (!b.is_active) continue
            if (isExcluded(b.fund_id, excluded)) continue
            expenses += Number(b.amount)
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }

    return { income, expenses }
  }

  let runningBalance = totalBalance
  const points: ForecastPoint[] = [{
    date: format(today, 'yyyy-MM-dd'),
    balance: Math.round(runningBalance * 100) / 100,
    income: 0,
    expenses: 0,
    label: format(today, 'dd MMM', { locale: it }),
  }]

  let weekStart = startOfWeek(today, { weekStartsOn: 1 })
  while (!isAfter(weekStart, endDate)) {
    const weekEnd = addDays(weekStart, 6)
    const { income, expenses } = aggregateRange(weekStart, weekEnd)
    runningBalance += income - expenses

    const labelDate = isBefore(weekStart, today) ? today : weekStart
    points.push({
      date: format(labelDate, 'yyyy-MM-dd'),
      balance: Math.round(runningBalance * 100) / 100,
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      label: format(labelDate, 'dd MMM', { locale: it }),
    })

    weekStart = addDays(weekStart, 7)
  }

  // Il punto iniziale "oggi" e il primo punto settimanale ricadono sulla stessa data (la label
  // della prima settimana è clampata a oggi): rimuovi i duplicati di data consecutivi tenendo
  // l'ultimo (quello col movimento della settimana), così l'asse X non mostra due volte "oggi".
  return points.filter((p, i) => i === points.length - 1 || p.date !== points[i + 1].date)
}

import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import { getBillingPeriodFor, todayString, parseLocalDate } from './utils'

export interface BalanceProjection {
  balance: number
  targetDate: Date
  totalIncome: number
  totalExpenses: number
}

export function projectBalanceAtDate(
  targetDate: Date,
  currentBalance: number,
  recurringExpenses: RecurringExpense[],
  recurringIncome: RecurringIncome[],
  weeklyBudgets: WeeklyBudget[],
  planned: Transaction[],
  excludedFundIds: string[],
  // Transazioni reali del periodo: se presenti, la proiezione riconcilia col reale (le occorrenze
  // ricorrenti già realizzate non vengono riproiettate; il budget della settimana in corso conta
  // solo il RESIDUO della quota, perché lo speso è già nel saldo di partenza). Se omesso → pura
  // proiezione (comportamento storico).
  actualTx: Transaction[] = []
): BalanceProjection {
  const today = startOfDay(new Date())
  const target = startOfDay(targetDate)
  if (isBefore(target, today)) {
    return { balance: currentBalance, targetDate: target, totalIncome: 0, totalExpenses: 0 }
  }

  const reconcileWithReal = actualTx.length > 0
  let balance = currentBalance
  let totalIncome = 0
  let totalExpenses = 0
  let cursor = today

  while (!isAfter(cursor, target)) {
    const { endDate } = getBillingPeriodFor(cursor)
    const segmentEnd = isBefore(endDate, target) ? endDate : target

    const items = getPeriodBreakdown({
      startDate: cursor,
      endDate: segmentEnd,
      recurringExpenses, recurringIncome, weeklyBudgets, planned,
      excludedFundIds,
      fromToday: false,
      ...(reconcileWithReal ? { actualTx, excludeRealized: true } : {}),
    })
    const totals = totalsFromBreakdown(items)
    balance += totals.income - totals.expenses
    totalIncome += totals.income
    totalExpenses += totals.expenses

    cursor = addDays(endDate, 1)
  }

  return {
    balance: Math.round(balance * 100) / 100,
    targetDate: target,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
  }
}

export function findNextMonthlyIncomeDate(income: RecurringIncome[]): { date: Date; income: RecurringIncome } | null {
  const today = startOfDay(new Date())
  let best: { date: Date; income: RecurringIncome } | null = null
  for (const inc of income) {
    if (!inc.is_active || inc.frequency !== 'monthly' || inc.day_of_month === null) continue
    if (inc.end_date && inc.end_date < todayString()) continue
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(inc.day_of_month, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()))
    let candidate = thisMonth
    if (isBefore(candidate, today)) {
      const nextMonth = today.getMonth() + 1
      const lastDayNext = new Date(today.getFullYear(), nextMonth + 1, 0).getDate()
      candidate = new Date(today.getFullYear(), nextMonth, Math.min(inc.day_of_month, lastDayNext))
    }
    if (inc.start_date && format(candidate, 'yyyy-MM-dd') < inc.start_date) continue
    if (!best || isBefore(candidate, best.date)) {
      best = { date: candidate, income: inc }
    }
  }
  return best
}

export function getMonthlyEstimates(
  recurringExpenses: RecurringExpense[],
  recurringIncome: RecurringIncome[],
  weeklyBudgets: WeeklyBudget[],
  excludedFundIds: string[] = [],
  plannedInPeriod: Transaction[] = []
) {
  const excluded = new Set(excludedFundIds)
  let monthlyIncome = 0
  let monthlyExpenses = 0

  for (const inc of recurringIncome) {
    if (!inc.is_active) continue
    // Bound INCLUSIVI confrontati come stringa locale (un'entrata valida fino a OGGI conta ancora;
    // niente shift UTC di new Date('YYYY-MM-DD')).
    if (inc.end_date && inc.end_date < todayString()) continue
    if (inc.start_date && inc.start_date > todayString()) continue
    if (isExcluded(inc.fund_id, excluded)) continue
    monthlyIncome += inc.frequency === 'monthly'
      ? Number(inc.amount)
      : Number(inc.amount) * 4.33
  }

  for (const exp of recurringExpenses) {
    if (!exp.is_active) continue
    if (exp.end_date && exp.end_date < todayString()) continue
    if (exp.start_date && exp.start_date > todayString()) continue
    if ((exp.type || 'expense') === 'transfer') continue
    if (isExcluded(exp.fund_id, excluded)) continue
    const freq = exp.frequency || 'monthly'
    if (freq === 'weekly') monthlyExpenses += Number(exp.amount) * 4.33
    else if (freq === 'yearly') monthlyExpenses += Number(exp.amount) / 12
    else monthlyExpenses += Number(exp.amount)
  }

  for (const b of weeklyBudgets) {
    if (!b.is_active) continue
    if (isExcluded(b.fund_id, excluded)) continue
    monthlyExpenses += Number(b.amount) * 4.33
  }

  let plannedIncomeInPeriod = 0
  let plannedExpensesInPeriod = 0
  for (const p of plannedInPeriod) {
    if (!p.is_planned) continue
    if (isExcluded(p.fund_id, excluded)) continue
    if (p.type === 'income') plannedIncomeInPeriod += Number(p.amount)
    else if (p.type === 'expense') plannedExpensesInPeriod += Number(p.amount)
  }

  monthlyIncome += plannedIncomeInPeriod
  monthlyExpenses += plannedExpensesInPeriod

  return {
    monthlyIncome: Math.round(monthlyIncome * 100) / 100,
    monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
    monthlyNet: Math.round((monthlyIncome - monthlyExpenses) * 100) / 100,
    plannedIncomeInPeriod: Math.round(plannedIncomeInPeriod * 100) / 100,
    plannedExpensesInPeriod: Math.round(plannedExpensesInPeriod * 100) / 100,
  }
}
