import type { Transaction } from '../types'
import { FUEL_CATEGORY } from './utils'

export interface FuelConsumption {
  kmPerLiter: number
  litersPer100Km: number
  costPerKm: number | null
}

// I km registrati su un rifornimento sono quelli percorsi col pieno PRECEDENTE.
// Quindi il consumo di quel pieno = km (transazione attuale) / litri (pieno precedente).
// `previousCost` è la spesa del pieno precedente, per ricavare gli €/km.
export function fuelConsumption(currentKm: number, previousLiters: number, previousCost?: number | null): FuelConsumption | null {
  if (!(currentKm > 0) || !(previousLiters > 0)) return null
  return {
    kmPerLiter: currentKm / previousLiters,
    litersPer100Km: (previousLiters / currentKm) * 100,
    costPerKm: previousCost != null && previousCost > 0 ? previousCost / currentKm : null,
  }
}

interface FuelRef {
  id: string
  date: string
  created_at: string
}

// Il rifornimento di benzina immediatamente precedente a `ref` (per data, poi created_at).
// Esclude le transazioni pianificate e `ref` stessa. Non richiede che abbia i litri:
// spetta al chiamante verificare `fuel_liters` prima di calcolare il consumo.
export function previousFuelFill(ref: FuelRef, all: Transaction[]): Transaction | null {
  let best: Transaction | null = null
  for (const t of all) {
    if (t.id === ref.id) continue
    if (t.category !== FUEL_CATEGORY) continue
    if (t.is_planned) continue
    const isBefore = t.date < ref.date || (t.date === ref.date && t.created_at < ref.created_at)
    if (!isBefore) continue
    if (!best || t.date > best.date || (t.date === best.date && t.created_at > best.created_at)) {
      best = t
    }
  }
  return best
}
