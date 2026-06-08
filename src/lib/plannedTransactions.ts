import { supabase } from './supabase'
import { todayString } from './utils'
import { withPlannedDate } from './schemaSupport'
import { incrementFundBalance } from './fundBalances'
import type { Transaction } from '../types'

export async function markPlannedAsDone(
  planned: Transaction,
  overrides?: { amount?: number; fund_id?: string | null; date?: string }
): Promise<{ error?: string }> {
  // La data EFFETTIVA (quando segno "fatto") conta nei saldi/totali; quella prevista originale
  // resta in planned_date. Default: oggi, sovrascrivibile dal modal di completamento.
  const effectiveDate = overrides?.date || todayString()
  const amount = overrides?.amount != null ? overrides.amount : Number(planned.amount)
  const fundId = overrides && 'fund_id' in overrides ? overrides.fund_id ?? null : planned.fund_id

  const { error: updErr } = await supabase
    .from('transactions')
    .update(withPlannedDate({ is_planned: false, date: effectiveDate, amount, fund_id: fundId }, planned.date))
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
