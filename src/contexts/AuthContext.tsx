import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { loadPeriodSettings } from '../lib/periodSettingsDb'
import { resetPeriodSettings } from '../lib/periodSettings'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  // true quando l'utente è arrivato da un link di recupero password (evento PASSWORD_RECOVERY):
  // l'app mostra la schermata "Imposta nuova password" finché non viene aggiornata o si annulla.
  recovery: boolean
  clearRecovery: () => void
  signIn: (email: string, password: string) => Promise<{ error: unknown }>
  signUp: (email: string, password: string) => Promise<{ error: unknown }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    // Idrata le impostazioni del periodo PRIMA di togliere lo spinner, così le pagine protette
    // (Dashboard ecc.) calcolano subito il periodo corretto invece del default 15→14.
    const settle = async (s: Session | null) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        try { await loadPeriodSettings(s.user.id) } catch { /* tollerante: si resta sui default */ }
      } else {
        // Logout (o nessuna sessione): azzera lo store del periodo per non farlo ereditare a un
        // altro utente sullo stesso browser.
        resetPeriodSettings()
      }
      setLoading(false)
    }

    supabase.auth.getSession()
      .then(({ data: { session: s } }) => settle(s))
      // Se il recupero sessione fallisce (boot a freddo/offline) non lasciare lo spinner bloccato.
      .catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // Link di recupero password: Supabase stabilisce una sessione e segnala PASSWORD_RECOVERY.
      // Alziamo il flag così l'app mostra la schermata di cambio password invece della Dashboard.
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      void settle(s)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error }
  }

  const signOut = async () => {
    setRecovery(false)
    await supabase.auth.signOut()
  }

  const clearRecovery = () => setRecovery(false)

  return (
    <AuthContext.Provider value={{ user, session, loading, recovery, clearRecovery, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col provider (pattern intenzionale)
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
