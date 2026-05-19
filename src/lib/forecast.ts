import { addDays, addMonths, startOfWeek, getDate, getDay, getDaysInMonth, format, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns'
import { it } from 'date-fns/locale'
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
  plannedTransactions: Transaction[] = []
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
    .map(p => ({ ...p, dateObj: startOfDay(new Date(p.date)) }))

  function aggregateRange(start: Date, end: Date, includeWeeklyBudgets: boolean): { income: number; expenses: number } {
    let income = 0, expenses = 0
    const cursor = new Date(start)
    while (!isAfter(cursor, end) && !isAfter(cursor, endDate)) {
      if (!isBefore(cursor, today)) {
        const dom = getDate(cursor)
        const dim = getDaysInMonth(cursor)

        for (const inc of recurringIncome) {
          if (!inc.is_active) continue
          if (isExcluded(inc.fund_id, excluded)) continue
          if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
            const adjusted = Math.min(inc.day_of_month, dim)
            if (dom === adjusted) income += Number(inc.amount)
          } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
            const delayDays = inc.delay_days || 0
            const baseDay = addDays(cursor, -delayDays)
            if (getDay(baseDay) === inc.day_of_week) income += Number(inc.amount)
          }
        }

        for (const exp of recurringExpenses) {
          if (!exp.is_active) continue
          if (exp.end_date && isAfter(cursor, new Date(exp.end_date))) continue
          if (isExcluded(exp.fund_id, excluded)) continue
          if ((exp.type || 'expense') === 'transfer' && isExcluded(exp.fund_to_id, excluded)) continue
          const freq = exp.frequency || 'monthly'
          if (freq === 'monthly' && exp.day_of_month !== null) {
            const adjusted = Math.min(exp.day_of_month, dim)
            if (dom === adjusted) expenses += Number(exp.amount)
          } else if (freq === 'weekly' && exp.day_of_week !== null) {
            if (getDay(cursor) === exp.day_of_week) expenses += Number(exp.amount)
          }
        }

        for (const planned of pendingPlanned) {
          if (!isSameDay(planned.dateObj, cursor)) continue
          if (planned.type === 'income') income += Number(planned.amount)
          else if (planned.type === 'expense') expenses += Number(planned.amount)
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }

    if (includeWeeklyBudgets) {
      for (const b of weeklyBudgets) {
        if (!b.is_active) continue
        if (isExcluded(b.fund_id, excluded)) continue
        expenses += Number(b.amount)
      }
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
    const { income, expenses } = aggregateRange(weekStart, weekEnd, true)
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

  return points
}

import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import { getBillingPeriodFor } from './utils'

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
  excludedFundIds: string[]
): BalanceProjection {
  const today = startOfDay(new Date())
  const target = startOfDay(targetDate)
  if (isBefore(target, today)) {
    return { balance: currentBalance, targetDate: target, totalIncome: 0, totalExpenses: 0 }
  }

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
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(inc.day_of_month, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()))
    let candidate = thisMonth
    if (isBefore(candidate, today)) {
      const nextMonth = today.getMonth() + 1
      const lastDayNext = new Date(today.getFullYear(), nextMonth + 1, 0).getDate()
      candidate = new Date(today.getFullYear(), nextMonth, Math.min(inc.day_of_month, lastDayNext))
    }
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
    if (isExcluded(inc.fund_id, excluded)) continue
    monthlyIncome += inc.frequency === 'monthly'
      ? Number(inc.amount)
      : Number(inc.amount) * 4.33
  }

  for (const exp of recurringExpenses) {
    if (!exp.is_active) continue
    if (exp.end_date && new Date(exp.end_date) < new Date()) continue
    if (isExcluded(exp.fund_id, excluded)) continue
    if ((exp.type || 'expense') === 'transfer' && isExcluded(exp.fund_to_id, excluded)) continue
    const freq = exp.frequency || 'monthly'
    monthlyExpenses += freq === 'weekly' ? Number(exp.amount) * 4.33 : Number(exp.amount)
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
