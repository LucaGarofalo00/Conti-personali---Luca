import { addDays } from 'date-fns'
import { toDateString } from './utils'
import { inSameRecurrenceWindow } from './recurrenceMatch'
import type { RecurringIncome, Transaction } from '../types'

export type OccurrenceStatus = 'pending' | 'paid' | 'skipped'

export interface IncomeOccurrence {
  income: RecurringIncome
  workDate: Date
  workDateStr: string
  paymentDate: Date
  paymentDateStr: string
  status: OccurrenceStatus
  matchingTx?: Transaction
}

function ensureDate(d: Date | string): Date {
  if (d instanceof Date) return d
  // Parsa 'YYYY-MM-DD' come data LOCALE: new Date(stringa) la interpreterebbe come UTC,
  // con uno shift di fuso che può escludere l'occorrenza del primo giorno del periodo
  // (es. lo stipendio del 15, che è anche l'inizio del ciclo 15→14).
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function generateIncomeOccurrences(
  income: RecurringIncome[],
  periodStartIn: Date | string,
  periodEndIn: Date | string,
  periodTx: Transaction[]
): IncomeOccurrence[] {
  const periodStart = ensureDate(periodStartIn)
  const periodEnd = ensureDate(periodEndIn)
  const out: IncomeOccurrence[] = []
  // Ogni transazione reale viene assegnata ad al più un'occorrenza (consumo greedy),
  // così l'aggancio per finestra non marca "ricevuta" più occorrenze con lo stesso movimento.
  const consumed = new Set<string>()

  for (const inc of income) {
    if (!inc.is_active) continue

    if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
      const candidates: Date[] = []
      const sm = periodStart.getMonth(), sy = periodStart.getFullYear()
      candidates.push(new Date(sy, sm, Math.min(inc.day_of_month, daysInMonth(sy, sm))))
      const em = periodEnd.getMonth(), ey = periodEnd.getFullYear()
      if (em !== sm || ey !== sy) {
        candidates.push(new Date(ey, em, Math.min(inc.day_of_month, daysInMonth(ey, em))))
      }
      for (const workDate of candidates) {
        if (workDate < periodStart || workDate > periodEnd) continue
        const workStr = toDateString(workDate)
        if (inc.start_date && workStr < inc.start_date) continue
        if (inc.end_date && workStr > inc.end_date) continue
        const matching = findMatch(periodTx, inc.id, workStr, d => inSameRecurrenceWindow(d, workStr, 'monthly'), consumed)
        out.push({
          income: inc,
          workDate,
          workDateStr: workStr,
          paymentDate: workDate,
          paymentDateStr: workStr,
          status: classify(matching),
          matchingTx: matching,
        })
      }
    } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
      const delay = inc.delay_days || 0
      // L'occorrenza appartiene al periodo in cui cade il PAGAMENTO (lavoro + delay), non il
      // giorno di lavoro: così un sabato lavorato a fine periodo ma pagato dopo il 15 compare
      // nel periodo successivo. Il lavoro può quindi precedere l'inizio periodo di `delay` giorni.
      const cursor = addDays(periodStart, -delay)
      while (cursor <= periodEnd) {
        if (cursor.getDay() === inc.day_of_week) {
          const workDate = new Date(cursor)
          const paymentDate = addDays(workDate, delay)
          if (paymentDate >= periodStart && paymentDate <= periodEnd) {
            const workStr = toDateString(workDate)
            const payStr = toDateString(paymentDate)
            const inRange = (!inc.start_date || workStr >= inc.start_date) && (!inc.end_date || workStr <= inc.end_date)
            if (inRange) {
              // La transazione che copre l'occorrenza cade tra il giorno di lavoro e quello di
              // pagamento (gestisce sia le nuove tx datate al pagamento sia quelle al lavoro).
              const matching = findMatch(periodTx, inc.id, payStr, d => d >= workStr && d <= payStr, consumed)
              out.push({
                income: inc,
                workDate,
                workDateStr: workStr,
                paymentDate,
                paymentDateStr: payStr,
                status: classify(matching),
                matchingTx: matching,
              })
            }
          }
          cursor.setDate(cursor.getDate() + 7)
        } else {
          cursor.setDate(cursor.getDate() + 1)
        }
      }
    }
  }

  out.sort((a, b) => a.workDate.getTime() - b.workDate.getTime())
  return out
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate()
}

function findMatch(
  periodTx: Transaction[],
  incomeId: string,
  occDateStr: string,
  windowFn: (txDate: string) => boolean,
  consumed: Set<string>,
): Transaction | undefined {
  // Preferisce la data prevista (planned_date) per agganciare l'occorrenza giusta anche se
  // l'entrata è stata segnata in un giorno diverso; in assenza, ricade sulla finestra.
  const tx = periodTx
    .filter(t => t.recurring_income_id === incomeId && !consumed.has(t.id))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    .find(t => t.planned_date ? t.planned_date === occDateStr : windowFn(t.date))
  if (tx) consumed.add(tx.id)
  return tx
}

function classify(tx: Transaction | undefined): OccurrenceStatus {
  if (!tx) return 'pending'
  // memo con importo = ricevuto/pagato ma senza accredito su un fondo (conta nei totali);
  // memo a 0 = "non lavorato"/"non avvenuto" (non conta).
  if (tx.is_memo) return Number(tx.amount) > 0 ? 'paid' : 'skipped'
  return 'paid'
}
