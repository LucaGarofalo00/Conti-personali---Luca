import { startOfWeek } from 'date-fns'
import { getBillingPeriodFor } from './utils'

export type Frequency = 'monthly' | 'weekly' | 'yearly'

// Converte una stringa 'YYYY-MM-DD' in Date locale a mezzanotte, senza shift di fuso orario
// (new Date('YYYY-MM-DD') sarebbe interpretata come UTC).
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Vero se la data di una transazione cade nella stessa "finestra" del giorno previsto di
// un'occorrenza ricorrente, secondo la frequenza:
//  - weekly  → stessa settimana (lunedì→domenica)
//  - monthly → stesso ciclo di fatturazione 15→14 (NON il mese solare: così una spesa del 29
//              pagata il 1° del mese dopo resta nello stesso ciclo e viene comunque agganciata)
//  - yearly  → stesso mese e anno
// Serve a considerare "pagata" un'occorrenza anche quando il movimento reale non cade
// esattamente nel giorno previsto (es. GPL del giovedì pagato di sabato, benzina del 29
// pagata il 30): l'aggancio non richiede più la data identica.
export function inSameRecurrenceWindow(txDateStr: string, occurrenceDateStr: string, frequency: Frequency): boolean {
  if (frequency === 'weekly') {
    const tx = parseLocalDate(txDateStr)
    const occ = parseLocalDate(occurrenceDateStr)
    return startOfWeek(tx, { weekStartsOn: 1 }).getTime() === startOfWeek(occ, { weekStartsOn: 1 }).getTime()
  }
  if (frequency === 'yearly') {
    const tx = parseLocalDate(txDateStr)
    const occ = parseLocalDate(occurrenceDateStr)
    return tx.getFullYear() === occ.getFullYear() && tx.getMonth() === occ.getMonth()
  }
  // monthly → stesso ciclo 15→14 dell'occorrenza (confronto fra stringhe 'YYYY-MM-DD', no fuso)
  const { start, end } = getBillingPeriodFor(parseLocalDate(occurrenceDateStr))
  const txStr = txDateStr.slice(0, 10)
  return txStr >= start && txStr <= end
}
