import { useId, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { userMessage } from '../lib/logError'
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
  // Le etichette erano scollegate dai campi: toccandole non si portava il focus sull'input e uno
  // screen reader leggeva "casella di testo" senza nome.
  const emailId = useId()
  const passwordId = useId()

  const switchMode = (m: Mode) => { setMode(m); setError(''); setSuccess('') }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    if (mode === 'recovery') {
      // L'utente è già autenticato dalla sessione di recupero: imposta la nuova password.
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) setError(userMessage(err, 'Non è stato possibile aggiornare la password.'))
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
      if (err) setError(userMessage(err, 'Non è stato possibile inviare l\'email di recupero.'))
      else setSuccess('Email di recupero inviata. Controlla la tua casella di posta.')
      setLoading(false)
      return
    }

    if (mode === 'login') {
      const { error: err } = await signIn(email, password)
      if (err) {
        // Messaggio generico per non rivelare se l'email è registrata (anti user-enumeration).
        // Si distingue solo il caso "email non confermata", che non rivela l'esistenza dell'account
        // più di quanto già faccia il flusso di registrazione.
        const m = (err as Error).message || ''
        setError(/not confirmed|confirm|conferma/i.test(m)
          ? 'Devi confermare l\'email prima di accedere. Controlla la tua casella di posta.'
          : 'Email o password non corretti.')
      }
      else navigate('/')
    } else {
      const { error: err } = await signUp(email, password)
      if (err) setError(userMessage(err, 'Non è stato possibile completare la registrazione.'))
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
          <p className="text-sm text-slate-500">Gestisci le tue finanze personali</p>
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
              <p className="text-[13px] text-slate-500">Inserisci la tua email per ricevere il link di recupero</p>
            </div>
          )}

          {mode === 'recovery' && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 mb-1">Imposta nuova password</h2>
              <p className="text-[13px] text-slate-500">Scegli una nuova password per il tuo account</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'recovery' && (
              <div>
                <label htmlFor={emailId} className="block text-[13px] font-medium text-slate-600 mb-1.5">Email</label>
                <input id={emailId} type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow" required />
              </div>
            )}
            {mode !== 'reset' && (
              <div>
                <label htmlFor={passwordId} className="block text-[13px] font-medium text-slate-600 mb-1.5">{mode === 'recovery' ? 'Nuova password' : 'Password'}</label>
                <div className="relative">
                  <input id={passwordId} type={showPassword ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full min-w-0 px-3 py-2.5 pr-14 min-h-[44px] border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow" required minLength={mode === 'register' || mode === 'recovery' ? 6 : undefined} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? 'Nascondi password' : 'Mostra password'} className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {(mode === 'register' || mode === 'recovery') && <p className="text-xs text-slate-500 mt-1">Almeno 6 caratteri.</p>}
              </div>
            )}

            {/* aria-live: l'esito arriva DOPO l'invio, senza spostare il focus. Senza queste due
                regioni, con uno screen reader il modulo resta muto e sembra che non sia successo
                nulla. `alert` per l'errore (interrompe), `status` per la conferma (attende). */}
            <div role="alert" aria-live="assertive">
              {error && <p className="text-red-700 text-[13px] bg-red-50 p-2.5 rounded-lg">{error}</p>}
            </div>
            <div role="status" aria-live="polite">
              {success && <p className="text-emerald-700 text-[13px] bg-emerald-50 p-2.5 rounded-lg">{success}</p>}
            </div>

            {/* bg-brand: stesso gradiente del logo e della voce attiva nel menu. Prima era un
                gradiente scritto a mano, leggermente diverso da quello del marchio. */}
            <button type="submit" disabled={loading} className="w-full min-h-[44px] py-2.5 bg-brand text-white rounded-lg text-[13px] font-medium hover:brightness-110 shadow-sm shadow-indigo-600/25 disabled:opacity-50 disabled:pointer-events-none transition-all active:scale-[0.99]">
              {loading ? 'Attendere…' : mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : mode === 'recovery' ? 'Aggiorna password' : 'Invia Link'}
            </button>
          </form>

          {mode !== 'recovery' && (
            <div className="mt-4 text-center">
              {mode === 'reset' ? (
                <button onClick={() => switchMode('login')} className="inline-flex items-center justify-center min-h-[44px] px-2 text-[13px] text-blue-600 hover:text-blue-700 font-medium">
                  Torna al login
                </button>
              ) : (
                <button onClick={() => switchMode('reset')} className="inline-flex items-center justify-center min-h-[44px] px-2 text-[13px] text-slate-500 hover:text-slate-600 transition-colors">
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
