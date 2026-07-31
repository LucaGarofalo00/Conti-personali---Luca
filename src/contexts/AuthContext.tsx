import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
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
    // Ultimo utente idratato: evita di rifare la fetch delle impostazioni a ogni refresh del token.
    let hydratedFor: string | null = null

    const settle = async (s: Session | null) => {
      setSession(s)
      // IDENTITÀ STABILE: supabase-js emette TOKEN_REFRESHED (periodicamente e al ritorno in primo
      // piano) con un oggetto `user` NUOVO ma equivalente. Sostituirlo farebbe scattare
      // `useEffect(..., [user])` in ogni pagina, che rilancia tutte le query e riporta la vista a
      // "caricamento" perdendo scroll e modali aperti. Se l'id non cambia, teniamo l'oggetto di prima.
      const nextUser = s?.user ?? null
      setUser(prev => (prev?.id === nextUser?.id ? prev : nextUser))
      if (s?.user) {
        if (hydratedFor !== s.user.id) {
          hydratedFor = s.user.id
          try { await loadPeriodSettings(s.user.id) } catch { /* tollerante: si resta sui default */ }
        }
      } else {
        hydratedFor = null
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

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    setRecovery(false)
    await supabase.auth.signOut()
  }, [])

  const clearRecovery = useCallback(() => setRecovery(false), [])

  // Valore memoizzato: un oggetto nuovo a ogni render propagherebbe un aggiornamento a tutti i
  // consumatori di useAuth anche quando utente e sessione sono immutati.
  const value = useMemo(
    () => ({ user, session, loading, recovery, clearRecovery, signIn, signUp, signOut }),
    [user, session, loading, recovery, clearRecovery, signIn, signUp, signOut],
  )

  return (
    <AuthContext.Provider value={value}>
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
