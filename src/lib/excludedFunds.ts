import { useEffect, useState } from 'react'

const STORAGE_KEY = 'finanzapp:excludedFundIds'
const EVENT_NAME = 'finanzapp:excludedFundIdsChanged'

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function useExcludedFunds(): [string[], (next: string[]) => void, (id: string) => void] {
  const [ids, setIds] = useState<string[]>(read)

  useEffect(() => {
    const handler = () => setIds(read())
    window.addEventListener(EVENT_NAME, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(EVENT_NAME, handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const update = (next: string[]) => {
    const unique = Array.from(new Set(next))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unique))
    } catch {
      // storage pieno o modalità privata: l'esclusione resta comunque valida per la sessione
    }
    setIds(unique)
    window.dispatchEvent(new Event(EVENT_NAME))
  }

  const toggle = (id: string) => {
    const current = read()
    update(current.includes(id) ? current.filter(x => x !== id) : [...current, id])
  }

  return [ids, update, toggle]
}
