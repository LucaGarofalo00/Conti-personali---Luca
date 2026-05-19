import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'register' | 'reset'

export default function Auth() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const switchMode = (m: Mode) => { setMode(m); setError(''); setSuccess('') }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center text-indigo-600 mb-1">FinanzApp</h1>
        <p className="text-center text-slate-500 mb-6 text-sm">Gestisci le tue finanze personali</p>

        {mode !== 'reset' && (
          <div className="flex mb-6 bg-slate-100 rounded-lg p-1">
            <button onClick={() => switchMode('login')} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === 'login' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
              Accedi
            </button>
            <button onClick={() => switchMode('register')} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === 'register' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
              Registrati
            </button>
          </div>
        )}

        {mode === 'reset' && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Recupera Password</h2>
            <p className="text-sm text-slate-500">Inserisci la tua email per ricevere il link di recupero</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" required />
          </div>
          {mode !== 'reset' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" required minLength={6} />
            </div>
          )}

          {error && <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">{error}</p>}
          {success && <p className="text-emerald-600 text-sm bg-emerald-50 p-2 rounded-lg">{success}</p>}

          <button type="submit" disabled={loading} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {loading ? 'Caricamento...' : mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia Link'}
          </button>
        </form>

        <div className="mt-4 text-center">
          {mode === 'reset' ? (
            <button onClick={() => switchMode('login')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              Torna al login
            </button>
          ) : (
            <button onClick={() => switchMode('reset')} className="text-sm text-slate-500 hover:text-indigo-600">
              Password dimenticata?
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
