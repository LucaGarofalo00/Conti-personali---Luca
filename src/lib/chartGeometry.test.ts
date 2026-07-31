import { describe, it, expect } from 'vitest'
import { niceTicks, monotonePath } from './chartGeometry'

// Il grafico della Dashboard non usa più Recharts ma un SVG disegnato a mano (AreaChartLite):
// la geometria è codice nostro e può sbagliare in silenzio, mostrando una curva plausibile ma
// falsa. Qui verifichiamo le due parti che portano il rischio: i tick dell'asse e la curva.

describe('niceTicks', () => {
  it('produce valori tondi dentro l\'intervallo richiesto', () => {
    const ticks = niceTicks(0, 1000, 4)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1000)
    // Passo costante: un asse a passo variabile si legge male e tradisce un errore di calcolo.
    const step = ticks[1] - ticks[0]
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6)
    }
  })

  it('usa passi della famiglia 1/2/5 × 10^n', () => {
    for (const [min, max] of [[0, 10], [0, 37], [0, 1000], [-500, 500], [1234, 98765]]) {
      const ticks = niceTicks(min, max, 4)
      const step = ticks[1] - ticks[0]
      const mag = Math.pow(10, Math.floor(Math.log10(step)))
      const norm = Math.round((step / mag) * 1e6) / 1e6
      expect([1, 2, 5, 10]).toContain(norm)
    }
  })

  it('gestisce saldi negativi (conto in rosso)', () => {
    const ticks = niceTicks(-820, -100, 4)
    expect(ticks[0]).toBeLessThanOrEqual(-820)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(-100)
  })

  it('non esplode con intervallo nullo o valori non finiti', () => {
    expect(niceTicks(500, 500, 4)).toEqual([500])
    expect(niceTicks(NaN, 10, 4)).toEqual([0])
    expect(niceTicks(0, Infinity, 4)).toEqual([0])
  })
})

describe('monotonePath', () => {
  it('parte dal primo punto e tocca ogni punto dei dati', () => {
    const pts = [{ x: 0, y: 100 }, { x: 50, y: 40 }, { x: 100, y: 80 }]
    const d = monotonePath(pts)
    expect(d.startsWith('M0,100')).toBe(true)
    // Ogni segmento cubico termina esattamente sul punto successivo: la curva non "manca" i dati.
    expect(d).toContain('50,40')
    expect(d).toContain('100,80')
  })

  it('resta dentro i valori dei dati su una serie crescente (nessun rimbalzo)', () => {
    // Fritsch–Carlson: su dati monotoni la curva non deve superare i valori reali, altrimenti il
    // grafico mostrerebbe un saldo mai raggiunto (o un rosso inesistente).
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 90 }, { x: 20, y: 20 }, { x: 30, y: 10 }]
    const d = monotonePath(pts)
    const coords = [...d.matchAll(/[-\d.]+,([-\d.]+)/g)].map(m => Number(m[1]))
    const min = Math.min(...pts.map(p => p.y))
    const max = Math.max(...pts.map(p => p.y))
    for (const y of coords) {
      expect(y).toBeGreaterThanOrEqual(min - 1e-9)
      expect(y).toBeLessThanOrEqual(max + 1e-9)
    }
  })

  it('appiattisce la tangente sui massimi e minimi locali', () => {
    // Punto di inversione: la tangente va azzerata, così la curva non oltrepassa il picco.
    const pts = [{ x: 0, y: 50 }, { x: 10, y: 10 }, { x: 20, y: 50 }]
    const d = monotonePath(pts)
    const ys = [...d.matchAll(/[-\d.]+,([-\d.]+)/g)].map(m => Number(m[1]))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(Math.max(...ys)).toBeLessThanOrEqual(50 + 1e-9)
  })

  it('gestisce i casi degeneri', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 5, y: 7 }])).toBe('M5,7')
    // Due punti sovrapposti in x: nessuna divisione per zero, nessun NaN nel path.
    expect(monotonePath([{ x: 0, y: 0 }, { x: 0, y: 10 }])).not.toContain('NaN')
  })
})
