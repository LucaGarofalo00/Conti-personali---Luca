import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((arg) => {
    const options = typeof arg === 'string' ? { message: arg } : arg
    setOpts(options)
    return new Promise<boolean>(resolve => { resolverRef.current = resolve })
  }, [])

  const close = (result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOpts(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal isOpen={!!opts} onClose={() => close(false)} title={opts?.title || 'Conferma'}>
        {opts && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              {opts.danger && <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
              <p className="text-sm text-slate-600 leading-relaxed">{opts.message}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => close(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-[transform,background-color] active:scale-[0.98]"
              >
                {opts.cancelText || 'Annulla'}
              </button>
              <button
                onClick={() => close(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-[transform,background-color] active:scale-[0.98] ${opts.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'}`}
              >
                {opts.confirmText || 'Conferma'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col provider (pattern intenzionale)
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
