import { supabase } from './supabase'
import { setLocalPeriodSettings, getPeriodSettings, anchorFromSalaryIncome, type PeriodSettings } from './periodSettings'

// Caricamento/salvataggio su Supabase delle impostazioni del periodo. Separato da periodSettings.ts
// (che resta puro) per non trascinare supabase nella catena di import di utils.

// Giorno ATTESO dello stipendio, letto dall'entrata scelta come stipendio. È questo — non un numero
// digitato a mano — a definire l'anchor, cioè la fine del periodo. Vedi anchorFromSalaryIncome:
// se anchor e day_of_month divergono, il periodo può contenere DUE stipendi.
// null → nessuno stipendio configurato / non mensile / query fallita: si tiene l'anchor esistente.
async function fetchAnchorFromSalary(salaryIncomeId: string | null): Promise<number | null> {
  if (!salaryIncomeId) return null
  const { data, error } = await supabase
    .from('recurring_income')
    .select('frequency, day_of_month')
    .eq('id', salaryIncomeId)
    .maybeSingle()
  if (error || !data) return null
  return anchorFromSalaryIncome(data)
}

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
    // Distinguere i due casi: `error` (rete/tabella mancante) → conserva l'ultimo valore noto;
    // `!data` (utente SENZA riga, es. nuovo account sullo stesso browser) → reset ai DEFAULT, così
    // non si ereditano periodStart/salaryIncomeId/anchorDay rimasti in localStorage da un altro utente.
    if (error) return
    if (!data) {
      setLocalPeriodSettings({ periodStart: null, salaryIncomeId: null, anchorDay: 15 })
      return
    }
    const salaryId = data.salary_income_id ?? null
    const stored = data.anchor_day ?? 15
    // AUTO-CORREZIONE: l'anchor deve seguire il giorno dello stipendio. Sui DB esistenti può essere
    // rimasto un valore divergente (tipicamente il default 15 con stipendio il 14), che allunga il
    // periodo fino a inglobare lo stipendio successivo. Lo ri-derivo qui e riallineo il DB una volta
    // sola: le installazioni già in uso si sistemano al primo avvio, senza passare da Impostazioni.
    const derived = await fetchAnchorFromSalary(salaryId)
    setLocalPeriodSettings({
      periodStart: data.period_start ?? null,
      salaryIncomeId: salaryId,
      anchorDay: derived ?? stored,
    })
    if (derived !== null && derived !== stored) {
      await supabase
        .from('user_settings')
        .update({ anchor_day: derived, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    }
  } catch {
    /* offline / tabella mancante: si resta sui default */
  }
}

// Aggiorna in modo OTTIMISTICO lo store locale (UI immediata) e poi fa l'upsert sul DB.
// Restituisce l'eventuale messaggio d'errore (es. tabella user_settings mancante) così la UI può
// mostrarlo e suggerire di eseguire la SQL.
// Se il chiamante NON passa un anchorDay esplicito, viene derivato dallo stipendio configurato:
// così il "nuovo periodo" confermato dalla dashboard (che passa solo periodStart) e il salvataggio
// da Impostazioni restano sempre coerenti col giorno atteso dello stipendio.
export async function savePeriodSettings(
  userId: string,
  partial: Partial<PeriodSettings>,
): Promise<{ error: string | null }> {
  const next: Partial<PeriodSettings> = { ...partial }
  if (next.anchorDay === undefined) {
    const salaryId = next.salaryIncomeId !== undefined ? next.salaryIncomeId : getPeriodSettings().salaryIncomeId
    const derived = await fetchAnchorFromSalary(salaryId)
    if (derived !== null) next.anchorDay = derived
  }
  setLocalPeriodSettings(next)
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
