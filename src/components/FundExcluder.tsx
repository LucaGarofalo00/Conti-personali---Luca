import { useState, useRef, useEffect } from 'react'
import { Filter, Eye, EyeOff, ChevronDown } from 'lucide-react'
import type { Fund } from '../types'

interface Props {
  funds: Fund[]
  excludedIds: string[]
  onToggle: (id: string) => void
  onClear: () => void
  compact?: boolean
}

export default function FundExcluder({ funds, excludedIds, onToggle, onClear, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (funds.length === 0) return null

  const excludedCount = excludedIds.filter(id => funds.some(f => f.id === id)).length

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm transition ${excludedCount > 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
      >
        <Filter className="w-3.5 h-3.5" />
        {compact ? (
          excludedCount > 0 ? `${excludedCount} esclus${excludedCount === 1 ? 'o' : 'i'}` : 'Filtra fondi'
        ) : (
          excludedCount > 0 ? `${excludedCount} fond${excludedCount === 1 ? 'o' : 'i'} esclus${excludedCount === 1 ? 'o' : 'i'}` : 'Includi tutti i fondi'
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Escludi dai calcoli</p>
            {excludedCount > 0 && (
              <button onClick={onClear} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                Reset
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {funds.map(f => {
              const excluded = excludedIds.includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => onToggle(f.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 transition ${excluded ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                    <span className={`truncate ${excluded ? 'line-through' : ''}`}>{f.name}</span>
                  </span>
                  {excluded ? <EyeOff className="w-4 h-4 shrink-0 text-slate-400" /> : <Eye className="w-4 h-4 shrink-0 text-emerald-500" />}
                </button>
              )
            })}
          </div>
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
            <p className="text-xs text-slate-500">I fondi esclusi non sono conteggiati nelle previsioni e nelle stime mensili.</p>
          </div>
        </div>
      )}
    </div>
  )
}
