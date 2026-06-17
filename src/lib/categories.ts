import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { EXPENSE_CATEGORIES, TRANSACTION_CATEGORIES } from './utils'

// Store globale (fuori da React) delle categorie personalizzate dell'utente, sul modello di
// privacy.ts. Caricato pigramente al primo uso e condiviso da tutti i menu a tendina. Degrada con
// grazia: se la tabella non esiste (supabase-categories.sql non eseguito), la lista resta vuota e
// l'app mostra solo le categorie predefinite.

let custom: string[] = []
let loaded = false
let loading = false
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

const tableMissing = (msg?: string | null) => !!msg && /does not exist|schema cache|find the table/i.test(msg)

export function getCustomCategories(): string[] {
  return custom
}

export async function loadCustomCategories(): Promise<void> {
  if (loading) return
  loading = true
  const { data, error } = await supabase.from('custom_categories').select('name').order('name')
  loading = false
  loaded = true
  if (error) {
    if (!tableMissing(error.message)) console.error('Errore categorie:', error.message)
    return
  }
  custom = (data || []).map((r: { name: string }) => r.name)
  emit()
}

export async function addCustomCategory(userId: string, nameRaw: string): Promise<{ ok: boolean; error?: string }> {
  const name = nameRaw.trim().toLowerCase()
  if (!name) return { ok: false, error: 'Inserisci un nome' }
  if (name.length > 30) return { ok: false, error: 'Nome troppo lungo (max 30)' }
  const exists = new Set([...EXPENSE_CATEGORIES, ...TRANSACTION_CATEGORIES, ...custom])
  if (exists.has(name)) return { ok: false, error: 'Categoria già esistente' }
  const { error } = await supabase.from('custom_categories').insert({ user_id: userId, name })
  if (error) return { ok: false, error: tableMissing(error.message) ? 'Esegui supabase-categories.sql su Supabase' : error.message }
  custom = [...custom, name].sort()
  emit()
  return { ok: true }
}

export async function removeCustomCategory(name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('custom_categories').delete().eq('name', name)
  if (error) return { ok: false, error: error.message }
  custom = custom.filter(c => c !== name)
  emit()
  return { ok: true }
}

function subscribe(listener: () => void): () => void {
  if (!loaded && !loading) void loadCustomCategories()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useCustomCategories(): string[] {
  return useSyncExternalStore(subscribe, getCustomCategories, getCustomCategories)
}

// Default + personalizzate, senza duplicati, mantenendo l'ordine dei default in testa.
export function mergeCategories(base: string[], customList: string[]): string[] {
  const seen = new Set(base)
  return [...base, ...customList.filter(c => !seen.has(c))]
}
