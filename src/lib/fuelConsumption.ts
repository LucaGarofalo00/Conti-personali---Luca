import type { Transaction } from '../types'
import { FUEL_CATEGORY } from './utils'

export type FuelType = 'benzina' | 'gpl'

export interface FuelConsumption {
  kmPerLiter: number
  litersPer100Km: number
  costPerKm: number | null
}

// I rifornimenti vecchi non hanno il tipo: li trattiamo come benzina.
export function normalizeFuelType(t: string | null | undefined): FuelType {
  return t === 'gpl' ? 'gpl' : 'benzina'
}

export const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  benzina: 'Benzina',
  gpl: 'GPL',
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
  fuel_type?: string | null
}

// Il rifornimento dello STESSO tipo immediatamente precedente a `ref` (per data, poi created_at).
// Esclude le transazioni pianificate e `ref` stessa. Non richiede che abbia i litri:
// spetta al chiamante verificare `fuel_liters` prima di calcolare il consumo.
export function previousFuelFill(ref: FuelRef, all: Transaction[]): Transaction | null {
  const refType = normalizeFuelType(ref.fuel_type)
  let best: Transaction | null = null
  for (const t of all) {
    if (t.id === ref.id) continue
    if (t.category !== FUEL_CATEGORY) continue
    if (t.is_planned) continue
    if (normalizeFuelType(t.fuel_type) !== refType) continue
    const isBefore = t.date < ref.date || (t.date === ref.date && t.created_at < ref.created_at)
    if (!isBefore) continue
    if (!best || t.date > best.date || (t.date === best.date && t.created_at > best.created_at)) {
      best = t
    }
  }
  return best
}

// Consumo medio "lifetime" per un tipo di carburante.
// Su ogni coppia di pieni consecutivi dello stesso tipo, i km del pieno successivo
// sono stati percorsi coi litri del pieno precedente. La media è quindi
// (somma km) / (somma litri) su tutte le coppie utilizzabili.
export function averageFuelConsumption(all: Transaction[], fuelType: FuelType): FuelConsumption | null {
  const fills = all
    .filter(t => t.category === FUEL_CATEGORY && !t.is_planned && normalizeFuelType(t.fuel_type) === fuelType)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1
        : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    )

  let kmSum = 0
  let litersSum = 0
  let costSum = 0
  // Km percorsi solo sulle coppie che HANNO un costo: così una singola coppia senza costo non
  // azzera del tutto l'€/km, ma lo calcola sulle coppie valide.
  let kmSumWithCost = 0
  for (let i = 1; i < fills.length; i++) {
    const km = Number(fills[i].fuel_km)
    const liters = Number(fills[i - 1].fuel_liters)
    if (!(km > 0) || !(liters > 0)) continue
    kmSum += km
    litersSum += liters
    const prevCost = Number(fills[i - 1].amount)
    if (prevCost > 0) { costSum += prevCost; kmSumWithCost += km }
  }

  if (!(kmSum > 0) || !(litersSum > 0)) return null
  return {
    kmPerLiter: kmSum / litersSum,
    litersPer100Km: (litersSum / kmSum) * 100,
    costPerKm: kmSumWithCost > 0 && costSum > 0 ? costSum / kmSumWithCost : null,
  }
}
