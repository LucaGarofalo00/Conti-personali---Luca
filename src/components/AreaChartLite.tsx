import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { monotonePath, niceTicks } from '../lib/chartGeometry'

// Grafico ad area senza dipendenze: sostituisce Recharts sulla Dashboard.
// Recharts porta ~92 KB gzip di JS (chunk CartesianChart) e la Dashboard è la pagina d'ingresso:
// su mobile quel download ritarda il primo contenuto utile per un solo grafico. Qui disegniamo
// direttamente l'SVG (~3 KB) mantenendo curva monotona, assi, gradiente e tooltip al tocco.
// Le pagine Previsione e Statistiche continuano a usare Recharts: grafici più ricchi, visitati meno.

export interface AreaPoint {
  label: string
  value: number
}

interface Props {
  data: AreaPoint[]
  height?: number
  /** Formattazione delle etichette dell'asse Y (es. €1,2k). */
  formatY: (v: number) => string
  /** Contenuto del tooltip per il punto selezionato. */
  renderTooltip: (index: number) => ReactNode
  color?: string
  /** Descrizione per screen reader: il grafico è un'immagine, il testo alternativo è l'unico accesso. */
  ariaLabel: string
}

const PAD_LEFT = 46
const PAD_RIGHT = 8
const PAD_TOP = 10
const PAD_BOTTOM = 22
const Y_TICKS = 4
// Distanza minima fra due etichette dell'asse X, altrimenti si sovrappongono su schermi stretti.
const X_LABEL_MIN_GAP = 64

// Larghezza reale del contenitore: equivalente minimo di ResponsiveContainer. Al primo render è 0
// (non disegniamo nulla), poi ResizeObserver fornisce la misura e il grafico appare.
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export default function AreaChartLite({ data, height = 250, formatY, renderTooltip, color = '#3B82F6', ariaLabel }: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  // id univoco per il gradiente: due grafici nella stessa pagina non devono collidere.
  const gradId = useId()

  const geom = useMemo(() => {
    if (width <= 0 || data.length === 0) return null
    const innerW = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
    const innerH = Math.max(1, height - PAD_TOP - PAD_BOTTOM)
    const values = data.map(d => d.value)
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    // Margine dell'8%: la curva non tocca i bordi. Se tutti i valori sono uguali si apre comunque
    // una banda, altrimenti la linea finirebbe schiacciata sul bordo.
    const span = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.1, 1)
    const ticks = niceTicks(rawMin - span * 0.08, rawMax + span * 0.08, Y_TICKS)
    const lo = Math.min(rawMin - span * 0.08, ticks[0])
    const hi = Math.max(rawMax + span * 0.08, ticks[ticks.length - 1])
    const scaleX = (i: number) => PAD_LEFT + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1))
    const scaleY = (v: number) => PAD_TOP + innerH - ((v - lo) / (hi - lo || 1)) * innerH
    const pts = data.map((d, i) => ({ x: scaleX(i), y: scaleY(d.value) }))
    const line = monotonePath(pts)
    const baseline = PAD_TOP + innerH
    const area = `${line}L${pts[pts.length - 1].x},${baseline}L${pts[0].x},${baseline}Z`

    // Etichette X: prima e ultima sempre, le intermedie solo se c'è spazio (come preserveStartEnd).
    const xLabels: Array<{ i: number; x: number; anchor: 'start' | 'middle' | 'end' }> = []
    let lastX = -Infinity
    for (let i = 0; i < data.length; i++) {
      const x = scaleX(i)
      const isLast = i === data.length - 1
      if (i === 0 || isLast || x - lastX >= X_LABEL_MIN_GAP) {
        // L'ultima ha la precedenza: se è troppo vicina alla precedente, quella cede il posto.
        if (isLast && xLabels.length > 1 && x - lastX < X_LABEL_MIN_GAP) xLabels.pop()
        xLabels.push({ i, x, anchor: i === 0 ? 'start' : isLast ? 'end' : 'middle' })
        lastX = x
      }
    }
    return { innerH, ticks, scaleY, pts, line, area, baseline, xLabels }
  }, [data, width, height])

  // Il puntatore (mouse o dito) seleziona il punto più vicino: su mobile non esiste hover, quindi
  // l'interazione deve funzionare al tocco e al trascinamento.
  const pick = useCallback((clientX: number) => {
    const el = wrapRef.current
    if (!el || !geom) return
    const x = clientX - el.getBoundingClientRect().left
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < geom.pts.length; i++) {
      const d = Math.abs(geom.pts[i].x - x)
      if (d < bestD) { bestD = d; best = i }
    }
    setActive(best)
  }, [geom, wrapRef])

  const activePt = active !== null && geom ? geom.pts[active] : null

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      {geom && (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            className="block touch-pan-y"
            onMouseMove={e => pick(e.clientX)}
            onMouseLeave={() => setActive(null)}
            onTouchStart={e => pick(e.touches[0].clientX)}
            onTouchMove={e => pick(e.touches[0].clientX)}
            onTouchEnd={() => setActive(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            {geom.ticks.map(t => {
              const y = geom.scaleY(t)
              if (y < PAD_TOP - 1 || y > geom.baseline + 1) return null
              return (
                <text key={t} x={PAD_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#94a3b8">
                  {formatY(t)}
                </text>
              )
            })}

            {geom.xLabels.map(l => (
              <text key={l.i} x={l.x} y={height - 6} textAnchor={l.anchor} fontSize={11} fill="#94a3b8">
                {data[l.i].label}
              </text>
            ))}

            <path d={geom.area} fill={`url(#${gradId})`} />
            <path d={geom.line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {activePt && (
              <g pointerEvents="none">
                <line x1={activePt.x} y1={PAD_TOP} x2={activePt.x} y2={geom.baseline} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={activePt.x} cy={activePt.y} r={4} fill="#fff" stroke={color} strokeWidth={2} />
              </g>
            )}
          </svg>

          {/* Tooltip in HTML (non in SVG): eredita tipografia e ombre del design system e va a capo da solo.
              Si ancora al lato opposto del punto per non uscire dal riquadro. */}
          {activePt && active !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-max max-w-[62%] rounded-lg border border-slate-100 bg-white p-3 text-[13px] shadow-xl"
              style={activePt.x > width / 2
                ? { right: Math.max(8, width - activePt.x + 12) }
                : { left: Math.min(activePt.x + 12, width - 8) }}
            >
              {renderTooltip(active)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
