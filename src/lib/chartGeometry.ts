// Geometria del grafico ad area disegnato a mano (components/AreaChartLite.tsx), che sulla
// Dashboard sostituisce Recharts. Sta qui, fra la logica pura, per lo stesso motivo di
// periodBreakdown & co.: è codice che può sbagliare in silenzio, quindi va testato in isolamento
// (vedi areaChartLite.test.ts) e non deve stare in un file di componente.

/** Tick "tondi" (1/2/5 × 10^n) che coprono l'intervallo: un asse con 1234,5678 non si legge. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [min]
  const rawStep = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)))
  const norm = rawStep / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/**
 * Path SVG di una curva morbida che passa per tutti i punti.
 * Tangenti di Fritsch–Carlson: la curva NON supera i valori reali, quindi non disegna un saldo mai
 * raggiunto né un rosso inesistente fra due punti. È lo stesso criterio del type="monotone".
 */
export function monotonePath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx: number[] = [], slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]
  }
  const m: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
    }
  }
  m[n - 1] = slope[n - 2]
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3
    d += `C${pts[i].x + c},${pts[i].y + m[i] * c} ${pts[i + 1].x - c},${pts[i + 1].y - m[i + 1] * c} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}
