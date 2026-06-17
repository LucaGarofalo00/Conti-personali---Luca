import { supabase } from './supabase'
import { round2 } from './utils'

// Aggiornamento ATOMICO del saldo di un fondo tramite la RPC `increment_fund_balance`
// (vedi supabase-rpc-balances.sql): un singolo UPDATE lato DB, niente read-modify-write.
//
// Fallback: se la RPC non è disponibile (non ancora deployata, oppure nei test che mockano
// solo `supabase.from`) si torna al vecchio metodo. In caso di errore della RPC l'UPDATE
// atomico NON è stato applicato, quindi il fallback non causa doppi addebiti.
export async function incrementFundBalance(fundId: string | null, delta: number): Promise<boolean> {
  if (!fundId || delta === 0) return true
  if (await rpcIncrement(fundId, delta)) return true
  const { data: fund, error } = await supabase.from('funds').select('balance').eq('id', fundId).single()
  if (error || !fund) return false
  const { error: upErr } = await supabase.from('funds').update({ balance: round2(Number(fund.balance) + delta) }).eq('id', fundId)
  return !upErr
}

async function rpcIncrement(fundId: string, delta: number): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('increment_fund_balance', { p_fund_id: fundId, p_delta: delta })
    return !error
  } catch {
    return false
  }
}

// Trasferimento tra due fondi. Prova la RPC ATOMICA `transfer_funds` (vedi
// supabase-rpc-balances.sql): se deployata, i due saldi cambiano nella stessa transazione.
// Fallback ai due increment separati se la RPC non è disponibile (comportamento storico).
export async function transferFunds(fromId: string | null, toId: string | null, amount: number): Promise<void> {
  if (!fromId || !toId || amount === 0) return
  try {
    const { error } = await supabase.rpc('transfer_funds', { p_from: fromId, p_to: toId, p_delta: amount })
    if (!error) return
  } catch { /* RPC non disponibile: fallback sotto */ }
  // Fallback NON atomico (due update separati): se il secondo fallisce, ripristina il primo per
  // non lasciare i fondi sbilanciati (uno scalato, l'altro no).
  const ok1 = await incrementFundBalance(fromId, -amount)
  if (!ok1) return
  const ok2 = await incrementFundBalance(toId, amount)
  if (!ok2) await incrementFundBalance(fromId, amount)
}
