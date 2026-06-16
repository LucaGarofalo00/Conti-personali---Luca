import { useEffect, useRef, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Stack dei pannelli modali aperti (ordine di apertura). Serve a due cose: tenere bloccato lo
// scroll del body finché l'ultimo non si chiude, e far reagire a Escape/Tab SOLO il modale in cima
// (con modali impilati, es. un Confirm sopra un form, Escape non deve chiudere l'intero stack).
const modalStack: HTMLElement[] = []

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Ref così l'effect dipende solo da `isOpen`: evita di rieseguire il focus a ogni render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    const panel = panelRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    if (modalStack.length === 0) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.paddingRight = `${scrollbarWidth}px`
      document.body.style.overflow = 'hidden'
    }
    if (panel) modalStack.push(panel)

    panel?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      // Solo il modale in cima allo stack gestisce i tasti: gli altri sotto restano inerti.
      if (modalStack[modalStack.length - 1] !== panel) return
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (panel) {
        const idx = modalStack.indexOf(panel)
        if (idx !== -1) modalStack.splice(idx, 1)
      }
      if (modalStack.length === 0) {
        document.body.style.paddingRight = ''
        document.body.style.overflow = ''
      }
      previouslyFocused?.focus?.()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />
      {/* Bottom-sheet su mobile (sale dal basso, angoli alti arrotondati), card centrata da sm in su.
          Colonna flex: header fisso, corpo scrollabile → su schermi bassi la testata resta sempre visibile. */}
      <div ref={panelRef} tabIndex={-1} className="relative flex flex-col w-full max-h-[92dvh] bg-white rounded-t-2xl shadow-2xl ring-1 ring-slate-900/5 overflow-hidden outline-none animate-[slideUp_0.28s_cubic-bezier(0.16,1,0.3,1)] sm:max-w-md sm:max-h-[90vh] sm:rounded-2xl sm:animate-[scaleIn_0.22s_cubic-bezier(0.16,1,0.3,1)]">
        {/* Maniglia di trascinamento: affordance "sheet" nativo, solo su mobile. */}
        <div aria-hidden="true" className="sm:hidden mx-auto mt-2.5 mb-0.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 sm:py-4 border-b border-slate-100 shrink-0">
          <h3 id={titleId} className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-slate-800">{title}</h3>
          <button onClick={onClose} aria-label="Chiudi" className="-mr-1.5 inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors active:scale-90">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
