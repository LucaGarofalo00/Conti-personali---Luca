import { useSyncExternalStore } from 'react'

// Store globale (fuori da React) per le impostazioni del PERIODO, sul modello di privacy.ts:
// le funzioni di utils.ts (getBillingPeriod, ecc.) leggono questi valori in modo SINCRONO, così
// non serve passare props/contesto a ogni call-site. La verità è su Supabase (tabella
// user_settings), ma teniamo uno specchio in localStorage per avere subito l'ultimo valore noto
// al primo render, prima che la fetch dal DB completi.
//
// IMPORTANTE: questo modulo NON importa supabase (resta puro), così la catena di import di utils
// rimane leggera e testabile. Il caricamento/salvataggio sul DB vive in periodSettingsDb.ts.

const STORAGE_KEY = 'finanzapp:periodSettings'

export interface PeriodSettings {
  // Inizio del periodo corrente (giorno reale dell'ultimo stipendio). null → fallback su anchorDay.
  periodStart: string | null
  // Entrata ricorrente che definisce lo stipendio (per il rilevamento automatico).
  salaryIncomeId: string | null
  // Giorno ATTESO dello stipendio (1..28). Definisce la fine del periodo: il periodo finisce il
  // giorno PRIMA dell'anchor del mese successivo. DEVE coincidere col day_of_month dell'entrata
  // scelta come stipendio (vedi anchorFromSalaryIncome): è quella l'unica fonte di verità.
  anchorDay: number
}

const DEFAULTS: PeriodSettings = { periodStart: null, salaryIncomeId: null, anchorDay: 15 }

// Vincolo del DB: user_settings.anchor_day check (anchor_day between 1 and 28).
export function clampAnchorDay(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10)
  if (!Number.isFinite(v)) return 15
  return Math.min(28, Math.max(1, Math.trunc(v)))
}

// L'anchor NON è un numero libero: è il giorno ATTESO dello stipendio, cioè il day_of_month
// dell'entrata scelta come stipendio. Se i due divergono la fine del periodo (anchor − 1 del mese
// dopo) non è più "il giorno prima del prossimo stipendio" e il periodo può contenerne DUE:
// stipendio il 14 con anchor 15 → periodo 14 lug – 14 ago, che include ANCHE il 14 ago. Con
// anchor 14 → 14 lug – 13 ago, un solo stipendio (vedi computePeriod in utils.ts).
// Restituisce null se non c'è uno stipendio configurato o non è mensile: in quel caso l'anchor
// resta quello impostato a mano (periodo a giorno fisso).
export function anchorFromSalaryIncome(
  income: { frequency?: string | null; day_of_month?: number | null } | null | undefined,
): number | null {
  if (!income || income.frequency !== 'monthly' || income.day_of_month == null) return null
  return clampAnchorDay(income.day_of_month)
}

function readInitial(): PeriodSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      periodStart: typeof parsed.periodStart === 'string' ? parsed.periodStart : null,
      salaryIncomeId: typeof parsed.salaryIncomeId === 'string' ? parsed.salaryIncomeId : null,
      anchorDay: clampAnchorDay(parsed.anchorDay),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let state: PeriodSettings = readInitial()
const listeners = new Set<() => void>()

export function getPeriodSettings(): PeriodSettings {
  return state
}

export function getAnchorDay(): number {
  return state.anchorDay
}

export function getPeriodStartOverride(): string | null {
  return state.periodStart
}

export function getSalaryIncomeId(): string | null {
  return state.salaryIncomeId
}

// Aggiorna lo stato in memoria + lo specchio localStorage e notifica i sottoscrittori. NON tocca
// il DB (quello è compito di periodSettingsDb.savePeriodSettings). Usata sia dal salvataggio
// ottimistico sia dall'idratazione iniziale dal DB.
export function setLocalPeriodSettings(partial: Partial<PeriodSettings>): void {
  const next: PeriodSettings = {
    periodStart: partial.periodStart !== undefined ? partial.periodStart : state.periodStart,
    salaryIncomeId: partial.salaryIncomeId !== undefined ? partial.salaryIncomeId : state.salaryIncomeId,
    anchorDay: partial.anchorDay !== undefined ? clampAnchorDay(partial.anchorDay) : state.anchorDay,
  }
  if (next.periodStart === state.periodStart && next.salaryIncomeId === state.salaryIncomeId && next.anchorDay === state.anchorDay) {
    return
  }
  state = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* localStorage non disponibile */ }
  for (const l of listeners) l()
}

// Riporta lo store ai default e pulisce lo specchio localStorage. Va chiamata al LOGOUT, così un
// altro utente che accede sullo stesso browser non eredita periodStart/salaryIncomeId/anchorDay del
// precedente prima che l'idratazione dal DB completi (o se non ha ancora una riga user_settings).
export function resetPeriodSettings(): void {
  state = { ...DEFAULTS }
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* no-op */ }
  for (const l of listeners) l()
}

// Solo per i test: riporta lo stato ai default (senza toccare localStorage del browser reale).
export function __resetPeriodSettingsForTest(): void {
  resetPeriodSettings()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Hook di sottoscrizione: ogni componente che lo usa si ri-renderizza quando il periodo cambia
// (es. dopo l'idratazione dal DB o dopo la conferma del nuovo stipendio). Va chiamato in alto
// nell'albero (vedi AppRoutes) perché tutte le pagine rileggano getBillingPeriod() aggiornato.
export function usePeriodSettings(): PeriodSettings {
  return useSyncExternalStore(subscribe, getPeriodSettings, getPeriodSettings)
}
