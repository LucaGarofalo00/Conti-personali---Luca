import { useEffect, useRef, useSyncExternalStore } from 'react'
import { todayString } from './utils'

// Stato della connessione e rinfresco dei dati al ritorno dell'app in primo piano.
// FinanzApp è una PWA installabile: sul telefono resta aperta per giorni in secondo piano, e alla
// riapertura mostrava i dati del momento in cui era stata lasciata — comprese "Prossime scadenze"
// calcolate su una data ormai passata.

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

// navigator.onLine dice solo se esiste un'interfaccia di rete, non se il server risponde: è quindi
// affidabile sul NEGATIVO (false ⇒ sicuramente offline) e ottimista sul positivo. Lo usiamo per
// spiegare un errore, mai per impedire un tentativo.
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true)
}

// Errore di rete "grezzo": fetch fallita, DNS, timeout. I messaggi di supabase-js in questi casi
// sono in inglese e tecnici ("Failed to fetch", "NetworkError when attempting to fetch resource").
export function isNetworkError(err: unknown): boolean {
  if (!isOnline()) return true
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: string })?.message
  return !!msg && /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)
}

/**
 * Richiama `onResume` quando l'app torna visibile dopo essere stata in secondo piano per almeno
 * `minHiddenMs`, oppure quando nel frattempo è cambiato il giorno (scadenze, "oggi", periodo).
 * La soglia evita di ricaricare per ogni cambio di scheda momentaneo.
 */
export function useRefreshOnResume(onResume: () => void, minHiddenMs = 60_000): void {
  // Ref sulla callback: l'effect si registra una volta sola e non si riaggancia a ogni render
  // (le funzioni `load` delle pagine sono ricreate a ogni render).
  const cbRef = useRef(onResume)
  useEffect(() => { cbRef.current = onResume }, [onResume])

  useEffect(() => {
    let hiddenAt: number | null = null
    let lastDay = todayString()

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      const today = todayString()
      const dayChanged = today !== lastDay
      const wasAway = hiddenAt !== null && Date.now() - hiddenAt >= minHiddenMs
      lastDay = today
      hiddenAt = null
      if (dayChanged || wasAway) cbRef.current()
    }

    // Tornata la rete dopo un errore di caricamento: ritenta senza che l'utente debba ricaricare.
    const onOnline = () => cbRef.current()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [minHiddenMs])
}
