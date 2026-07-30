import { describe, it, expect } from 'vitest'
import { DUE_SOON_DAYS, daysBetween, dueBadgeText, dueStatusOf } from './dueStatus'

const TODAY = '2026-07-30'

describe('daysBetween', () => {
  it('conta i giorni di calendario, non le ore', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0)
    expect(daysBetween(TODAY, '2026-07-31')).toBe(1)
    expect(daysBetween(TODAY, '2026-07-29')).toBe(-1)
  })

  it('attraversa i confini di mese e di anno', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1)
  })

  it('non slitta di un giorno al cambio di ora legale', () => {
    // In Europa/Rome il 29 marzo 2026 scatta l'ora legale: il delta in ms tra le due mezzanotti
    // locali è 23h, che troncato darebbe 0 giorni. L'arrotondamento lo tiene a 1.
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1)
    expect(daysBetween('2026-03-29', '2026-03-30')).toBe(1)
    // Ritorno all'ora solare: 25h fra le due mezzanotti.
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1)
    expect(daysBetween('2026-10-25', '2026-10-26')).toBe(1)
  })

  it('accetta timestamp completi usando solo la parte data', () => {
    expect(daysBetween(TODAY, '2026-07-31T23:59:59Z')).toBe(1)
  })
})

describe('dueStatusOf', () => {
  it('marca come scaduta ogni data precedente a oggi', () => {
    expect(dueStatusOf('2026-07-29', TODAY)).toBe('overdue')
    expect(dueStatusOf('2026-07-01', TODAY)).toBe('overdue')
  })

  it('oggi non è mai scaduto', () => {
    expect(dueStatusOf(TODAY, TODAY)).toBe('today')
  })

  it('evidenzia le scadenze entro la soglia', () => {
    expect(dueStatusOf('2026-07-31', TODAY)).toBe('soon')
    expect(dueStatusOf('2026-08-02', TODAY)).toBe('soon') // esattamente DUE_SOON_DAYS
  })

  it('oltre la soglia resta neutra', () => {
    expect(dueStatusOf('2026-08-03', TODAY)).toBe('upcoming')
    expect(dueStatusOf('2026-09-15', TODAY)).toBe('upcoming')
  })

  it('la soglia è coerente con DUE_SOON_DAYS', () => {
    const dentro = new Date(2026, 6, 30 + DUE_SOON_DAYS)
    const fuori = new Date(2026, 6, 30 + DUE_SOON_DAYS + 1)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(dueStatusOf(fmt(dentro), TODAY)).toBe('soon')
    expect(dueStatusOf(fmt(fuori), TODAY)).toBe('upcoming')
  })

  it('senza data prevista resta neutra (nessun falso "scaduto")', () => {
    expect(dueStatusOf(undefined, TODAY)).toBe('upcoming')
    expect(dueStatusOf(null, TODAY)).toBe('upcoming')
    expect(dueStatusOf('', TODAY)).toBe('upcoming')
  })
})

describe('dueBadgeText', () => {
  it('usa il singolare per ieri', () => {
    expect(dueBadgeText('overdue', '2026-07-29', TODAY)).toBe('Scaduto ieri')
  })

  it('conta i giorni di ritardo', () => {
    expect(dueBadgeText('overdue', '2026-07-28', TODAY)).toBe('Scaduto da 2 giorni')
    expect(dueBadgeText('overdue', '2026-07-15', TODAY)).toBe('Scaduto da 15 giorni')
  })

  it('etichetta oggi e domani', () => {
    expect(dueBadgeText('today', TODAY, TODAY)).toBe('Scade oggi')
    expect(dueBadgeText('soon', '2026-07-31', TODAY)).toBe('Scade domani')
  })

  it('conta i giorni mancanti oltre domani', () => {
    expect(dueBadgeText('soon', '2026-08-01', TODAY)).toBe('Scade tra 2 giorni')
    expect(dueBadgeText('soon', '2026-08-02', TODAY)).toBe('Scade tra 3 giorni')
  })

  it('nessun badge per le voci lontane o senza data', () => {
    expect(dueBadgeText('upcoming', '2026-09-01', TODAY)).toBeNull()
    expect(dueBadgeText('overdue', undefined, TODAY)).toBeNull()
    expect(dueBadgeText('today', null, TODAY)).toBeNull()
  })

  it('è coerente con lo stato calcolato per tutta la finestra utile', () => {
    // Da 10 giorni fa a 10 giorni avanti: ogni giorno deve produrre uno stato e un badge coerenti.
    for (let offset = -10; offset <= 10; offset++) {
      const d = new Date(2026, 6, 30 + offset)
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const status = dueStatusOf(s, TODAY)
      const badge = dueBadgeText(status, s, TODAY)
      if (offset < 0) {
        expect(status).toBe('overdue')
        expect(badge).toMatch(/^Scaduto/)
      } else if (offset === 0) {
        expect(status).toBe('today')
        expect(badge).toBe('Scade oggi')
      } else if (offset <= DUE_SOON_DAYS) {
        expect(status).toBe('soon')
        expect(badge).toMatch(/^Scade (domani|tra \d+ giorni)$/)
      } else {
        expect(status).toBe('upcoming')
        expect(badge).toBeNull()
      }
    }
  })
})
