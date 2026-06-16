import { useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react'
import { cur } from '../lib/utils'
import type { BreakdownItem } from '../lib/periodBreakdown'

const SOURCE_COLORS: Record<string, string> = {
  recurring_income: 'bg-emerald-100 text-emerald-700',
  recurring_expense: 'bg-red-100 text-red-700',
  weekly_budget: 'bg-blue-100 text-blue-700',
  variable_weekly: 'bg-amber-100 text-amber-700',
  variable_monthly: 'bg-amber-100 text-amber-700',
  planned: 'bg-purple-100 text-purple-700',
  transfer: 'bg-blue-100 text-blue-700',
  actual: 'bg-slate-200 text-slate-600',
  actual_oneoff: 'bg-cyan-100 text-cyan-700',
}

// Ordine con cui mostrare i gruppi per tipologia nelle suddivisioni dei modali.
const SOURCE_ORDER = ['recurring_income', 'recurring_expense', 'weekly_budget', 'planned', 'actual_oneoff', 'transfer', 'actual']
const orderOf = (s: string) => { const i = SOURCE_ORDER.indexOf(s); return i === -1 ? 99 : i }

interface Props {
  items: BreakdownItem[]
  kind?: 'income' | 'expense' | 'both'
  emptyText?: string
  compact?: boolean
}

export default function BreakdownList({ items, kind = 'both', emptyText = 'Nessuna voce', compact = false }: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (src: string) => setCollapsedGroups(prev => {
    const next = new Set(prev)
    if (next.has(src)) next.delete(src); else next.add(src)
    return next
  })

  const filtered = kind === 'both' ? items : items.filter(i => i.kind === kind)

  if (filtered.length === 0) {
    return <p className="text-xs text-slate-400 italic py-2 text-center">{emptyText}</p>
  }

  // Le voci "già avvenute" (transazioni reali del periodo) sono solo informative:
  // sono già riflesse nel saldo di partenza, quindi non entrano nei totali proiettati.
  const projected = filtered.filter(i => i.source !== 'actual')
  const total = projected.reduce((s, i) => s + i.amount, 0)
  const incomeTotal = projected.filter(i => i.kind === 'income').reduce((s, i) => s + i.amount, 0)
  const expenseTotal = projected.filter(i => i.kind === 'expense').reduce((s, i) => s + i.amount, 0)

  // Raggruppa per tipologia (source) per dare suddivisioni visive nei modali.
  const groups: { source: string; label: string; items: BreakdownItem[] }[] = []
  const gmap = new Map<string, { source: string; label: string; items: BreakdownItem[] }>()
  for (const it of filtered) {
    let g = gmap.get(it.source)
    if (!g) { g = { source: it.source, label: it.sourceLabel, items: [] }; gmap.set(it.source, g); groups.push(g) }
    g.items.push(it)
  }
  groups.sort((a, b) => orderOf(a.source) - orderOf(b.source))
  const showHeaders = groups.length > 1

  const renderRow = (item: BreakdownItem, key: string) => {
    const isActual = item.source === 'actual'
    return (
      <div key={key} className={`flex items-start justify-between gap-2 py-1.5 px-2 rounded hover:bg-slate-50 ${isActual ? 'opacity-60' : ''}`}>
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {item.kind === 'income'
            ? <ArrowDownRight aria-hidden="true" className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            : <ArrowUpRight aria-hidden="true" className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className="text-slate-700 break-words leading-snug">{item.description}</p>
            <p className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className="text-[11px] text-slate-400 tabular-nums">{format(new Date(item.date), 'd MMM', { locale: it })}</span>
              {!showHeaders && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${SOURCE_COLORS[item.source] || 'bg-slate-100 text-slate-600'}`}>
                  {item.sourceLabel}
                </span>
              )}
            </p>
          </div>
        </div>
        <span className={`font-medium tabular-nums shrink-0 ${item.kind === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
          {item.kind === 'income' ? '+' : '-'}{cur(item.amount)}
        </span>
      </div>
    )
  }

  return (
    <div className={`space-y-2.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      {groups.map(g => {
        const isIncomeGroup = g.items[0]?.kind === 'income'
        const sub = g.items.filter(i => i.source !== 'actual').reduce((s, i) => s + i.amount, 0)

        // Senza intestazioni (un solo gruppo) mostra le righe direttamente.
        if (!showHeaders) {
          return <div key={g.source} className="space-y-0.5">{g.items.map((item, idx) => renderRow(item, `${g.source}-${idx}`))}</div>
        }

        const isOpen = !collapsedGroups.has(g.source)
        const headerColor = SOURCE_COLORS[g.source] || 'bg-slate-100 text-slate-600'
        return (
          <div key={g.source} className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => toggleGroup(g.source)}
              aria-expanded={isOpen}
              className={`w-full flex items-center justify-between gap-2 min-h-[44px] ${compact ? 'px-2.5 py-2' : 'px-3 py-3'} ${headerColor} hover:opacity-90 transition-opacity`}
            >
              <span className="flex items-center gap-2 min-w-0 flex-1">
                {isOpen ? <ChevronDown aria-hidden="true" className="w-4 h-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0" />}
                <span className={`font-bold uppercase tracking-wide truncate min-w-0 ${compact ? 'text-xs' : 'text-sm'}`}>{g.label}</span>
                <span className="text-[11px] font-semibold opacity-60 shrink-0">{g.items.length}</span>
              </span>
              {g.source !== 'actual' && (
                <span className={`font-bold tabular-nums shrink-0 ${compact ? 'text-xs' : 'text-[15px]'}`}>{isIncomeGroup ? '+' : '-'}{cur(sub)}</span>
              )}
            </button>
            {isOpen && (
              <div className="bg-white divide-y divide-slate-100 px-1.5 py-1">
                {g.items.map((item, idx) => renderRow(item, `${g.source}-${idx}`))}
              </div>
            )}
          </div>
        )
      })}
      <div className="border-t-2 border-slate-200 pt-2.5 mt-1 flex items-center justify-between flex-wrap gap-x-3 gap-y-1 text-[13px] text-slate-600">
        {kind === 'both' ? (
          <>
            <span className="tabular-nums">Tot: <span className="text-emerald-600 font-medium">+{cur(incomeTotal)}</span> · <span className="text-red-500 font-medium">-{cur(expenseTotal)}</span></span>
            <span className="font-semibold tabular-nums">Netto: <span className={incomeTotal - expenseTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}>{cur(incomeTotal - expenseTotal)}</span></span>
          </>
        ) : (
          <span className="ml-auto font-semibold tabular-nums">Totale del periodo: <span className={`text-[15px] ${kind === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>{cur(total)}</span></span>
        )}
      </div>
    </div>
  )
}
