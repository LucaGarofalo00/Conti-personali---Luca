import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff } from 'lucide-react'
import Logo from '../components/Logo'

type Mode = 'login' | 'register' | 'reset' | 'recovery'

export default function Auth({ recovery = false }: { recovery?: boolean }) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const { signIn, signUp, clearRecovery } = useAuth()
  const navigate = useNavigate()

  const switchMode = (m: Mode) => { setMode(m); setError(''); setSuccess('') }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    if (mode === 'recovery') {
      // L'utente è già autenticato dalla sessione di recupero: imposta la nuova password.
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) setError(err.message)
      else {
        clearRecovery()
        navigate('/')
      }
      setLoading(false)
      return
    }

    if (mode === 'reset') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (err) setError(err.message)
      else setSuccess('Email di recupero inviata. Controlla la tua casella di posta.')
      setLoading(false)
      return
    }

    if (mode === 'login') {
      const { error: err } = await signIn(email, password)
      if (err) setError((err as Error).message)
      else navigate('/')
    } else {
      const { error: err } = await signUp(email, password)
      if (err) setError((err as Error).message)
      else setSuccess('Controlla la tua email per confermare la registrazione.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 pt-safe pb-safe bg-gradient-to-br from-indigo-50 via-slate-50 to-violet-100">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <Logo className="w-20 h-20 drop-shadow-md mb-4" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">FinanzApp</h1>
          <p className="text-sm text-slate-400">Gestisci le tue finanze personali</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/70 p-6 sm:p-8">
          {(mode === 'login' || mode === 'register') && (
            <div className="flex mb-6 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => switchMode('login')} className={`flex-1 min-h-[44px] py-2 rounded-md text-[13px] font-medium transition-all duration-150 ${mode === 'login' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}>
                Accedi
              </button>
              <button onClick={() => switchMode('register')} className={`flex-1 min-h-[44px] py-2 rounded-md text-[13px] font-medium transition-all duration-150 ${mode === 'register' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}>
                Registrati
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 mb-1">Recupera Password</h2>
              <p className="text-[13px] text-slate-400">Inserisci la tua email per ricevere il link di recupero</p>
            </div>
          )}

          {mode === 'recovery' && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 mb-1">Imposta nuova password</h2>
              <p className="text-[13px] text-slate-400">Scegli una nuova password per il tuo account</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'recovery' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Email</label>
                <input type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" required />
              </div>
            )}
            {mode !== 'reset' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">{mode === 'recovery' ? 'Nuova password' : 'Password'}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full min-w-0 px-3 py-2.5 pr-12 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" required minLength={mode === 'register' || mode === 'recovery' ? 6 : undefined} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? 'Nascondi password' : 'Mostra password'} className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {(mode === 'register' || mode === 'recovery') && <p className="text-[11px] text-slate-400 mt-1">Almeno 6 caratteri.</p>}
              </div>
            )}

            {error && <p className="text-red-600 text-[13px] bg-red-50 p-2.5 rounded-lg">{error}</p>}
            {success && <p className="text-emerald-600 text-[13px] bg-emerald-50 p-2.5 rounded-lg">{success}</p>}

            <button type="submit" disabled={loading} className="w-full min-h-[44px] py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-lg text-[13px] font-medium hover:from-indigo-700 hover:to-violet-700 shadow-sm shadow-indigo-600/25 disabled:opacity-50 disabled:pointer-events-none transition-all active:scale-[0.99]">
              {loading ? 'Caricamento...' : mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : mode === 'recovery' ? 'Aggiorna password' : 'Invia Link'}
            </button>
          </form>

          {mode !== 'recovery' && (
            <div className="mt-4 text-center">
              {mode === 'reset' ? (
                <button onClick={() => switchMode('login')} className="inline-flex items-center justify-center min-h-[44px] px-2 text-[13px] text-blue-600 hover:text-blue-700 font-medium">
                  Torna al login
                </button>
              ) : (
                <button onClick={() => switchMode('reset')} className="inline-flex items-center justify-center min-h-[44px] px-2 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
                  Password dimenticata?
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
