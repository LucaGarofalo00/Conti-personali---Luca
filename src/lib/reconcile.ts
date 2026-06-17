import { supabase } from './supabase'

// Ricalcola i saldi dei fondi dal registro delle transazioni, tramite la RPC
// `recompute_fund_balances` (vedi supabase-reconcile.sql). Il modello: ogni fondo ha un
// `opening_balance` (saldo iniziale) e il saldo mostrato = opening_balance + somma dei movimenti
// reali (no memo, no pianificate). Questo ripara eventuali derive senza cancellare il saldo
// iniziale impostato a mano.
//
// Degrada con grazia: se la migrazione non è stata eseguita (RPC assente), lo segnala invece di
// fallire in modo opaco — coerente con lo stile difensivo del resto dell'app.
export async function recomputeBalances(userId: string): Promise<{ ok: boolean; notDeployed?: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('recompute_fund_balances', { p_user_id: userId })
    if (!error) return { ok: true }
    if (/function .*recompute_fund_balances|does not exist|schema cache|find the function/i.test(error.message || '')) {
      return { ok: false, notDeployed: true, error: error.message }
    }
    return { ok: false, error: error.message }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Errore sconosciuto' }
  }
}
