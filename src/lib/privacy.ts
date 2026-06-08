import { useSyncExternalStore } from 'react'

// Store globale (fuori da React) per la privacy degli importi: un click maschera tutte le
// cifre in € dell'app. La funzione cur() in utils.ts legge questo flag in modo sincrono, così
// non serve passare props/contesto a ogni call-site. Il valore è persistito in localStorage.
const STORAGE_KEY = 'finanzapp:amountsHidden'

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let hidden = readInitial()
const listeners = new Set<() => void>()

export function isAmountsHidden(): boolean {
  return hidden
}

export function setAmountsHidden(value: boolean): void {
  if (hidden === value) return
  hidden = value
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0') } catch { /* localStorage non disponibile */ }
  for (const l of listeners) l()
}

export function toggleAmountsHidden(): void {
  setAmountsHidden(!hidden)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Hook di sottoscrizione: ogni componente che lo usa si ri-renderizza al toggle. Va chiamato
// abbastanza in alto nell'albero (vedi AppRoutes) perché l'intera UI rifletta lo stato.
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, isAmountsHidden, isAmountsHidden)
}
