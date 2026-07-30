import { supabase } from './supabase'

// Rileva una volta sola se la colonna transactions.planned_date esiste (DB migrato). Finché
// non è confermata supportata, planned_date NON viene incluso nei payload: così l'app continua
// a funzionare anche sui database non ancora aggiornati (degrada al comportamento storico,
// con riconciliazione solo per finestra invece che per data prevista esatta).
let plannedDateSupported: boolean | null = null

export function plannedDateSupportedNow(): boolean {
  return plannedDateSupported === true
}

export async function probePlannedDateSupport(): Promise<boolean> {
  if (plannedDateSupported !== null) return plannedDateSupported
  const { error } = await supabase.from('transactions').select('planned_date').limit(1)
  plannedDateSupported = !(error && /planned_date/i.test(error.message || ''))
  return plannedDateSupported
}

// Aggiunge planned_date a un payload di transazione solo se la colonna è supportata.
// Usa Record<string, unknown> per non interferire con l'inferenza di tipo di supabase.insert.
export function withPlannedDate(payload: Record<string, unknown>, plannedDate: string | null): Record<string, unknown> {
  return plannedDateSupported === true ? { ...payload, planned_date: plannedDate } : payload
}

// Stessa logica per transactions.planned_parent_id (spese pianificate usate come budget a
// progetto, vedi supabase-planned-budget.sql). Senza la colonna la funzione resta semplicemente
// non disponibile: i selettori "rientra in" non mostrano le pianificate e il resto non cambia.
let plannedParentSupported: boolean | null = null

export function plannedParentSupportedNow(): boolean {
  return plannedParentSupported === true
}

export async function probePlannedParentSupport(): Promise<boolean> {
  if (plannedParentSupported !== null) return plannedParentSupported
  const { error } = await supabase.from('transactions').select('planned_parent_id').limit(1)
  plannedParentSupported = !(error && /planned_parent_id/i.test(error.message || ''))
  return plannedParentSupported
}

// Include planned_parent_id nel payload solo se la colonna esiste. Passare null è lecito e
// significa "nessun budget a progetto": va comunque scritto, per poter SGANCIARE un movimento.
export function withPlannedParent(payload: Record<string, unknown>, plannedParentId: string | null): Record<string, unknown> {
  return plannedParentSupported === true ? { ...payload, planned_parent_id: plannedParentId } : payload
}
