import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Skeleton, SkeletonCard, SkeletonPage } from '../components/Skeleton'
import { TrendingUp, TrendingDown, Scale } from 'lucide-react'
import { format, subMonths, startOfMonth, startOfYear } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { cur, catLabel, getBillingPeriod, toDateString, parseLocalDate, currentPeriodLabel } from '../lib/utils'
import { isAmountsHidden } from '../lib/privacy'
import { logSupabaseError } from '../lib/logError'
import { aggregateStats } from '../lib/stats'
import InfoBox from '../components/InfoBox'
import type { Transaction } from '../types'

type RangeKey = 'period' | '3m' | '6m' | '12m' | 'year'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'period', label: 'Periodo' },
  { key: '3m', label: '3 mesi' },
  { key: '6m', label: '6 mesi' },
  { key: '12m', label: '12 mesi' },
  { key: 'year', label: "Anno" },
]

// Colori stabili per categoria (coerenti tra grafico a torta e lista).
const CAT_COLOR: Record<string, string> = {
  casa: '#3B82F6', bollette: '#06B6D4', trasporti: '#8B5CF6', benzina: '#F97316', cibo: '#10B981',
  salute: '#EC4899', abbonamenti: '#6366F1', svago: '#F59E0B', vestiti: '#14B8A6', istruzione: '#A855F7',
  risparmio: '#22C55E', budget: '#0EA5E9', altro: '#94A3B8',
}
const catColor = (c: string) => CAT_COLOR[c] ?? '#94A3B8'

function rangeFor(key: RangeKey): { start: string; end: string } {
  if (key === 'period') return getBillingPeriod()
  const today = new Date()
  const end = toDateString(today)
  if (key === 'year') return { start: toDateString(startOfYear(today)), end }
  const months = key === '3m' ? 3 : key === '6m' ? 6 : 12
  return { start: toDateString(startOfMonth(subMonths(today, months - 1))), end }
}

function fmtAxisEur(v: number): string {
  if (isAmountsHidden()) return '•'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `€${(v / 1_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k`
  return `€${Number(v).toLocaleString('it-IT')}`
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200 text-[13px]">
      <p className="font-medium text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {cur(p.value)}</p>
      ))}
    </div>
  )
}

export default function Stats() {
  const { user } = useAuth()
  const toast = useToast()
  const [range, setRange] = useState<RangeKey>('period')
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    const { start, end } = rangeFor(range)
    ;(async () => {
      try {
        const { data, error } = await supabase.from('transactions').select('*').gte('date', start).lte('date', end)
        if (error) { logSupabaseError('Errore statistiche:', error); toast.error('Errore nel caricamento') }
        // Solo movimenti reali: niente memo, niente pianificate.
        if (!cancelled) setTxs((data || []).filter(t => !t.is_memo && !t.is_planned))
      } catch {
        if (!cancelled) toast.error('Errore imprevisto (F12 per dettagli)')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range])

  const stats = useMemo(() => {
    const agg = aggregateStats(txs)
    // Etichetta mese leggibile per il grafico (es. "giu 26"), aggiunta qui per tenere pura la
    // funzione di aggregazione.
    const byMonth = agg.byMonth.map(m => ({ ...m, label: format(parseLocalDate(m.key + '-01'), 'MMM yy', { locale: it }) }))
    return { ...agg, byMonth }
  }, [txs])

  const isEmpty = !loading && txs.length === 0
  const showMonthly = stats.byMonth.length >= 2

  return (
    <div>
      <InfoBox title="Cosa vedi qui" tone="blue">
        <p>Una vista <strong>retrospettiva</strong> dei tuoi movimenti reali (no memo, no pianificate) nell'intervallo scelto.</p>
        <p><strong>Entrate / Uscite / Netto</strong>: i totali del periodo selezionato. I trasferimenti tra fondi non contano (sono movimenti interni).</p>
        <p><strong>Per categoria</strong>: dove sono finiti i soldi, dalla voce più pesante alla più leggera.</p>
        <p><strong>Andamento mensile</strong>: entrate contro uscite mese per mese, per cogliere il trend.</p>
      </InfoBox>

      <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Intervallo">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            aria-pressed={range === r.key}
            className={`min-h-[40px] px-3 rounded-lg text-sm font-medium border transition-[transform,background-color,border-color,color] active:scale-[0.98] ${range === r.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-slate-500">{range === 'period' ? currentPeriodLabel() : `${RANGES.find(r => r.key === range)?.label}`}</span>
      </div>

      {loading ? (
        <SkeletonPage>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm sm:p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-[260px] w-full" />
          </div>
        </SkeletonPage>
      ) : isEmpty ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200/70 shadow-sm">
          <p className="text-slate-500">Nessun movimento in questo intervallo</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard icon={TrendingUp} tint="bg-emerald-50 border-emerald-100" color="bg-emerald-500/15 text-emerald-600" valueColor="text-emerald-700" label="Entrate" value={cur(stats.income)} />
            <StatCard icon={TrendingDown} tint="bg-red-50 border-red-100" color="bg-red-500/15 text-red-600" valueColor="text-red-700" label="Uscite" value={cur(stats.expenses)} />
            <StatCard icon={Scale} tint={stats.net >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-amber-50 border-amber-100'} color={stats.net >= 0 ? 'bg-blue-500/15 text-blue-600' : 'bg-amber-500/15 text-amber-600'} valueColor={stats.net >= 0 ? 'text-blue-700' : 'text-amber-700'} label="Netto" value={cur(stats.net)} />
          </div>

          {showMonthly && (
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6 mb-6">
              <h3 className="text-base font-semibold tracking-tight text-slate-900 mb-4">Andamento mensile</h3>
              {/* Il grafico è puramente visivo: senza questo riassunto chi usa uno screen reader non
                  ha alcun accesso ai dati. sr-only lo tiene fuori dalla vista ma dentro il documento. */}
              <p className="sr-only">
                Entrate e uscite mese per mese, da {stats.byMonth[0]?.label} a {stats.byMonth[stats.byMonth.length - 1]?.label}:{' '}
                {stats.byMonth.map(m => `${m.label}: entrate ${cur(m.income)}, uscite ${cur(m.expenses)}`).join('; ')}.
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.byMonth} barGap={2} barCategoryGap="20%">
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis width={46} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtAxisEur} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Bar name="Entrate" dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar name="Uscite" dataKey="expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Entrate</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Uscite</span>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
            <h3 className="text-base font-semibold tracking-tight text-slate-900 mb-4">Uscite per categoria</h3>
            {stats.byCategory.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">Nessuna uscita in questo intervallo</p>
            ) : (
              <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                {/* La torta duplica in forma grafica l'elenco qui accanto, che riporta già categoria,
                    importo e percentuale: nasconderla agli screen reader evita di far attraversare un
                    SVG senza etichette per arrivare agli stessi dati. */}
                <div aria-hidden="true" className="lg:w-1/2 shrink-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.byCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                        {stats.byCategory.map(c => <Cell key={c.category} fill={catColor(c.category)} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="lg:w-1/2 space-y-2.5">
                  {stats.byCategory.map(c => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: catColor(c.category) }} />
                          <span className="text-sm text-slate-700 truncate capitalize">{catLabel(c.category)}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">{cur(c.amount)}</span>
                          <span className="text-xs text-slate-500 tabular-nums w-10 text-right">{c.pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(c.pct, 1.5)}%`, backgroundColor: catColor(c.category) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, color, label, value, valueColor, tint }: { icon: React.ElementType; color: string; label: string; value: string; valueColor: string; tint: string }) {
  return (
    <div className={`rounded-2xl border shadow-sm p-5 ${tint}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
        </div>
        <span className="text-[13px] font-medium text-slate-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold tracking-tight tabular-nums whitespace-nowrap ${valueColor}`}>{value}</p>
    </div>
  )
}
