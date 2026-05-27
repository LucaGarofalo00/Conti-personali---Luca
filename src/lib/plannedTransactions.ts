import { supabase } from './supabase'
import { todayString } from './utils'
import { incrementFundBalance } from './fundBalances'
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
    await incrementFundBalance(fundId, planned.type === 'income' ? amount : -amount)
  }
  if (planned.type === 'transfer' && planned.fund_to_id) {
    await incrementFundBalance(planned.fund_to_id, amount)
  }

  return {}
}
