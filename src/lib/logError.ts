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
