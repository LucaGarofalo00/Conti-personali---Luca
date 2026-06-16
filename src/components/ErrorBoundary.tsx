import { Component, type ReactNode } from 'react'
import { describeError } from '../lib/logError'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Cattura gli errori di rendering e mostra un fallback invece di uno schermo bianco.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Errore di rendering:', describeError(error))
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f7f8fa' }}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200/60 p-6 text-center">
            <h1 className="text-lg font-semibold text-slate-800 mb-1">Qualcosa è andato storto</h1>
            <p className="text-sm text-slate-500 mb-4">Si è verificato un errore imprevisto. Ricarica la pagina per riprovare; i tuoi dati sono al sicuro.</p>
            <p className="text-xs text-slate-400 mb-4 break-words font-mono">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-[transform,background-color] active:scale-[0.98]"
            >
              Ricarica
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
