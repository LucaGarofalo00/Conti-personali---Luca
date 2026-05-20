import { addDays, isSameDay } from 'date-fns'
import { toDateString, getBillingPeriodFor } from './utils'
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
  return d instanceof Date ? d : new Date(d)
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
        const matching = findMatch(periodTx, inc.id, workStr)
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
      const cursor = new Date(periodStart)
      while (cursor <= periodEnd) {
        if (cursor.getDay() === inc.day_of_week) {
          const workDate = new Date(cursor)
          const paymentDate = addDays(workDate, delay)
          const workStr = toDateString(workDate)
          const inRange = (!inc.start_date || workStr >= inc.start_date) && (!inc.end_date || workStr <= inc.end_date)
          if (inRange) {
            const matching = findMatch(periodTx, inc.id, workStr)
            out.push({
              income: inc,
              workDate,
              workDateStr: workStr,
              paymentDate,
              paymentDateStr: toDateString(paymentDate),
              status: classify(matching),
              matchingTx: matching,
            })
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

function findMatch(periodTx: Transaction[], incomeId: string, dateStr: string): Transaction | undefined {
  return periodTx.find(tx => tx.recurring_income_id === incomeId && tx.date === dateStr)
}

function classify(tx: Transaction | undefined): OccurrenceStatus {
  if (!tx) return 'pending'
  if (tx.is_memo) return 'skipped'
  return 'paid'
}

export function getOccurrencesForPeriodOf(date: Date, income: RecurringIncome[], periodTx: Transaction[]): IncomeOccurrence[] {
  const { startDate, endDate } = getBillingPeriodFor(date)
  return generateIncomeOccurrences(income, startDate, endDate, periodTx)
}

export function _isSameDay(a: Date, b: Date): boolean {
  return isSameDay(a, b)
}
