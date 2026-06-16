import { useState, useEffect, Fragment, type ReactNode } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, Target, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react'
import { format, addMonths, addDays, differenceInDays, startOfDay } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import FundExcluder from '../components/FundExcluder'
import InfoBox from '../components/InfoBox'
import BreakdownList from '../components/BreakdownList'
import Modal from '../components/Modal'
import { getMonthlyEstimates } from '../lib/forecast'
import { getPeriodBreakdown, type BreakdownItem } from '../lib/periodBreakdown'
import { useExcludedFunds } from '../lib/excludedFunds'
import { cur, getBillingPeriodFor, toDateString, parseLocalDate } from '../lib/utils'
import { isAmountsHidden } from '../lib/privacy'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, Transaction, ForecastPoint } from '../types'

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ForecastPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200 text-sm">
      <p className="font-medium text-slate-700 mb-1">{d.label}</p>
      <p className="text-blue-600">Saldo: {cur(d.balance)}</p>
      <p className="text-emerald-600">Entrate: {cur(d.income)}</p>
      <p className="text-red-500">Uscite: {cur(d.expenses)}</p>
    </div>
  )
}

// Transazioni reali (già avvenute) del periodo, da mostrare nel breakdown come voci
// informative. Escluse: memo, trasferimenti (non contati in previsione) e quelle
// generate da ricorrenti (già rappresentate dalle regole proiettate). Sono già nel
// saldo di partenza, quindi non entrano nei totali (vedi BreakdownList).
function buildActualItems(actualTx: Transaction[], excludedFundIds: string[], startDate: Date, endDate: Date): BreakdownItem[] {
  const s = toDateString(startDate)
  const e = toDateString(endDate)
  const excluded = new Set(excludedFundIds)
  return actualTx
    .filter(t => !t.is_memo && t.type !== 'transfer')
    .filter(t => !t.recurring_expense_id && !t.recurring_income_id)
    .filter(t => !(t.fund_id && excluded.has(t.fund_id)))
    .filter(t => t.date >= s && t.date <= e)
    .map(t => ({
      date: t.date,
      description: t.description || (t.type === 'income' ? 'Entrata' : 'Uscita'),
      amount: Number(t.amount),
      kind: (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense',
      source: 'actual' as const,
      sourceLabel: 'Già avvenuta',
      category: t.category,
    }))
}

export default function Forecast() {
  const { user } = useAuth()
  const toast = useToast()
  const [funds, setFunds] = useState<Fund[]>([])
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [income, setIncome] = useState<RecurringIncome[]>([])
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [planned, setPlanned] = useState<Transaction[]>([])
  const [actualTx, setActualTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [targetDate, setTargetDate] = useState(() => toDateString(addMonths(new Date(), 6)))
  const [excludedFundIds, , toggleExcluded] = useExcludedFunds()
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set())
  const [infoCard, setInfoCard] = useState<{ title: string; body: ReactNode } | null>(null)

  const toggleExpand = (key: string) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    if (!user) return
    const curPeriodStart = getBillingPeriodFor(new Date()).start
    Promise.all([
      supabase.from('funds').select('*').order('sort_order'),
      supabase.from('recurring_expenses').select('*'),
      supabase.from('recurring_income').select('*'),
      supabase.from('weekly_budgets').select('*'),
      supabase.from('transactions').select('*').eq('is_planned', true),
      supabase.from('transactions').select('*').eq('is_planned', false).gte('date', curPeriodStart),
    ]).then(([f, e, i, b, p, a]) => {
      const firstError = [f, e, i, b, p, a].find(r => r.error)?.error
      if (firstError) {
        console.error('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      setFunds(f.data || [])
      setExpenses(e.data || [])
      setIncome(i.data || [])
      setBudgets(b.data || [])
      setPlanned(p.data || [])
      setActualTx(a.data || [])
    }).catch(err => {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    }).finally(() => {
      setLoading(false)
    })
  }, [user])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const targetDateObj = parseLocalDate(targetDate)
  const daysToTarget = Math.max(1, differenceInDays(targetDateObj, new Date()))
  const periodNow = getBillingPeriodFor(new Date())
  const plannedInCurrent = planned.filter(p => p.date >= periodNow.start && p.date <= periodNow.end)
  const est = getMonthlyEstimates(expenses, income, budgets, excludedFundIds, plannedInCurrent)
  const hasExclusions = excludedFundIds.some(id => funds.some(f => f.id === id))
  const excludedNames = funds.filter(f => excludedFundIds.includes(f.id)).map(f => f.name)

  const includedFundsBalance = funds.filter(f => !excludedFundIds.includes(f.id)).reduce((s, f) => s + Number(f.balance), 0)
  const startBalance = includedFundsBalance

  const today = startOfDay(new Date())
  const targetEnd = startOfDay(targetDateObj)

  type PeriodRow = {
    month: string
    label: string
    income: number
    expenses: number
    net: number
    endBalance: number
    minBalance: number
    minBalanceDate: Date
    startDate: Date
    endDate: Date
    effectiveEnd: Date
  }

  const monthlyData: PeriodRow[] = []
  // Saldo dopo OGNI evento, accumulato lungo lo stesso walk per-periodo usato per le card e la
  // tabella: da qui ricaviamo la serie del grafico, così grafico, "Saldo al…", "Minimo" e
  // riepilogo vengono da UN'unica fonte e non possono divergere (niente più secondo motore).
  const eventBalances: { date: string; balance: number; income: number; expenses: number }[] = []
  let runningBalance = startBalance
  let globalMinBalance = startBalance
  let globalMinDate = today
  let cursor = today

  while (cursor <= targetEnd) {
    const { startDate, endDate, start } = getBillingPeriodFor(cursor)
    // Inizio segmento = cursore (mai prima della fine del segmento precedente). Quando il periodo
    // corrente è "aperto"/esteso, getBillingPeriodFor del periodo SUCCESSIVO può iniziare prima di
    // dove finisce questo (sovrapposizione): partizionando su segStart evitiamo di contare due
    // volte l'occorrenza sul giorno di confine. Nel caso normale segStart coincide col cursore.
    const segStart = cursor > startDate ? cursor : startDate
    const effectiveEnd = targetEnd < endDate ? targetEnd : endDate

    const items = getPeriodBreakdown({
      startDate: segStart, endDate: effectiveEnd,
      recurringExpenses: expenses, recurringIncome: income,
      weeklyBudgets: budgets, planned,
      excludedFundIds, fromToday: true,
      // Riconcilia col reale del periodo corrente: le occorrenze già realizzate o segnate
      // "non lavorato"/"non avvenuto" non vengono più proiettate come entrate/uscite future.
      actualTx, excludeRealized: true,
    })
    const sorted = [...items].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

    let periodIncome = 0
    let periodExpenses = 0
    let balance = runningBalance
    let periodMinBalance = runningBalance
    let periodMinDate = cursor

    for (const it of sorted) {
      if (it.kind === 'income') { balance += it.amount; periodIncome += it.amount }
      else { balance -= it.amount; periodExpenses += it.amount }
      if (balance < periodMinBalance) {
        periodMinBalance = balance
        periodMinDate = parseLocalDate(it.date)
      }
      if (balance < globalMinBalance) {
        globalMinBalance = balance
        globalMinDate = parseLocalDate(it.date)
      }
      eventBalances.push({
        date: it.date,
        balance,
        income: it.kind === 'income' ? it.amount : 0,
        expenses: it.kind === 'expense' ? it.amount : 0,
      })
    }

    const isTruncated = effectiveEnd < endDate
    monthlyData.push({
      month: start,
      label: `${format(segStart, 'd MMM', { locale: it })} – ${format(effectiveEnd, 'd MMM yyyy', { locale: it })}${isTruncated ? ' (parziale)' : ''}`,
      income: Math.round(periodIncome * 100) / 100,
      expenses: Math.round(periodExpenses * 100) / 100,
      net: Math.round((periodIncome - periodExpenses) * 100) / 100,
      endBalance: Math.round(balance * 100) / 100,
      minBalance: Math.round(periodMinBalance * 100) / 100,
      minBalanceDate: periodMinDate,
      startDate: segStart, endDate, effectiveEnd,
    })

    runningBalance = balance
    cursor = addDays(endDate, 1)
  }

  const endBalance = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].endBalance : startBalance
  const trend = endBalance - startBalance
  const minPoint = { balance: globalMinBalance, label: format(globalMinDate, 'd MMM', { locale: it }) }

  // Serie del grafico: punto di partenza (oggi, saldo attuale) + un punto per ogni GIORNO con
  // eventi, col saldo di fine giornata preso dallo stesso walk delle card/tabella. L'ultimo punto
  // coincide quindi con "Saldo al…" e la curva riflette lo stesso saldo progressivo del riepilogo.
  const dayMap = new Map<string, { balance: number; income: number; expenses: number }>()
  for (const ev of eventBalances) {
    const d = dayMap.get(ev.date) || { balance: ev.balance, income: 0, expenses: 0 }
    d.balance = ev.balance // gli eventi sono cronologici: l'ultimo della giornata è il saldo di fine giornata
    d.income += ev.income
    d.expenses += ev.expenses
    dayMap.set(ev.date, d)
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const chartData: ForecastPoint[] = [
    { date: toDateString(today), balance: r2(startBalance), income: 0, expenses: 0, label: format(today, 'd MMM', { locale: it }) },
    ...[...dayMap.entries()].map(([date, v]) => ({
      date, balance: r2(v.balance), income: r2(v.income), expenses: r2(v.expenses),
      label: format(parseLocalDate(date), 'd MMM', { locale: it }),
    })),
  ]

  return (
    <div>
      <InfoBox title="Come funziona la previsione" tone="blue">
        <p><strong>Partenza</strong>: la previsione parte dal <strong>saldo attuale</strong> dei tuoi fondi (escluso quelli filtrati col selettore).</p>
        <p><strong>Filtro data "Fino al"</strong>: limita la proiezione a una data specifica. La previsione conta solo gli eventi che cadono <strong>tra oggi e quella data</strong>. Se imposti 1 giorno, vedi solo eventi di domani.</p>
        <p><strong>Cosa aggiunge giorno per giorno</strong>:</p>
        <ul className="list-disc ml-4 space-y-0.5">
          <li><strong>Entrate ricorrenti</strong>: stipendio mensile (sul day_of_month), sabato settimanale (sul day_of_week + delay)</li>
          <li><strong>Spese ricorrenti mensili</strong>: cadono sul giorno del mese indicato</li>
          <li><strong>Spese ricorrenti settimanali</strong>: cadono sul giorno della settimana indicato (es. GPL ogni venerdì)</li>
          <li><strong>Budget settimanali</strong>: contati una volta per ogni <strong>lunedì</strong> nel range (es. Sfizi 50€/sett → 50€ per ogni lunedì futuro)</li>
          <li><strong>Pianificate</strong>: una tantum con quella data esatta</li>
        </ul>
        <p><strong>Esempio</strong>: oggi è martedì, filtro fino a mercoledì. Nessun lunedì nel range → il budget Sfizi NON viene contato. Solo eventi del 19-20 maggio.</p>
        <p><strong>Trasferimenti tra fondi</strong>: <strong>NON contati nelle previsioni</strong>. Sono solo movimenti tra i tuoi conti, non spese reali. Per esempio: se sposti 50€/mese dal Sella a un salvadanaio "Spese MG", non riduce il tuo netto. La vera spesa la registri quando paghi davvero (es. annuale del bollo).</p>
        <p><strong>Minimo</strong>: il saldo previsto più basso del periodo.</p>
        <p><strong>Saldo a fine periodo</strong>: saldo previsto all'ultimo giorno del periodo, prima del nuovo ciclo (stipendio). Se "(parziale)" nel label, significa che il periodo è stato troncato dal filtro data.</p>
      </InfoBox>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          {hasExclusions && (
            <p className="text-xs text-slate-500 mt-1">Esclusi: {excludedNames.join(', ')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FundExcluder
            funds={funds}
            excludedIds={excludedFundIds}
            onToggle={toggleExcluded}
            onClear={() => excludedFundIds.forEach(id => toggleExcluded(id))}
          />
          <div className="flex items-center gap-2">
            <label htmlFor="forecast-target" className="text-xs text-slate-500">Fino al</label>
            <input
              id="forecast-target"
              type="date"
              value={targetDate}
              min={toDateString(new Date())}
              onChange={e => setTargetDate(e.target.value)}
              className="min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow"
            />
            <span className="text-xs text-slate-500 whitespace-nowrap">({daysToTarget} giorni)</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard icon={Target} color="bg-blue-100 text-blue-600" tint="bg-blue-50 border-blue-100" valueColor="text-blue-700" label="Saldo Attuale" value={cur(startBalance)}
          onClick={() => setInfoCard({ title: 'Saldo Attuale', body: (<>
            <p>La somma di <strong>tutti i tuoi fondi adesso</strong> (esclusi quelli tolti col filtro in alto).</p>
            <p>È il punto di partenza della previsione: tutti gli altri numeri partono da qui.</p>
          </>) })} />
        <MetricCard icon={trend >= 0 ? TrendingUp : TrendingDown} color={trend >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'} tint={trend >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'} valueColor={trend >= 0 ? 'text-emerald-700' : 'text-red-700'} label={`Saldo al ${format(targetDateObj, 'd MMM yyyy', { locale: it })}`} value={cur(endBalance)}
          onClick={() => setInfoCard({ title: `Saldo al ${format(targetDateObj, 'd MMM yyyy', { locale: it })}`, body: (<>
            <p>Quanto la previsione stima che avrai <strong>a quella data</strong>.</p>
            <p>Parte dal saldo attuale, poi aggiunge le entrate e toglie le spese previste fino ad allora: ricorrenti, budget settimanali e pianificate.</p>
            <p>Cambi la data col selettore <strong>«Fino al»</strong> qui sopra.</p>
          </>) })} />
        <MetricCard icon={AlertTriangle} color={minPoint.balance < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'} tint={minPoint.balance < 0 ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'} valueColor={minPoint.balance < 0 ? 'text-red-700' : 'text-amber-700'} label="Minimo Previsto" value={cur(minPoint.balance)} sub={minPoint.label}
          onClick={() => setInfoCard({ title: 'Minimo Previsto', body: (<>
            <p>Il punto <strong>più basso</strong> che il saldo potrebbe toccare da oggi alla data scelta, con il giorno in cui succede.</p>
            <p>Serve a capire se rischi di restare a corto (o andare sotto zero) prima del prossimo accredito, anche se a fine periodo il saldo torna positivo.</p>
          </>) })} />
        <MetricCard icon={TrendingUp} color="bg-emerald-100 text-emerald-600" tint="bg-emerald-50 border-emerald-100" valueColor="text-emerald-700" label="Netto mensile medio" value={cur(est.monthlyNet)} sub={est.monthlyNet >= 0 ? 'In media risparmi' : 'In media in rosso'}
          onClick={() => setInfoCard({ title: 'Netto mensile medio', body: (<>
            <p>La <strong>media</strong> di quanto entra meno quanto esce in un mese tipo.</p>
            <p>Le voci settimanali contano ×4,33, quelle annuali ÷12 (es. il bollo da 600€ una volta l'anno qui pesa 50€/mese).</p>
            <p>Se è <strong>positivo</strong> in media metti da parte; se è <strong>negativo</strong> in media spendi più di quanto guadagni.</p>
            <p>È una media: <strong>nessun mese reale è esattamente così</strong>. Per il dettaglio giorno per giorno guarda il grafico e la tabella qui sotto.</p>
          </>) })} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900 mb-4">Proiezione Saldo</h3>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 8))} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => isAmountsHidden() ? '•' : `€${Number(v).toLocaleString('it-IT')}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="balance" stroke="#3B82F6" fill="url(#forecastGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center text-slate-400 py-12">Configura fondi, entrate e uscite per vedere la previsione</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Riepilogo per Periodo</h3>
          <p className="text-xs text-slate-500 mt-1">Clicca su una riga per vedere quali entrate e uscite la compongono.</p>
        </div>
        {/* Lista a card verticale: solo su mobile (< sm). Stessa logica di toggle/espansione della tabella. */}
        <div className="sm:hidden divide-y divide-slate-100">
          {monthlyData.map(row => {
            const isOpen = expandedPeriods.has(row.month)
            // Riusa la stessa fine-effettiva già calcolata per la riga, invece di ricalcolarla
            // con una variabile diversa (evita divergenze sul giorno di confine).
            const effectiveEnd = row.effectiveEnd
            const breakdown = isOpen ? [
              ...getPeriodBreakdown({
                startDate: row.startDate,
                endDate: effectiveEnd,
                recurringExpenses: expenses,
                recurringIncome: income,
                weeklyBudgets: budgets,
                planned,
                excludedFundIds,
                fromToday: true,
                actualTx, excludeRealized: true,
              }),
              ...buildActualItems(actualTx, excludedFundIds, row.startDate, effectiveEnd),
            ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : []
            return (
              <div key={row.month}>
                <button
                  type="button"
                  className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-slate-50 transition-colors min-h-[40px]"
                  onClick={() => toggleExpand(row.month)}
                  aria-expanded={isOpen}
                >
                  <span className="text-slate-400 shrink-0 mt-0.5">
                    {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700 break-words">{row.label}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 shrink-0">Entrate</dt>
                        <dd className="text-emerald-600 tabular-nums text-right min-w-0 truncate">{cur(row.income)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 shrink-0">Uscite</dt>
                        <dd className="text-red-500 tabular-nums text-right min-w-0 truncate">{cur(row.expenses)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 shrink-0">Netto</dt>
                        <dd className={`tabular-nums text-right min-w-0 truncate font-medium ${row.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{cur(row.net)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 shrink-0">Minimo</dt>
                        <dd className={`tabular-nums text-right min-w-0 truncate ${row.minBalance < 0 ? 'text-red-600 font-semibold' : 'text-amber-600'}`}>{cur(row.minBalance)}</dd>
                      </div>
                      <div className="col-span-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                        <dt className="text-slate-500 shrink-0">Saldo a fine periodo</dt>
                        <dd className={`tabular-nums text-right min-w-0 truncate font-semibold tracking-tight ${row.endBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{cur(row.endBalance)}</dd>
                      </div>
                    </dl>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 bg-slate-50/50">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-white rounded-lg border border-emerald-100 p-3">
                        <p className="text-xs font-semibold text-emerald-700 mb-2 uppercase tracking-wide">Entrate previste</p>
                        <BreakdownList items={breakdown} kind="income" emptyText="Nessuna entrata in questo periodo" compact />
                      </div>
                      <div className="bg-white rounded-lg border border-red-100 p-3">
                        <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Uscite previste</p>
                        <BreakdownList items={breakdown} kind="expense" emptyText="Nessuna uscita in questo periodo" compact />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Tabella completa: solo da sm in su. */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600 w-6"></th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Periodo</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Entrate</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Uscite</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Netto</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600" title="Saldo previsto più basso durante il periodo">Minimo</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600" title="Saldo previsto all'ultimo giorno del periodo, prima del nuovo ciclo">Saldo a fine periodo</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(row => {
                const isOpen = expandedPeriods.has(row.month)
                // Riusa la stessa fine-effettiva già calcolata per la riga, invece di ricalcolarla
                // con una variabile diversa (evita divergenze sul giorno di confine).
                const effectiveEnd = row.effectiveEnd
                const breakdown = isOpen ? [
                  ...getPeriodBreakdown({
                    startDate: row.startDate,
                    endDate: effectiveEnd,
                    recurringExpenses: expenses,
                    recurringIncome: income,
                    weeklyBudgets: budgets,
                    planned,
                    excludedFundIds,
                    fromToday: true,
                    actualTx, excludeRealized: true,
                  }),
                  ...buildActualItems(actualTx, excludedFundIds, row.startDate, effectiveEnd),
                ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : []
                return (
                  <Fragment key={row.month}>
                    <tr
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(row.month)}
                    >
                      <td className="px-2 py-3 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{row.label}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{cur(row.income)}</td>
                      <td className="px-4 py-3 text-right text-red-500">{cur(row.expenses)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${row.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{cur(row.net)}</td>
                      <td className={`px-4 py-3 text-right ${row.minBalance < 0 ? 'text-red-600 font-semibold' : 'text-amber-600'}`}>{cur(row.minBalance)}</td>
                      <td className={`px-4 py-3 text-right font-semibold tracking-tight ${row.endBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{cur(row.endBalance)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg border border-emerald-100 p-3">
                              <p className="text-xs font-semibold text-emerald-700 mb-2 uppercase tracking-wide">Entrate previste</p>
                              <BreakdownList items={breakdown} kind="income" emptyText="Nessuna entrata in questo periodo" compact />
                            </div>
                            <div className="bg-white rounded-lg border border-red-100 p-3">
                              <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Uscite previste</p>
                              <BreakdownList items={breakdown} kind="expense" emptyText="Nessuna uscita in questo periodo" compact />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {minPoint.balance < 0 && (
        <div className="mt-6 p-4 sm:p-5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold tracking-tight text-red-700">Attenzione: saldo negativo previsto</p>
            <p className="text-sm text-red-600 mt-1">Il saldo potrebbe scendere a {cur(minPoint.balance)} intorno al {minPoint.label}. Considera di ridurre le spese o aumentare le entrate.</p>
          </div>
        </div>
      )}

      <Modal isOpen={!!infoCard} onClose={() => setInfoCard(null)} title={infoCard?.title || ''}>
        {infoCard && <div className="text-sm text-slate-600 space-y-2 leading-relaxed">{infoCard.body}</div>}
      </Modal>
    </div>
  )
}

function MetricCard({ icon: Icon, color, label, value, sub, onClick, tint, valueColor }: { icon: React.ElementType; color: string; label: string; value: string; sub?: string; onClick?: () => void; tint?: string; valueColor?: string }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={`${tint || 'bg-white border-slate-200/70'} rounded-2xl border shadow-sm p-5 text-left w-full ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
        </div>
        <span className="text-sm font-medium text-slate-500 flex-1 leading-snug">{label}</span>
        {onClick && <HelpCircle className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden="true" />}
      </div>
      <p className={`text-2xl font-bold tracking-tight tabular-nums ${valueColor || 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </Wrapper>
  )
}
