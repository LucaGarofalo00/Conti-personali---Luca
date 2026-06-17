import { supabase } from './supabase'
import { incrementFundBalance, transferFunds } from './fundBalances'
import { withPlannedDate } from './schemaSupport'

// Inserimento di un movimento + aggiornamento dei saldi. Prova la RPC ATOMICA `post_transaction`
// (vedi supabase-post-transaction.sql): se deployata, insert e saldo avvengono nella STESSA
// transazione DB. Altrimenti ricade ESATTAMENTE sul comportamento storico (insert separato +
// incrementFundBalance/transferFunds), quindi finché non esegui la SQL non cambia nulla.

export interface TxPayload {
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description?: string
  fund_id?: string | null
  fund_to_id?: string | null
  category?: string
  budget_id?: string | null
  recurring_expense_id?: string | null
  recurring_income_id?: string | null
  is_memo?: boolean
  is_planned?: boolean
  fuel_km?: number | null
  fuel_liters?: number | null
  fuel_price_per_liter?: number | null
  fuel_type?: 'benzina' | 'gpl' | null
  fuel_odometer?: number | null
  planned_date?: string | null
  date: string
}

// Movimenti di saldo impliciti in un payload "che muove denaro" (no memo, no pianificata).
// Pura: testabile e usata sia per documentare l'intento sia dal fallback.
export function payloadDeltas(p: TxPayload): { fundId: string; delta: number }[] {
  if (p.is_memo || p.is_planned) return []
  const out: { fundId: string; delta: number }[] = []
  if (p.type === 'transfer') {
    if (p.fund_id) out.push({ fundId: p.fund_id, delta: -p.amount })
    if (p.fund_to_id) out.push({ fundId: p.fund_to_id, delta: p.amount })
  } else if (p.fund_id) {
    out.push({ fundId: p.fund_id, delta: p.type === 'income' ? p.amount : -p.amount })
  }
  return out
}

// Cache disponibilità RPC: null=ignoto, true=presente, false=assente (salta la RPC e va al fallback).
let rpcAvailable: boolean | null = null

// Riconosce SOLO l'assenza della funzione (PostgREST PGRST202), non altri errori: così un errore
// vero (es. violazione di vincolo) NON innesca il fallback, evitando un doppio inserimento.
function isMissingFn(err: { code?: string; message?: string }): boolean {
  if (err.code === 'PGRST202') return true
  return !!err.message && /post_transaction/i.test(err.message) && /(could not find|does not exist|schema cache)/i.test(err.message)
}

async function applyPayloadBalance(p: TxPayload): Promise<void> {
  if (p.type === 'transfer' && p.fund_id && p.fund_to_id) {
    await transferFunds(p.fund_id, p.fund_to_id, p.amount)
    return
  }
  for (const { fundId, delta } of payloadDeltas(p)) await incrementFundBalance(fundId, delta)
}

export async function postTransaction(userId: string, p: TxPayload): Promise<{ error: string | null }> {
  if (rpcAvailable !== false) {
    const { error } = await supabase.rpc('post_transaction', { p_tx: { ...p }, p_apply_balance: true })
    if (!error) { rpcAvailable = true; return { error: null } }
    if (!isMissingFn(error)) return { error: error.message } // errore vero: niente fallback
    rpcAvailable = false // funzione non deployata: usa il percorso storico
  }
  // Fallback storico: planned_date va incluso solo se la colonna è supportata (withPlannedDate),
  // per non rompere i DB non ancora migrati.
  const { planned_date, ...rest } = p
  const { error } = await supabase.from('transactions').insert(withPlannedDate({ user_id: userId, ...rest }, planned_date ?? null))
  if (error) return { error: error.message }
  await applyPayloadBalance(p)
  return { error: null }
}
