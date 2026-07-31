import type { ElementType, ReactNode } from 'react'

// Stato vuoto unico per tutta l'app. Prima ce n'erano cinque varianti diverse e tre erano un
// vicolo cieco: una riga di testo grigio, senza icona e senza alcuna azione per uscirne. Un elenco
// vuoto è il primo schermo che vede chi apre l'app appena installata: deve dire cosa manca e come
// procedere.

type Tone = 'slate' | 'blue' | 'emerald' | 'amber' | 'purple'

// Classi complete e letterali: Tailwind non genera i nomi costruiti per interpolazione
// (`bg-${tone}-50` non produrrebbe nulla). Stesso schema di InfoBox.
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-500/15 text-slate-600',
  blue: 'bg-blue-500/15 text-blue-600',
  emerald: 'bg-emerald-500/15 text-emerald-600',
  amber: 'bg-amber-500/15 text-amber-600',
  purple: 'bg-purple-500/15 text-purple-600',
}

interface Props {
  icon: ElementType
  title: string
  description?: string
  tone?: Tone
  /** Azione principale: il modo per uscire dallo stato vuoto (di solito "aggiungi il primo…"). */
  action?: ReactNode
}

export default function EmptyState({ icon: Icon, title, description, tone = 'slate', action }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-12 text-center shadow-sm">
      <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <p className="text-base font-semibold tracking-tight text-slate-900">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
