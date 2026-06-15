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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-[scaleIn_0.15s_ease-out] outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 id={titleId} className="text-[15px] font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-x-hidden">{children}</div>
      </div>
    </div>
  )
}
