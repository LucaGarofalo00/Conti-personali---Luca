import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

interface ToastContextType {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((message: string, type: 'success' | 'error') => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => remove(id), 4000)
  }, [remove])

  const ctx: ToastContextType = {
    success: useCallback((msg: string) => add(msg, 'success'), [add]),
    error: useCallback((msg: string) => add(msg, 'error'), [add]),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed inset-x-0 bottom-0 z-[100] space-y-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:px-0 sm:pb-4 sm:max-w-sm" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : undefined}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg ring-1 text-[13px] font-medium animate-[slideIn_0.22s_cubic-bezier(0.16,1,0.3,1)] ${
              t.type === 'success'
                ? 'bg-slate-900 text-white ring-white/10'
                : 'bg-red-600 text-white ring-black/10'
            }`}
          >
            {t.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span className="flex-1 min-w-0 break-words">{t.message}</span>
            <button onClick={() => remove(t.id)} aria-label="Chiudi notifica" className="-mr-2 -my-1 inline-flex items-center justify-center w-10 h-10 shrink-0 hover:opacity-75">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col provider (pattern intenzionale)
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
