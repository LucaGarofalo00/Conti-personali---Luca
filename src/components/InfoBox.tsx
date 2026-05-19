import { useState, type ReactNode } from 'react'
import { Info, ChevronDown } from 'lucide-react'

interface Props {
  title?: string
  children: ReactNode
  variant?: 'default' | 'compact'
  defaultOpen?: boolean
  tone?: 'slate' | 'indigo' | 'amber' | 'emerald' | 'purple'
}

const TONE_CLASSES: Record<NonNullable<Props['tone']>, { box: string; icon: string; title: string }> = {
  slate: { box: 'bg-slate-50 border-slate-200', icon: 'text-slate-500', title: 'text-slate-700' },
  indigo: { box: 'bg-indigo-50 border-indigo-200', icon: 'text-indigo-500', title: 'text-indigo-700' },
  amber: { box: 'bg-amber-50 border-amber-200', icon: 'text-amber-500', title: 'text-amber-700' },
  emerald: { box: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-500', title: 'text-emerald-700' },
  purple: { box: 'bg-purple-50 border-purple-200', icon: 'text-purple-500', title: 'text-purple-700' },
}

export default function InfoBox({ title, children, variant = 'default', defaultOpen = false, tone = 'slate' }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const classes = TONE_CLASSES[tone]

  if (variant === 'compact') {
    return (
      <div className={`text-xs ${classes.title} flex items-start gap-1.5 ${classes.icon}`}>
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="flex-1">{children}</div>
      </div>
    )
  }

  return (
    <div className={`border rounded-lg ${classes.box} mb-3`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Info className={`w-4 h-4 shrink-0 ${classes.icon}`} />
          <span className={`text-sm font-medium ${classes.title}`}>{title || 'Come funziona'}</span>
        </div>
        <ChevronDown className={`w-4 h-4 ${classes.icon} transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`px-3 pb-3 text-xs ${classes.title} space-y-2 leading-relaxed`}>
          {children}
        </div>
      )}
    </div>
  )
}
