import { addDays, addMonths, startOfWeek, getDate, getDay, getDaysInMonth, format, startOfDay, isBefore, isAfter } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense, ForecastPoint } from '../types'

function isExcluded(fundId: string | null, excluded: Set<string>): boolean {
  return fundId !== null && excluded.has(fundId)
}

export function generateForecast(
  funds: Fund[],
  recurringExpenses: RecurringExpense[],
  recurringIncome: RecurringIncome[],
  weeklyBudgets: WeeklyBudget[],
  variableExpenses: VariableExpense[],
  months: number = 6,
  excludedFundIds: string[] = []
): ForecastPoint[] {
  const excluded = new Set(excludedFundIds)
  const today = startOfDay(new Date())
  const endDate = addMonths(today, months)
  const totalBalance = funds
    .filter(f => !excluded.has(f.id))
    .reduce((sum, f) => sum + Number(f.balance), 0)

  let runningBalance = totalBalance
  const points: ForecastPoint[] = [{
    date: format(today, 'yyyy-MM-dd'),
    balance: Math.round(runningBalance * 100) / 100,
    income: 0,
    expenses: 0,
    label: format(today, 'dd MMM', { locale: it }),
  }]

  let weekStart = startOfWeek(addDays(today, 1), { weekStartsOn: 1 })
  if (isBefore(weekStart, addDays(today, 1))) {
    weekStart = addDays(weekStart, 7)
  }

  while (isBefore(weekStart, endDate)) {
    let weekIncome = 0
    let weekExpenses = 0

    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d)
      if (isBefore(day, today) || isAfter(day, endDate)) continue

      const dom = getDate(day)
      const dim = getDaysInMonth(day)

      for (const inc of recurringIncome) {
        if (!inc.is_active) continue
        if (isExcluded(inc.fund_id, excluded)) continue
        if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
          const adjusted = Math.min(inc.day_of_month, dim)
          if (dom === adjusted) weekIncome += Number(inc.amount)
        } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
          const delayDays = inc.delay_days || 0
          const baseDay = addDays(day, -delayDays)
          if (getDay(baseDay) === inc.day_of_week) weekIncome += Number(inc.amount)
        }
      }

      for (const exp of recurringExpenses) {
        if (!exp.is_active) continue
        if (exp.end_date && isAfter(day, new Date(exp.end_date))) continue
        if (isExcluded(exp.fund_id, excluded)) continue
        if ((exp.type || 'expense') === 'transfer' && isExcluded(exp.fund_to_id, excluded)) continue
        const adjusted = Math.min(exp.day_of_month, dim)
        if (dom === adjusted) weekExpenses += Number(exp.amount)
      }
    }

    for (const b of weeklyBudgets) {
      if (!b.is_active) continue
      if (isExcluded(b.fund_id, excluded)) continue
      weekExpenses += Number(b.amount)
    }

    for (const ve of variableExpenses) {
      if (!ve.is_active) continue
      if (isExcluded(ve.fund_id, excluded)) continue
      if (ve.frequency === 'weekly') {
        weekExpenses += Number(ve.estimated_amount)
      } else {
        weekExpenses += Number(ve.estimated_amount) / 4.33
      }
    }

    runningBalance += weekIncome - weekExpenses

    points.push({
      date: format(weekStart, 'yyyy-MM-dd'),
      balance: Math.round(runningBalance * 100) / 100,
      income: Math.round(weekIncome * 100) / 100,
      expenses: Math.round(weekExpenses * 100) / 100,
      label: format(weekStart, 'dd MMM', { locale: it }),
    })

    weekStart = addDays(weekStart, 7)
  }

  return points
}

export function getMonthlyEstimates(
  recurringExpenses: RecurringExpense[],
  recurringIncome: RecurringIncome[],
  weeklyBudgets: WeeklyBudget[],
  variableExpenses: VariableExpense[],
  excludedFundIds: string[] = []
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
    monthlyExpenses += Number(exp.amount)
  }

  for (const b of weeklyBudgets) {
    if (!b.is_active) continue
    if (isExcluded(b.fund_id, excluded)) continue
    monthlyExpenses += Number(b.amount) * 4.33
  }

  for (const ve of variableExpenses) {
    if (!ve.is_active) continue
    if (isExcluded(ve.fund_id, excluded)) continue
    monthlyExpenses += ve.frequency === 'weekly'
      ? Number(ve.estimated_amount) * 4.33
      : Number(ve.estimated_amount)
  }

  return {
    monthlyIncome: Math.round(monthlyIncome * 100) / 100,
    monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
    monthlyNet: Math.round((monthlyIncome - monthlyExpenses) * 100) / 100,
  }
}
