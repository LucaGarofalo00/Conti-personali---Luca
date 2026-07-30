import { parseLocalDate } from './utils'

// Entro quanti giorni una scadenza futura viene evidenziata come "in scadenza".
export const DUE_SOON_DAYS = 3

export type DueStatus = 'overdue' | 'today' | 'soon' | 'upcoming'

// Differenza in GIORNI DI CALENDARIO tra due 'YYYY-MM-DD'. Parse locale (parseLocalDate) e non
// aritmetica su Date "vive": così l'ora corrente non fa slittare il conteggio di un giorno, e
// nemmeno il passaggio all'ora legale (che sposterebbe il delta in ms di ±1h).
export function daysBetween(fromStr: string, toStr: string): number {
  return Math.round((parseLocalDate(toStr).getTime() - parseLocalDate(fromStr).getTime()) / 86_400_000)
}

// Stato di una scadenza rispetto a oggi. Una data mancante non è mai "scaduta": senza giorno
// previsto non c'è nulla da confrontare, quindi resta neutra ('upcoming', nessun badge).
export function dueStatusOf(occurrenceDate: string | undefined | null, todayStr: string): DueStatus {
  if (!occurrenceDate) return 'upcoming'
  const d = daysBetween(todayStr, occurrenceDate)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  return d <= DUE_SOON_DAYS ? 'soon' : 'upcoming'
}

// Testo del badge. null = nessun badge (voce ancora lontana o senza data prevista).
export function dueBadgeText(
  status: DueStatus,
  occurrenceDate: string | undefined | null,
  todayStr: string,
): string | null {
  if (!occurrenceDate || status === 'upcoming') return null
  const d = daysBetween(todayStr, occurrenceDate)
  if (status === 'overdue') return d === -1 ? 'Scaduto ieri' : `Scaduto da ${-d} giorni`
  if (status === 'today') return 'Scade oggi'
  return d === 1 ? 'Scade domani' : `Scade tra ${d} giorni`
}
