import { supabase } from './supabase'
import { monthlyOccurrencesInCurrentPeriod, toDateString, todayString, getBillingPeriodFor } from './utils'
import { withPlannedDate } from './schemaSupport'
import { incrementFundBalance, transferFunds } from './fundBalances'
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
    // Tutte le occorrenze del periodo (di norma 1; 2 se il periodo è esteso oltre il mese).
    return monthlyOccurrencesInCurrentPeriod(exp.day_of_month)
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

let autoDeductInFlight = false

export async function processAutoDeducts({ userId, expenses, periodTx }: ProcessArgs): Promise<number> {
  // Evita esecuzioni concorrenti nello stesso runtime (doppio mount in StrictMode o load()
  // ravvicinati): senza questo guard la stessa occorrenza può essere addebitata due volte.
  if (autoDeductInFlight) return 0
  autoDeductInFlight = true
  try {
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

      const onDueDate = (tx: Transaction) => tx.date === dueDateStr || tx.planned_date === dueDateStr
      const alreadyProcessed = periodTx.some(tx =>
        (tx.recurring_expense_id === exp.id && onDueDate(tx)) ||
        (
          tx.description === exp.name &&
          tx.type === txType &&
          tx.fund_id === exp.fund_id &&
          onDueDate(tx) &&
          (!isTransfer || tx.fund_to_id === exp.fund_to_id)
        )
      )
      if (alreadyProcessed) continue

      const amount = Number(exp.amount)

      const { data: inserted, error: txError } = await supabase.from('transactions').insert(withPlannedDate({
        user_id: userId,
        type: txType,
        amount,
        description: exp.name,
        fund_id: exp.fund_id,
        fund_to_id: isTransfer ? exp.fund_to_id : null,
        category: isTransfer ? 'trasferimento' : exp.category,
        recurring_expense_id: exp.id,
        date: dueDateStr,
      }, dueDateStr)).select().single()
      if (txError || !inserted) continue

      if (isTransfer && exp.fund_to_id) {
        await transferFunds(exp.fund_id, exp.fund_to_id, amount)
      } else {
        await incrementFundBalance(exp.fund_id, -amount)
      }

      periodTx.push(inserted as Transaction)
      processed++
    }
  }

  return processed
  } finally {
    autoDeductInFlight = false
  }
}
