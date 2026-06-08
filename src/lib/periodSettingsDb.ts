import { supabase } from './supabase'
import { setLocalPeriodSettings, getPeriodSettings, type PeriodSettings } from './periodSettings'

// Caricamento/salvataggio su Supabase delle impostazioni del periodo. Separato da periodSettings.ts
// (che resta puro) per non trascinare supabase nella catena di import di utils.

// Idrata lo store dalle impostazioni salvate sul DB. Tollerante: se la tabella non esiste ancora
// (utente che non ha eseguito supabase-user-settings.sql) o c'è un errore, lascia i default /
// l'ultimo valore noto da localStorage, così l'app continua a funzionare col comportamento storico.
export async function loadPeriodSettings(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('period_start, salary_income_id, anchor_day')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return
    setLocalPeriodSettings({
      periodStart: data.period_start ?? null,
      salaryIncomeId: data.salary_income_id ?? null,
      anchorDay: data.anchor_day ?? 15,
    })
  } catch {
    /* offline / tabella mancante: si resta sui default */
  }
}

// Aggiorna in modo OTTIMISTICO lo store locale (UI immediata) e poi fa l'upsert sul DB.
// Restituisce l'eventuale messaggio d'errore (es. tabella user_settings mancante) così la UI può
// mostrarlo e suggerire di eseguire la SQL.
export async function savePeriodSettings(
  userId: string,
  partial: Partial<PeriodSettings>,
): Promise<{ error: string | null }> {
  setLocalPeriodSettings(partial)
  const cur = getPeriodSettings()
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      period_start: cur.periodStart,
      salary_income_id: cur.salaryIncomeId,
      anchor_day: cur.anchorDay,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  return { error: error ? (error.message || 'Errore salvataggio impostazioni') : null }
}
