import { useState, type ReactNode } from 'react'
import { HelpCircle, ChevronDown } from 'lucide-react'

interface Props {
  title?: string
  children: ReactNode
  variant?: 'default' | 'compact'
  defaultOpen?: boolean
  tone?: 'slate' | 'blue' | 'amber' | 'emerald' | 'purple'
}

export default function InfoBox({ title, children, variant = 'default', defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  if (variant === 'compact') {
    return (
      <div className="text-xs text-slate-500 flex items-start gap-1.5">
        <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <div className="flex-1">{children}</div>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          <span className="text-[13px] font-medium text-slate-600">{title || 'Come funziona'}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3 text-xs text-slate-500 space-y-1.5 leading-relaxed border-t border-slate-100 pt-2.5">
          {children}
        </div>
      )}
    </div>
  )
}
