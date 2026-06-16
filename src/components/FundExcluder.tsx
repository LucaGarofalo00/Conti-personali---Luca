import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Filter, Eye, EyeOff, ChevronDown } from 'lucide-react'
import type { Fund } from '../types'

interface Props {
  funds: Fund[]
  excludedIds: string[]
  onToggle: (id: string) => void
  onClear: () => void
  compact?: boolean
}

const DROPDOWN_WIDTH = 280

export default function FundExcluder({ funds, excludedIds, onToggle, onClear, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const viewport = window.innerWidth
    const rightAlignedLeft = rect.right - DROPDOWN_WIDTH
    const leftAlignedRight = rect.left + DROPDOWN_WIDTH
    const shouldAlignRight = !(rightAlignedLeft < 8 && leftAlignedRight <= viewport - 8)
    if (shouldAlignRight !== alignRight) setAlignRight(shouldAlignRight)
  })

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const viewport = window.innerWidth
      const rightAlignedLeft = rect.right - DROPDOWN_WIDTH
      const leftAlignedRight = rect.left + DROPDOWN_WIDTH
      const shouldAlignRight = !(rightAlignedLeft < 8 && leftAlignedRight <= viewport - 8)
      setAlignRight(prev => prev === shouldAlignRight ? prev : shouldAlignRight)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  if (funds.length === 0) return null

  const excludedCount = excludedIds.filter(id => funds.some(f => f.id === id)).length

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center gap-2 px-3 py-1.5 min-h-[40px] sm:min-h-0 border rounded-lg text-[13px] font-medium transition-all duration-150 active:scale-[0.98] ${excludedCount > 0 ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-white hover:border-slate-300'}`}
      >
        <Filter aria-hidden="true" className="w-3.5 h-3.5" />
        {compact ? (
          excludedCount > 0 ? `${excludedCount} esclus${excludedCount === 1 ? 'o' : 'i'}` : 'Filtra fondi'
        ) : (
          excludedCount > 0 ? `${excludedCount} fond${excludedCount === 1 ? 'o' : 'i'} esclus${excludedCount === 1 ? 'o' : 'i'}` : 'Tutti i fondi'
        )}
        <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className={`absolute mt-1.5 w-70 max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-lg shadow-xl z-40 overflow-hidden animate-[scaleIn_0.1s_ease-out] ${alignRight ? 'right-0' : 'left-0'}`}
        >
          <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-medium text-slate-400 uppercase tracking-wider">Escludi dai calcoli</p>
            {excludedCount > 0 && (
              <button onClick={onClear} className="shrink-0 inline-flex items-center min-h-[40px] sm:min-h-0 -my-2.5 sm:my-0 px-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                Reset
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {funds.map(f => {
              const excluded = excludedIds.includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => onToggle(f.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 min-h-[40px] text-left text-[13px] hover:bg-slate-50 transition-colors ${excluded ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <span className="flex items-center gap-2.5 min-w-0 truncate">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                    <span className={`truncate ${excluded ? 'line-through' : ''}`}>{f.name}</span>
                  </span>
                  {excluded ? <EyeOff className="w-3.5 h-3.5 shrink-0 text-slate-300" /> : <Eye className="w-3.5 h-3.5 shrink-0 text-emerald-500" />}
                </button>
              )
            })}
          </div>
          <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100">
            <p className="text-[11px] text-slate-400">I fondi esclusi non sono conteggiati nelle previsioni e nelle stime.</p>
          </div>
        </div>
      )}
    </div>
  )
}
