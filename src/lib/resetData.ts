import { supabase } from './supabase'
import { todayString } from './utils'
import { getPeriodSettings, setLocalPeriodSettings } from './periodSettings'

export interface ResetResult {
  error: string | null
  // Quante voci pianificate passate (data < oggi) sono state eliminate, per il messaggio finale.
  deletedPastPlanned?: number
}

const PROMPT_DISMISSED_KEY = 'finanzapp:periodPromptDismissed'

// "Ricomincia da oggi": azzera lo storico mantenendo la configurazione.
//  - elimina TUTTI i movimenti reali (non pianificati): tutto lo storico sparisce;
//  - elimina le pianificate PASSATE (data < oggi), mantiene quelle FUTURE (data >= oggi);
//  - NON tocca i saldi dei fondi (li reimposta l'utente nella pagina Fondi), né le entrate,
//    le spese ricorrenti o i budget;
//  - imposta l'inizio del periodo corrente a OGGI, così le occorrenze ricorrenti precedenti a
//    oggi non vengono più mostrate/applicate (si riparte pulito dal periodo corrente).
//
// ORDINE IMPORTANTE: la scrittura dell'inizio periodo sul DB avviene PER PRIMA, perché è
// idempotente e reversibile. Se fallisce (es. tabella user_settings mancante / rete) ci si ferma
// PRIMA di eliminare alcunché: lo storico resta intatto e non si crea uno stato incoerente
// ("reset fallito" ma dati già persi). Lo store locale e il flag del prompt si aggiornano solo
// alla fine, quando tutto è andato a buon fine.
//
// Nota: l'eliminazione dei movimenti è "grezza" (non ripristina i saldi voce per voce), proprio
// perché vogliamo conservare i saldi attuali come punto di partenza che poi l'utente correggerà.
export async function resetFromToday(userId: string): Promise<ResetResult> {
  const resetDate = todayString()
  const cur = getPeriodSettings()

  const finalizeLocal = () => {
    setLocalPeriodSettings({ periodStart: resetDate })
    try { localStorage.removeItem(PROMPT_DISMISSED_KEY) } catch { /* localStorage non disponibile */ }
  }

  // Percorso PREFERITO: RPC ATOMICA (vedi supabase-reset-from-today.sql) che fa upsert periodo +
  // delete movimenti + delete pianificate passate in UN'UNICA transazione (o tutto o niente).
  try {
    const { data, error } = await supabase.rpc('reset_from_today', {
      p_user_id: userId,
      p_period_start: resetDate,
      p_salary_income_id: cur.salaryIncomeId,
      p_anchor_day: cur.anchorDay,
    })
    if (!error) {
      finalizeLocal()
      return { error: null, deletedPastPlanned: typeof data === 'number' ? data : 0 }
    }
  } catch { /* RPC non deployata: fallback NON atomico sotto */ }

  // 1) Persisti PRIMA il nuovo inizio periodo sul DB (gating reversibile). Se fallisce, esci
  //    senza eliminare nulla.
  const settingsRes = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      period_start: resetDate,
      salary_income_id: cur.salaryIncomeId,
      anchor_day: cur.anchorDay,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (settingsRes.error) {
    return { error: settingsRes.error.message || 'Errore salvataggio periodo' }
  }

  // 2) Movimenti reali (storico) → via tutti. Se fallisce: il periodo sul DB è già a OGGI, quindi
  //    allineo lo store locale così la UI non resta sul vecchio periodo (DB e UI coerenti).
  const delReal = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', userId)
    .eq('is_planned', false)
  if (delReal.error) {
    finalizeLocal()
    return { error: delReal.error.message || 'Errore eliminazione movimenti' }
  }

  // 3) Pianificate passate (data < oggi) → via; quelle future restano.
  const delPastPlanned = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', userId)
    .eq('is_planned', true)
    .lt('date', resetDate)
    .select('id')
  if (delPastPlanned.error) {
    finalizeLocal()
    return { error: delPastPlanned.error.message || 'Errore eliminazione pianificate passate' }
  }

  // 4) Tutto ok: allinea lo store locale (UI) e azzera l'eventuale "non ora" del prompt stipendio.
  finalizeLocal()

  return { error: null, deletedPastPlanned: delPastPlanned.data?.length ?? 0 }
}
