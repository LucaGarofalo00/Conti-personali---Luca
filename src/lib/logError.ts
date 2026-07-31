// Gli errori di Supabase/PostgREST sono oggetti: passati direttamente a console.error
// finiscono come "[object Object]" e rendono impossibile la diagnosi. Questi helper ne
// estraggono i campi utili (message/code/details/hint).

export function describeError(err: unknown): string {
  if (err == null) return 'errore sconosciuto'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  const e = err as { message?: string; code?: string; details?: string; hint?: string }
  const parts = [e.message, e.code ? `code=${e.code}` : '', e.details, e.hint].filter(Boolean)
  return parts.length ? parts.join(' · ') : JSON.stringify(err)
}

export function logSupabaseError(label: string, err: unknown): void {
  console.error(label, describeError(err))
}

// Messaggi tipici di Supabase/PostgREST tradotti in italiano comprensibile. Quello che l'utente
// vedeva prima ("Failed to fetch", "Invalid login credentials", "duplicate key value violates
// unique constraint") è testo per sviluppatori: non dice cosa è successo né cosa fare.
const KNOWN: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed/i,
    'Nessuna connessione: controlla la rete e riprova.'],
  [/invalid login credentials/i, 'Email o password non corretti.'],
  [/email not confirmed/i, 'Devi prima confermare l\'email: controlla la posta.'],
  [/user already registered|already been registered/i, 'Esiste già un account con questa email.'],
  [/password should be at least (\d+)/i, 'La password deve avere almeno $1 caratteri.'],
  [/rate limit|too many requests/i, 'Troppi tentativi ravvicinati: riprova fra qualche minuto.'],
  [/duplicate key value/i, 'Questo elemento esiste già.'],
  [/violates foreign key constraint/i, 'Operazione non possibile: l\'elemento è collegato ad altri dati.'],
  [/jwt expired|invalid token|session.*expired/i, 'Sessione scaduta: accedi di nuovo.'],
]

/** Testo da mostrare all'utente per un errore qualsiasi. Il dettaglio tecnico resta in console. */
export function userMessage(err: unknown, fallback = 'Qualcosa è andato storto. Riprova.'): string {
  const raw = describeError(err)
  for (const [re, msg] of KNOWN) {
    const m = raw.match(re)
    if (m) return msg.replace('$1', m[1] ?? '')
  }
  return fallback
}
