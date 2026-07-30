import type { Transaction } from '../types'
import { FUEL_CATEGORY, round2 } from './utils'

export type FuelType = 'benzina' | 'gpl'

// Importo del rifornimento derivato da litri × €/litro, arrotondato al centesimo (il prezzo al
// litro ha 3 decimali, quindi il prodotto grezzo ne avrebbe 4: 42,28 × 0,686 = 29,00408).
// null quando manca uno dei due valori: non c'è nulla da calcolare e l'importo digitato a mano
// non va toccato.
export function fuelTotalFromLiters(liters: number, pricePerLiter: number): number | null {
  if (!(liters > 0) || !(pricePerLiter > 0)) return null
  return round2(liters * pricePerLiter)
}

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

// ============================================================================
// Modello a CONTACHILOMETRI (per auto bifuel benzina/GPL)
// ----------------------------------------------------------------------------
// Con la lettura assoluta del contachilometri, i km tra due rifornimenti = differenza delle
// letture, INDIPENDENTEMENTE dal carburante usato in mezzo. Questo dà €/km ACCURATI.
// Il km/l per singolo carburante resta una STIMA: i km tra due pieni dello stesso tipo includono
// anche i km percorsi con l'altro carburante (avvio a freddo a benzina, GPL esaurito, ecc.).
// ============================================================================

interface OdoRef {
  id: string
  date: string
  created_at: string
  fuel_type?: string | null
  fuel_odometer?: number | null
}

// Rifornimento (col contachilometri) immediatamente precedente a `ref`: quello con la lettura più
// alta ma ancora inferiore a quella di `ref`. sameTypeOnly=true → solo stesso carburante (stima
// km/l); false → qualsiasi carburante (€/km reale).
export function previousOdometerFill(ref: OdoRef, all: Transaction[], sameTypeOnly: boolean): Transaction | null {
  const refType = normalizeFuelType(ref.fuel_type)
  const refOdo = ref.fuel_odometer
  if (refOdo == null) return null
  let best: Transaction | null = null
  for (const t of all) {
    if (t.id === ref.id) continue
    if (t.category !== FUEL_CATEGORY) continue
    if (t.is_planned) continue
    if (t.fuel_odometer == null) continue
    if (sameTypeOnly && normalizeFuelType(t.fuel_type) !== refType) continue
    if (Number(t.fuel_odometer) >= Number(refOdo)) continue
    if (!best || Number(t.fuel_odometer) > Number(best.fuel_odometer)) best = t
  }
  return best
}

export interface OdoStats {
  costPerKm: number | null       // ACCURATO (qualsiasi carburante)
  kmPerLiter: number | null      // STIMA (per carburante)
  litersPer100Km: number | null  // STIMA (per carburante)
}

// Statistiche di un rifornimento basate sul contachilometri. `current` può essere un rifornimento
// reale o uno "prospettico" mentre lo si compila (id vuoto).
export function fuelStatsOdometer(current: OdoRef, all: Transaction[]): OdoStats | null {
  if (current.fuel_odometer == null) return null
  const curOdo = Number(current.fuel_odometer)

  // €/km reale: la spesa del pieno PRECEDENTE (qualsiasi carburante) ha portato i km fino a ora.
  let costPerKm: number | null = null
  const prevAny = previousOdometerFill(current, all, false)
  if (prevAny && prevAny.fuel_odometer != null) {
    const km = curOdo - Number(prevAny.fuel_odometer)
    const cost = Number(prevAny.amount)
    if (km > 0 && cost > 0) costPerKm = cost / km
  }

  // STIMA km/l per carburante: km da contachilometri (tra due pieni dello stesso tipo) / litri del
  // pieno precedente. Sovrastima l'efficienza perché i km includono l'altro carburante.
  let kmPerLiter: number | null = null
  let litersPer100Km: number | null = null
  const prevSame = previousOdometerFill(current, all, true)
  if (prevSame && prevSame.fuel_odometer != null && prevSame.fuel_liters != null) {
    const km = curOdo - Number(prevSame.fuel_odometer)
    const liters = Number(prevSame.fuel_liters)
    if (km > 0 && liters > 0) { kmPerLiter = km / liters; litersPer100Km = (liters / km) * 100 }
  }

  if (costPerKm == null && kmPerLiter == null) return null
  return { costPerKm, kmPerLiter, litersPer100Km }
}

// €/km medio ACCURATO su tutto lo storico col contachilometri (qualsiasi carburante).
export function lifetimeCostPerKmOdometer(all: Transaction[]): number | null {
  const fills = all
    .filter(t => t.category === FUEL_CATEGORY && !t.is_planned && t.fuel_odometer != null)
    .sort((a, b) => Number(a.fuel_odometer) - Number(b.fuel_odometer))
  let kmSum = 0
  let costSum = 0
  for (let i = 1; i < fills.length; i++) {
    const km = Number(fills[i].fuel_odometer) - Number(fills[i - 1].fuel_odometer)
    const cost = Number(fills[i - 1].amount) // la spesa del pieno precedente ha portato questi km
    if (km > 0 && cost > 0) { kmSum += km; costSum += cost }
  }
  return kmSum > 0 && costSum > 0 ? costSum / kmSum : null
}

// STIMA km/l media per carburante su tutto lo storico col contachilometri.
export function lifetimePerFuelStima(all: Transaction[], fuelType: FuelType): FuelConsumption | null {
  const fills = all
    .filter(t => t.category === FUEL_CATEGORY && !t.is_planned && t.fuel_odometer != null && normalizeFuelType(t.fuel_type) === fuelType)
    .sort((a, b) => Number(a.fuel_odometer) - Number(b.fuel_odometer))
  let kmSum = 0
  let litersSum = 0
  for (let i = 1; i < fills.length; i++) {
    const km = Number(fills[i].fuel_odometer) - Number(fills[i - 1].fuel_odometer)
    const liters = Number(fills[i - 1].fuel_liters)
    if (km > 0 && liters > 0) { kmSum += km; litersSum += liters }
  }
  if (!(kmSum > 0) || !(litersSum > 0)) return null
  return { kmPerLiter: kmSum / litersSum, litersPer100Km: (litersSum / kmSum) * 100, costPerKm: null }
}
