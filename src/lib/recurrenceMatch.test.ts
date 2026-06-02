import { describe, it, expect } from 'vitest'
import { inSameRecurrenceWindow } from './recurrenceMatch'

describe('inSameRecurrenceWindow', () => {
  it('weekly: stesso lunedì→domenica → true (giovedì 28 vs sabato 30 mag 2026)', () => {
    expect(inSameRecurrenceWindow('2026-05-30', '2026-05-28', 'weekly')).toBe(true)
  })

  it('weekly: settimane diverse → false (giovedì 28 mag vs giovedì 4 giu)', () => {
    expect(inSameRecurrenceWindow('2026-06-04', '2026-05-28', 'weekly')).toBe(false)
  })

  it('weekly: il confine domenica/lunedì separa le settimane', () => {
    // dom 31 mag (sett. 25-31) vs lun 1 giu (sett. 1-7)
    expect(inSameRecurrenceWindow('2026-06-01', '2026-05-31', 'weekly')).toBe(false)
  })

  it('monthly: stesso mese → true anche con giorni diversi (29 vs 30 mag)', () => {
    expect(inSameRecurrenceWindow('2026-05-30', '2026-05-29', 'monthly')).toBe(true)
  })

  it('monthly: mesi diversi → false (1 giu vs 29 mag)', () => {
    expect(inSameRecurrenceWindow('2026-06-01', '2026-05-29', 'monthly')).toBe(false)
  })

  it('yearly: stesso mese e anno → true, mese diverso → false', () => {
    expect(inSameRecurrenceWindow('2026-03-10', '2026-03-01', 'yearly')).toBe(true)
    expect(inSameRecurrenceWindow('2026-04-01', '2026-03-01', 'yearly')).toBe(false)
  })
})
