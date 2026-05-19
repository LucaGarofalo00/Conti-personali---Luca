import { supabase } from './supabase'
import { todayString } from './utils'
import type { Transaction } from '../types'

export async function markPlannedAsDone(planned: Transaction): Promise<{ error?: string }> {
  const today = todayString()
  const txDate = planned.date <= today ? planned.date : today

  const { error: updErr } = await supabase
    .from('transactions')
    .update({ is_planned: false, date: txDate })
    .eq('id', planned.id)
  if (updErr) return { error: updErr.message }

  const amount = Number(planned.amount)
  if (planned.fund_id) {
    const { data: fund } = await supabase.from('funds').select('balance').eq('id', planned.fund_id).single()
    if (fund) {
      const delta = planned.type === 'income' ? amount : -amount
      await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', planned.fund_id)
    }
  }
  if (planned.type === 'transfer' && planned.fund_to_id) {
    const { data: to } = await supabase.from('funds').select('balance').eq('id', planned.fund_to_id).single()
    if (to) await supabase.from('funds').update({ balance: Number(to.balance) + amount }).eq('id', planned.fund_to_id)
  }

  return {}
}
