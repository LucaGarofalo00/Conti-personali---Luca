import { supabase } from './supabase'
import { getDateInCurrentPeriod, toDateString, todayString } from './utils'
import type { RecurringExpense, Transaction } from '../types'

interface ProcessArgs {
  userId: string
  expenses: RecurringExpense[]
  periodTx: Transaction[]
}

export async function processAutoDeducts({ userId, expenses, periodTx }: ProcessArgs): Promise<number> {
  const today = new Date()
  const todayStr = todayString()
  let processed = 0

  for (const exp of expenses) {
    if (!exp.is_active || !exp.auto_deduct) continue
    if (exp.end_date && exp.end_date < todayStr) continue
    if (!exp.fund_id) continue

    const dueDate = getDateInCurrentPeriod(exp.day_of_month)
    if (dueDate > today) continue

    const isTransfer = (exp.type || 'expense') === 'transfer'
    const txType = isTransfer ? 'transfer' : 'expense'

    const alreadyProcessed = periodTx.some(tx =>
      tx.recurring_expense_id === exp.id ||
      (
        tx.description === exp.name &&
        tx.type === txType &&
        tx.fund_id === exp.fund_id &&
        (!isTransfer || tx.fund_to_id === exp.fund_to_id)
      )
    )
    if (alreadyProcessed) continue

    const dueDateStr = toDateString(dueDate)
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

  return processed
}
