import { describe, it, expect } from 'vitest'
import { fuelConsumption, previousFuelFill } from './fuelConsumption'
import type { Transaction } from '../types'

function mkFuelTx(opts: {
  id: string
  date: string
  created_at?: string
  liters?: number | null
  km?: number | null
  amount?: number
  category?: string
  is_planned?: boolean
}): Transaction {
  return {
    id: opts.id, user_id: 'u', type: 'expense', amount: opts.amount ?? 0,
    description: 'benzina', fund_id: null, fund_to_id: null,
    category: opts.category ?? 'benzina',
    budget_id: null, recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: opts.is_planned ?? false,
    fuel_km: opts.km ?? null, fuel_liters: opts.liters ?? null, fuel_price_per_liter: null,
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
})
