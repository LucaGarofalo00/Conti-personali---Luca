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
  // Giorno tipico atteso dello stipendio (1..28). Default 15 = ciclo storico 15→14.
  anchorDay: number
}

const DEFAULTS: PeriodSettings = { periodStart: null, salaryIncomeId: null, anchorDay: 15 }

function clampAnchor(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10)
  if (!Number.isFinite(v)) return 15
  return Math.min(28, Math.max(1, Math.trunc(v)))
}

function readInitial(): PeriodSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      periodStart: typeof parsed.periodStart === 'string' ? parsed.periodStart : null,
      salaryIncomeId: typeof parsed.salaryIncomeId === 'string' ? parsed.salaryIncomeId : null,
      anchorDay: clampAnchor(parsed.anchorDay),
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
    anchorDay: partial.anchorDay !== undefined ? clampAnchor(partial.anchorDay) : state.anchorDay,
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
