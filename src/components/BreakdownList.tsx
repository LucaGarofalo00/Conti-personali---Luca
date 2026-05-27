import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
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
  budget_extra: 'bg-red-100 text-red-700',
  budget_residual: 'bg-emerald-100 text-emerald-700',
}

interface Props {
  items: BreakdownItem[]
  kind?: 'income' | 'expense' | 'both'
  emptyText?: string
  compact?: boolean
}

export default function BreakdownList({ items, kind = 'both', emptyText = 'Nessuna voce', compact = false }: Props) {
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

  return (
    <div className={`space-y-1 ${compact ? 'text-xs' : 'text-sm'}`}>
      {filtered.map((item, idx) => {
        const isActual = item.source === 'actual'
        return (
          <div key={idx} className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-slate-50 ${isActual ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {item.kind === 'income'
                ? <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                : <ArrowUpRight className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              <span className="text-slate-500 shrink-0 tabular-nums">{format(new Date(item.date), 'd MMM', { locale: it })}</span>
              <span className="text-slate-700 truncate">{item.description}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase shrink-0 ${SOURCE_COLORS[item.source] || 'bg-slate-100 text-slate-600'}`}>
                {item.sourceLabel}
              </span>
            </div>
            <span className={`font-medium tabular-nums shrink-0 ${item.kind === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
              {item.kind === 'income' ? '+' : '-'}{cur(item.amount)}
            </span>
          </div>
        )
      })}
      <div className="border-t border-slate-200 pt-2 mt-2 flex items-center justify-between text-xs text-slate-600">
        {kind === 'both' ? (
          <>
            <span>Tot: <span className="text-emerald-600 font-medium">+{cur(incomeTotal)}</span> · <span className="text-red-500 font-medium">-{cur(expenseTotal)}</span></span>
            <span className="font-semibold">Netto: <span className={incomeTotal - expenseTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}>{cur(incomeTotal - expenseTotal)}</span></span>
          </>
        ) : (
          <span className="ml-auto font-semibold">Totale: <span className={kind === 'income' ? 'text-emerald-600' : 'text-red-500'}>{cur(total)}</span></span>
        )}
      </div>
    </div>
  )
}
