import { supabase } from './supabase'
import { todayString } from './utils'
import type { Transaction } from '../types'

export async function markPlannedAsDone(
  planned: Transaction,
  overrides?: { amount?: number; fund_id?: string | null }
): Promise<{ error?: string }> {
  const today = todayString()
  const txDate = planned.date <= today ? planned.date : today
  const amount = overrides?.amount != null ? overrides.amount : Number(planned.amount)
  const fundId = overrides && 'fund_id' in overrides ? overrides.fund_id ?? null : planned.fund_id

  const { error: updErr } = await supabase
    .from('transactions')
    .update({ is_planned: false, date: txDate, amount, fund_id: fundId })
    .eq('id', planned.id)
  if (updErr) return { error: updErr.message }

  if (fundId) {
    const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
    if (fund) {
      const delta = planned.type === 'income' ? amount : -amount
      await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fundId)
    }
  }
  if (planned.type === 'transfer' && planned.fund_to_id) {
    const { data: to } = await supabase.from('funds').select('balance').eq('id', planned.fund_to_id).single()
    if (to) await supabase.from('funds').update({ balance: Number(to.balance) + amount }).eq('id', planned.fund_to_id)
  }

  return {}
}
