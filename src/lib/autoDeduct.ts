import { supabase } from './supabase'
import { getDateInCurrentPeriod, toDateString, todayString, getBillingPeriodFor } from './utils'
import type { RecurringExpense, Transaction } from '../types'

interface ProcessArgs {
  userId: string
  expenses: RecurringExpense[]
  periodTx: Transaction[]
}

function computeOccurrencesInCurrentPeriod(exp: RecurringExpense): Date[] {
  const freq = exp.frequency || 'monthly'
  if (freq === 'monthly') {
    if (exp.day_of_month === null) return []
    return [getDateInCurrentPeriod(exp.day_of_month)]
  }
  if (freq === 'weekly' && exp.day_of_week !== null) {
    const { startDate, endDate } = getBillingPeriodFor(new Date())
    const dates: Date[] = []
    const cursor = new Date(startDate)
    while (cursor <= endDate) {
      if (cursor.getDay() === exp.day_of_week) dates.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  }
  if (freq === 'yearly' && exp.day_of_month !== null && exp.month_of_year !== null) {
    const { startDate, endDate } = getBillingPeriodFor(new Date())
    const dates: Date[] = []
    const cursor = new Date(startDate)
    while (cursor <= endDate) {
      if (cursor.getDate() === Math.min(exp.day_of_month, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate())
          && cursor.getMonth() + 1 === exp.month_of_year) {
        dates.push(new Date(cursor))
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  }
  return []
}

export async function processAutoDeducts({ userId, expenses, periodTx }: ProcessArgs): Promise<number> {
  const today = new Date()
  const todayStr = todayString()
  let processed = 0

  for (const exp of expenses) {
    if (!exp.is_active || !exp.auto_deduct) continue
    if (exp.end_date && exp.end_date < todayStr) continue
    if (!exp.fund_id) continue

    const isTransfer = (exp.type || 'expense') === 'transfer'
    const txType = isTransfer ? 'transfer' : 'expense'

    for (const dueDate of computeOccurrencesInCurrentPeriod(exp)) {
      if (dueDate > today) continue
      const dueDateStr = toDateString(dueDate)
      if (exp.start_date && dueDateStr < exp.start_date) continue

      const alreadyProcessed = periodTx.some(tx =>
        (tx.recurring_expense_id === exp.id && tx.date === dueDateStr) ||
        (
          tx.description === exp.name &&
          tx.type === txType &&
          tx.fund_id === exp.fund_id &&
          tx.date === dueDateStr &&
          (!isTransfer || tx.fund_to_id === exp.fund_to_id)
        )
      )
      if (alreadyProcessed) continue

      const amount = Number(exp.amount)

      const { data: inserted, error: txError } = await supabase.from('transactions').insert({
        user_id: userId,
        type: txType,
        amount,
        description: exp.name,
        fund_id: exp.fund_id,
        fund_to_id: isTransfer ? exp.fund_to_id : null,
        category: isTransfer ? 'trasferimento' : exp.category,
        recurring_expense_id: exp.id,
        date: dueDateStr,
      }).select().single()
      if (txError || !inserted) continue

      if (isTransfer && exp.fund_to_id) {
        const [{ data: from }, { data: to }] = await Promise.all([
          supabase.from('funds').select('balance').eq('id', exp.fund_id).single(),
          supabase.from('funds').select('balance').eq('id', exp.fund_to_id).single(),
        ])
        if (from) await supabase.from('funds').update({ balance: Number(from.balance) - amount }).eq('id', exp.fund_id)
        if (to) await supabase.from('funds').update({ balance: Number(to.balance) + amount }).eq('id', exp.fund_to_id)
      } else {
        const { data: fund } = await supabase.from('funds').select('balance').eq('id', exp.fund_id).single()
        if (fund) await supabase.from('funds').update({ balance: Number(fund.balance) - amount }).eq('id', exp.fund_id)
      }

      periodTx.push(inserted as Transaction)
      processed++
    }
  }

  return processed
}
