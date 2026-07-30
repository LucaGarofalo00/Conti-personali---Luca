import { describe, it, expect } from 'vitest'
import { fuelConsumption, fuelTotalFromLiters, previousFuelFill, averageFuelConsumption, fuelStatsOdometer, lifetimeCostPerKmOdometer, lifetimePerFuelStima, previousOdometerFill } from './fuelConsumption'
import type { Transaction } from '../types'

function mkFuelTx(opts: {
  id: string
  date: string
  created_at?: string
  liters?: number | null
  km?: number | null
  odo?: number | null
  amount?: number
  category?: string
  is_planned?: boolean
  fuel_type?: 'benzina' | 'gpl' | null
}): Transaction {
  return {
    id: opts.id, user_id: 'u', type: 'expense', amount: opts.amount ?? 0,
    description: 'benzina', fund_id: null, fund_to_id: null,
    category: opts.category ?? 'benzina',
    budget_id: null, recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: opts.is_planned ?? false,
    fuel_km: opts.km ?? null, fuel_liters: opts.liters ?? null, fuel_price_per_liter: null,
    fuel_type: opts.fuel_type ?? null, fuel_odometer: opts.odo ?? null,
    date: opts.date, created_at: opts.created_at ?? opts.date,
  }
}

describe('fuelConsumption', () => {
  it('km attuali / litri precedenti = km/l', () => {
    const c = fuelConsumption(400, 30)
    expect(c).not.toBeNull()
    expect(c!.kmPerLiter).toBeCloseTo(13.333, 3)
    expect(c!.litersPer100Km).toBeCloseTo(7.5, 3)
    expect(c!.costPerKm).toBeNull()
  })

  it('ricava gli €/km dalla spesa del pieno precedente', () => {
    const c = fuelConsumption(400, 30, 45)
    expect(c!.costPerKm).toBeCloseTo(0.1125, 4)
  })

  it('senza km non calcola nulla', () => {
    expect(fuelConsumption(0, 30)).toBeNull()
  })

  it('senza litri precedenti non calcola nulla', () => {
    expect(fuelConsumption(400, 0)).toBeNull()
  })

  it('costo precedente nullo o zero → niente €/km', () => {
    expect(fuelConsumption(400, 30, 0)!.costPerKm).toBeNull()
    expect(fuelConsumption(400, 30, null)!.costPerKm).toBeNull()
  })
})

describe('previousFuelFill', () => {
  const t1 = mkFuelTx({ id: 't1', date: '2026-01-01', liters: 30, amount: 45 })
  const t2 = mkFuelTx({ id: 't2', date: '2026-01-15', liters: 32, amount: 50, km: 400 })
  const t3 = mkFuelTx({ id: 't3', date: '2026-02-01', liters: 28, amount: 44, km: 420 })

  it('trova il rifornimento immediatamente precedente per data', () => {
    expect(previousFuelFill(t3, [t1, t2, t3])?.id).toBe('t2')
    expect(previousFuelFill(t2, [t1, t2, t3])?.id).toBe('t1')
  })

  it('il primo rifornimento non ha precedente', () => {
    expect(previousFuelFill(t1, [t1, t2, t3])).toBeNull()
  })

  it('usa created_at come spareggio a parità di data', () => {
    const a = mkFuelTx({ id: 'a', date: '2026-03-01', created_at: '2026-03-01T08:00:00Z', liters: 20 })
    const b = mkFuelTx({ id: 'b', date: '2026-03-01', created_at: '2026-03-01T18:00:00Z', km: 300 })
    expect(previousFuelFill(b, [a, b])?.id).toBe('a')
  })

  it('ignora le transazioni pianificate', () => {
    const planned = mkFuelTx({ id: 'p', date: '2026-01-20', liters: 99, is_planned: true })
    expect(previousFuelFill(t3, [t1, t2, t3, planned])?.id).toBe('t2')
  })

  it('ignora le categorie diverse da benzina', () => {
    const other = mkFuelTx({ id: 'o', date: '2026-01-25', liters: 99, category: 'cibo' })
    expect(previousFuelFill(t3, [t1, t2, t3, other])?.id).toBe('t2')
  })

  it('restituisce il precedente anche senza litri (sarà il chiamante a verificarli)', () => {
    const noLiters = mkFuelTx({ id: 'nl', date: '2026-01-20', liters: null, km: 100 })
    expect(previousFuelFill(t3, [t1, t2, t3, noLiters])?.id).toBe('nl')
  })

  it('considera solo i rifornimenti dello stesso tipo', () => {
    const gpl1 = mkFuelTx({ id: 'g1', date: '2026-01-05', liters: 40, fuel_type: 'gpl' })
    const ben1 = mkFuelTx({ id: 'b1', date: '2026-01-10', liters: 30, fuel_type: 'benzina' })
    const gpl2 = mkFuelTx({ id: 'g2', date: '2026-01-20', km: 500, fuel_type: 'gpl' })
    // Per il pieno GPL il precedente è l'altro GPL, non la benzina più recente.
    expect(previousFuelFill(gpl2, [gpl1, ben1, gpl2])?.id).toBe('g1')
  })

  it('i rifornimenti senza tipo sono trattati come benzina', () => {
    const old = mkFuelTx({ id: 'o', date: '2026-01-05', liters: 30, fuel_type: null })
    const ben = mkFuelTx({ id: 'b', date: '2026-01-20', km: 400, fuel_type: 'benzina' })
    expect(previousFuelFill(ben, [old, ben])?.id).toBe('o')
  })
})

describe('averageFuelConsumption', () => {
  it('media = somma km / somma litri sui pieni consecutivi dello stesso tipo', () => {
    // benzina: f1(30L) -> f2(km300,32L) -> f3(km420)
    // coppie: 300/30 e 420/32 => kmSum=720, litriSum=62
    const f1 = mkFuelTx({ id: 'f1', date: '2026-01-01', liters: 30, amount: 45, fuel_type: 'benzina' })
    const f2 = mkFuelTx({ id: 'f2', date: '2026-01-15', liters: 32, km: 300, amount: 48, fuel_type: 'benzina' })
    const f3 = mkFuelTx({ id: 'f3', date: '2026-02-01', km: 420, fuel_type: 'benzina' })
    const avg = averageFuelConsumption([f1, f2, f3], 'benzina')
    expect(avg).not.toBeNull()
    expect(avg!.kmPerLiter).toBeCloseTo(720 / 62, 4)
    expect(avg!.litersPer100Km).toBeCloseTo((62 / 720) * 100, 4)
    expect(avg!.costPerKm).toBeCloseTo((45 + 48) / 720, 4)
  })

  it('separa i tipi: la media GPL ignora i pieni di benzina', () => {
    const ben = mkFuelTx({ id: 'b1', date: '2026-01-01', liters: 30, km: 999, fuel_type: 'benzina' })
    const gpl1 = mkFuelTx({ id: 'g1', date: '2026-01-05', liters: 40, amount: 30, fuel_type: 'gpl' })
    const gpl2 = mkFuelTx({ id: 'g2', date: '2026-01-20', km: 360, fuel_type: 'gpl' })
    const avg = averageFuelConsumption([ben, gpl1, gpl2], 'gpl')
    expect(avg!.kmPerLiter).toBeCloseTo(360 / 40, 4)
  })

  it('senza almeno due pieni utilizzabili restituisce null', () => {
    const f1 = mkFuelTx({ id: 'f1', date: '2026-01-01', liters: 30, fuel_type: 'gpl' })
    expect(averageFuelConsumption([f1], 'gpl')).toBeNull()
  })

  it('costPerKm null se manca il costo di un pieno precedente', () => {
    const f1 = mkFuelTx({ id: 'f1', date: '2026-01-01', liters: 30, amount: 0, fuel_type: 'benzina' })
    const f2 = mkFuelTx({ id: 'f2', date: '2026-01-15', km: 300, fuel_type: 'benzina' })
    const avg = averageFuelConsumption([f1, f2], 'benzina')
    expect(avg!.costPerKm).toBeNull()
  })
})

// Scenario bifuel col contachilometri:
//  GPL @100000 (40 L, 30€) -> benzina @100250 (15 L, 20€) -> GPL @100600 (38 L, 28€)
const g1 = mkFuelTx({ id: 'g1', date: '2026-01-01', odo: 100000, liters: 40, amount: 30, fuel_type: 'gpl' })
const b1 = mkFuelTx({ id: 'b1', date: '2026-01-08', odo: 100250, liters: 15, amount: 20, fuel_type: 'benzina' })
const g2 = mkFuelTx({ id: 'g2', date: '2026-01-15', odo: 100600, liters: 38, amount: 28, fuel_type: 'gpl' })
const ALL = [g1, b1, g2]

describe('previousOdometerFill', () => {
  it('precedente qualsiasi carburante = lettura più alta sotto quella di ref', () => {
    expect(previousOdometerFill(g2, ALL, false)?.id).toBe('b1')
  })
  it('precedente stesso tipo salta gli altri carburanti', () => {
    expect(previousOdometerFill(g2, ALL, true)?.id).toBe('g1')
  })
  it('senza contachilometri su ref restituisce null', () => {
    const noOdo = mkFuelTx({ id: 'x', date: '2026-02-01', fuel_type: 'gpl' })
    expect(previousOdometerFill(noOdo, ALL, false)).toBeNull()
  })
})

describe('fuelStatsOdometer', () => {
  it('€/km reale dal pieno precedente (qualsiasi carburante)', () => {
    const s = fuelStatsOdometer(g2, ALL)!
    // benzina@100250 (20€) ha portato 100250->100600 = 350 km
    expect(s.costPerKm).toBeCloseTo(20 / 350, 5)
  })
  it('km/l per carburante = STIMA su km da contachilometri (sovrastima)', () => {
    const s = fuelStatsOdometer(g2, ALL)!
    // GPL: 100600-100000 = 600 km / 40 L (pieno GPL precedente)
    expect(s.kmPerLiter).toBeCloseTo(15, 5)
    expect(s.litersPer100Km).toBeCloseTo((40 / 600) * 100, 5)
  })
  it('senza contachilometri restituisce null', () => {
    expect(fuelStatsOdometer(mkFuelTx({ id: 'z', date: '2026-01-20', fuel_type: 'gpl' }), ALL)).toBeNull()
  })
})

describe('lifetimeCostPerKmOdometer', () => {
  it('€/km accurato su tutto lo storico (qualsiasi carburante)', () => {
    // coppie: 100000->100250 (30€,250km), 100250->100600 (20€,350km) => 50€/600km
    expect(lifetimeCostPerKmOdometer(ALL)).toBeCloseTo(50 / 600, 5)
  })
  it('null se meno di due rifornimenti col contachilometri', () => {
    expect(lifetimeCostPerKmOdometer([g1])).toBeNull()
  })
})

describe('lifetimePerFuelStima', () => {
  it('stima media km/l per carburante su km da contachilometri', () => {
    // GPL: 100000->100600 = 600 km / 40 L
    expect(lifetimePerFuelStima(ALL, 'gpl')!.kmPerLiter).toBeCloseTo(15, 5)
  })
  it('null con un solo pieno di quel tipo', () => {
    expect(lifetimePerFuelStima(ALL, 'benzina')).toBeNull()
  })
})

describe('fuelTotalFromLiters', () => {
  it('calcola litri × €/litro arrotondando al centesimo', () => {
    // Caso reale: 42,28 L × 0,686 €/L = 29,00408 → 29,00
    expect(fuelTotalFromLiters(42.28, 0.686)).toBe(29)
    expect(fuelTotalFromLiters(41.26, 0.686)).toBe(28.3)
    expect(fuelTotalFromLiters(40.78, 0.689)).toBe(28.1)
  })

  it('arrotonda per eccesso oltre il mezzo centesimo', () => {
    expect(fuelTotalFromLiters(10, 1.555)).toBe(15.55)
    expect(fuelTotalFromLiters(10, 1.556)).toBe(15.56)
  })

  it('gestisce la benzina a prezzo pieno', () => {
    expect(fuelTotalFromLiters(30, 1.8)).toBe(54)
  })

  it('null se manca uno dei due valori', () => {
    expect(fuelTotalFromLiters(0, 1.8)).toBeNull()
    expect(fuelTotalFromLiters(30, 0)).toBeNull()
    expect(fuelTotalFromLiters(0, 0)).toBeNull()
  })

  it('null su valori non validi invece di produrre NaN', () => {
    expect(fuelTotalFromLiters(NaN, 1.8)).toBeNull()
    expect(fuelTotalFromLiters(30, NaN)).toBeNull()
    expect(fuelTotalFromLiters(-5, 1.8)).toBeNull()
    expect(fuelTotalFromLiters(30, -1)).toBeNull()
  })
})
