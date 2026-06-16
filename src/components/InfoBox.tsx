import { useState, type ReactNode } from 'react'
import { HelpCircle, ChevronDown } from 'lucide-react'

type Tone = 'slate' | 'blue' | 'amber' | 'emerald' | 'purple'

interface Props {
  title?: string
  children: ReactNode
  variant?: 'default' | 'compact'
  defaultOpen?: boolean
  tone?: Tone
}

// Mappa il `tone` a classi di bordo/sfondo/icona/titolo. Le stringhe sono letterali così Tailwind
// le genera in build. `slate` = aspetto neutro storico.
const TONES: Record<Tone, { border: string; bg: string; icon: string; title: string }> = {
  slate: { border: 'border-slate-200', bg: 'bg-white', icon: 'text-slate-400', title: 'text-slate-600' },
  blue: { border: 'border-blue-200', bg: 'bg-blue-50/40', icon: 'text-blue-500', title: 'text-blue-700' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50/40', icon: 'text-amber-500', title: 'text-amber-700' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50/40', icon: 'text-emerald-500', title: 'text-emerald-700' },
  purple: { border: 'border-purple-200', bg: 'bg-purple-50/40', icon: 'text-purple-500', title: 'text-purple-700' },
}

export default function InfoBox({ title, children, variant = 'default', defaultOpen = false, tone = 'slate' }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const t = TONES[tone]

  if (variant === 'compact') {
    return (
      <div className="text-xs text-slate-500 flex items-start gap-1.5">
        <HelpCircle aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${t.icon}`} />
        <div className="flex-1 min-w-0 break-words">{children}</div>
      </div>
    )
  }

  return (
    <div className={`border rounded-lg mb-3 ${t.border} ${t.bg}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 min-h-[40px] text-left rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 ${t.icon}`} />
          <span className={`text-[13px] font-medium tracking-tight break-words ${t.title}`}>{title || 'Come funziona'}</span>
        </div>
        <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${t.icon} ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3 text-xs text-slate-500 space-y-1.5 leading-relaxed break-words border-t border-slate-100 pt-2.5">
          {children}
        </div>
      )}
    </div>
  )
}
