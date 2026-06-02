import { addDays, getDate, getDay, getDaysInMonth, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns'
import { toDateString } from './utils'
import { inSameRecurrenceWindow, type Frequency } from './recurrenceMatch'
import type { RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

export type BreakdownSource =
  | 'recurring_income'
  | 'recurring_expense'
  | 'weekly_budget'
  | 'planned'
  | 'transfer'
  | 'actual'
  | 'actual_oneoff'

export interface BreakdownItem {
  date: string
  description: string
  amount: number
  kind: 'income' | 'expense'
  source: BreakdownSource
  sourceLabel: string
  category?: string
}

interface Args {
  startDate: Date
  endDate: Date
  recurringExpenses: RecurringExpense[]
  recurringIncome: RecurringIncome[]
  weeklyBudgets: WeeklyBudget[]
  planned: Transaction[]
  excludedFundIds: string[]
  fromToday?: boolean
  // Transazioni reali (non pianificate) del periodo, per riconciliare le occorrenze ricorrenti
  // con ciò che è davvero successo: se un'occorrenza è stata confermata si usa l'importo
  // effettivo, se è stata segnata come memo (es. "non lavorato") non viene contata.
  // Se omesso, il breakdown resta una pura proiezione (comportamento storico).
  actualTx?: Transaction[]
  // Se true, conta anche le transazioni "una tantum" davvero registrate nel periodo
  // (spese/entrate manuali non legate a ricorrenti, budget o pianificate). Serve alle
  // card della home perché riflettano SEMPRE ogni movimento reale. Richiede actualTx.
  includeActualOneOffs?: boolean
  // "Oggi" iniettabile per i test deterministici (default: data reale). Determina quali
  // settimane di budget sono "già finite" ai fini del residuo.
  now?: Date
}

const SOURCE_LABELS: Record<BreakdownSource, string> = {
  recurring_income: 'Entrata ricorrente',
  recurring_expense: 'Spesa ricorrente',
  weekly_budget: 'Budget settimanale',
  planned: 'Pianificata',
  transfer: 'Trasferimento',
  actual: 'Già avvenuta',
  actual_oneoff: 'Effettiva',
}

type Reconciled = { amount: number } | 'skip' | null

export function getPeriodBreakdown(args: Args): BreakdownItem[] {
  const { startDate, endDate, recurringExpenses, recurringIncome, weeklyBudgets, planned, excludedFundIds, fromToday = false, actualTx, includeActualOneOffs = false, now } = args
  const excluded = new Set(excludedFundIds)
  const items: BreakdownItem[] = []
  const today = startOfDay(now ?? new Date())
  const lowerBound = fromToday && isAfter(today, startDate) ? today : startDate
  // Con dati reali a disposizione, le settimane di budget GIÀ INIZIATE (passate o in corso)
  // vengono conteggiate per la spesa reale effettiva (vedi sotto), non per la quota fissa.
  // Le settimane future restano una stima a quota base.
  const reconcileBudgetWithActuals = includeActualOneOffs && !!actualTx

  // Transazioni reali collegate, raggruppate per ricorrente. La riconciliazione non avviene
  // più per data identica ma per "finestra" (settimana per le settimanali, mese per le
  // mensili/annuali): così un'occorrenza risulta pagata anche se il movimento cade in un
  // altro giorno della stessa settimana/mese. Ogni transazione viene assegnata ad al più
  // un'occorrenza (consumo greedy in ordine di data) per evitare doppi conteggi.
  const incomeByRec = new Map<string, Transaction[]>()
  const expenseByRec = new Map<string, Transaction[]>()
  if (actualTx) {
    for (const tx of actualTx) {
      if (tx.is_planned) continue
      if (tx.recurring_income_id) {
        const arr = incomeByRec.get(tx.recurring_income_id) || []
        arr.push(tx); incomeByRec.set(tx.recurring_income_id, arr)
      }
      if (tx.recurring_expense_id) {
        const arr = expenseByRec.get(tx.recurring_expense_id) || []
        arr.push(tx); expenseByRec.set(tx.recurring_expense_id, arr)
      }
    }
    const byDate = (a: Transaction, b: Transaction) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    for (const arr of incomeByRec.values()) arr.sort(byDate)
    for (const arr of expenseByRec.values()) arr.sort(byDate)
  }
  const consumedTxIds = new Set<string>()

  // null  → nessuna riconciliazione (usa l'importo previsto)
  // 'skip' → occorrenza gestita ma senza movimento reale (memo / "non lavorato"): non contare
  // {amount} → occorrenza confermata: usa l'importo effettivo
  const reconcile = (map: Map<string, Transaction[]>, recId: string, occDateStr: string, frequency: Frequency): Reconciled => {
    if (!actualTx) return null
    const arr = map.get(recId)
    if (!arr) return null
    const tx = arr.find(t => !consumedTxIds.has(t.id) && inSameRecurrenceWindow(t.date, occDateStr, frequency))
    if (!tx) return null
    consumedTxIds.add(tx.id)
    if (tx.is_memo) return 'skip'
    return { amount: Number(tx.amount) }
  }

  const cursor = new Date(lowerBound)
  while (!isAfter(cursor, endDate)) {
    const dom = getDate(cursor)
    const dim = getDaysInMonth(cursor)
    const dateStr = toDateString(cursor)

    for (const inc of recurringIncome) {
      if (!inc.is_active) continue
      if (inc.fund_id && excluded.has(inc.fund_id)) continue
      if (inc.start_date && dateStr < inc.start_date) continue
      if (inc.end_date && dateStr > inc.end_date) continue
      if (inc.frequency === 'monthly' && inc.day_of_month !== null) {
        const adjusted = Math.min(inc.day_of_month, dim)
        if (dom === adjusted) {
          const r = reconcile(incomeByRec, inc.id, dateStr, 'monthly')
          if (r !== 'skip') {
            items.push({
              date: dateStr, description: inc.name, amount: r ? r.amount : Number(inc.amount),
              kind: 'income', source: 'recurring_income', sourceLabel: SOURCE_LABELS.recurring_income,
            })
          }
        }
      } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
        const delayDays = inc.delay_days || 0
        const baseDay = addDays(cursor, -delayDays)
        if (getDay(baseDay) === inc.day_of_week) {
          const r = reconcile(incomeByRec, inc.id, toDateString(baseDay), 'weekly')
          if (r !== 'skip') {
            items.push({
              date: dateStr, description: inc.name, amount: r ? r.amount : Number(inc.amount),
              kind: 'income', source: 'recurring_income', sourceLabel: SOURCE_LABELS.recurring_income,
            })
          }
        }
      }
    }

    for (const exp of recurringExpenses) {
      if (!exp.is_active) continue
      if (exp.start_date && dateStr < exp.start_date) continue
      if (exp.end_date && isAfter(cursor, new Date(exp.end_date))) continue
      if ((exp.type || 'expense') === 'transfer') continue
      if (exp.fund_id && excluded.has(exp.fund_id)) continue
      const freq = exp.frequency || 'monthly'
      let occurs = false
      if (freq === 'monthly' && exp.day_of_month !== null) {
        const adjusted = Math.min(exp.day_of_month, dim)
        if (dom === adjusted) occurs = true
      } else if (freq === 'weekly' && exp.day_of_week !== null) {
        if (getDay(cursor) === exp.day_of_week) occurs = true
      } else if (freq === 'yearly' && exp.day_of_month !== null && exp.month_of_year !== null) {
        const adjusted = Math.min(exp.day_of_month, dim)
        if (dom === adjusted && cursor.getMonth() + 1 === exp.month_of_year) occurs = true
      }
      if (occurs) {
        const r = reconcile(expenseByRec, exp.id, dateStr, freq)
        if (r !== 'skip') {
          items.push({
            date: dateStr,
            description: exp.name + (freq === 'yearly' ? ' (annuale)' : ''),
            amount: r ? r.amount : Number(exp.amount),
            kind: 'expense',
            source: 'recurring_expense',
            sourceLabel: SOURCE_LABELS.recurring_expense,
            category: exp.category,
          })
        }
      }
    }

    for (const p of planned) {
      if (!p.is_planned) continue
      if (p.fund_id && excluded.has(p.fund_id)) continue
      if (p.type === 'transfer' && p.fund_to_id && excluded.has(p.fund_to_id)) continue
      const pDate = startOfDay(new Date(p.date))
      if (!isSameDay(pDate, cursor)) continue
      if (p.type === 'income') {
        items.push({
          date: dateStr, description: p.description || 'Pianificata',
          amount: Number(p.amount), kind: 'income', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
        })
      } else if (p.type === 'expense') {
        items.push({
          date: dateStr, description: p.description || 'Pianificata',
          amount: Number(p.amount), kind: 'expense', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
          category: p.category,
        })
      }
    }

    if (getDay(cursor) === 1 && !isBefore(cursor, startDate)) {
      for (const b of weeklyBudgets) {
        if (!b.is_active) continue
        if (b.fund_id && excluded.has(b.fund_id)) continue
        // Settimana già iniziata + dati reali: la conteggia la riconciliazione sotto (spesa reale).
        // Qui emetti la quota stimata solo per le settimane future.
        if (reconcileBudgetWithActuals && !isAfter(cursor, today)) continue
        items.push({
          date: dateStr, description: `${b.name} (settimana)`, amount: Number(b.amount),
          kind: 'expense', source: 'weekly_budget', sourceLabel: SOURCE_LABELS.weekly_budget,
        })
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  // Transazioni "una tantum" davvero registrate nel periodo: spese/entrate manuali che non
  // sono già rappresentate dalle regole proiettate. Escluse: memo, trasferimenti, quelle
  // legate a ricorrenti (già riconciliate sopra) e quelle dentro un budget (già coperte
  // dalla quota settimanale) — così non si conta due volte.
  if (includeActualOneOffs && actualTx) {
    const lowerStr = toDateString(lowerBound)
    const endStr = toDateString(endDate)
    for (const tx of actualTx) {
      if (tx.is_planned || tx.is_memo) continue
      if (tx.type === 'transfer') continue
      if (tx.recurring_income_id || tx.recurring_expense_id || tx.budget_id) continue
      if (tx.fund_id && excluded.has(tx.fund_id)) continue
      if (tx.date < lowerStr || tx.date > endStr) continue
      const kind = tx.type === 'income' ? 'income' : 'expense'
      items.push({
        date: tx.date,
        description: tx.description || (kind === 'income' ? 'Entrata' : 'Uscita'),
        amount: Number(tx.amount),
        kind,
        source: 'actual_oneoff',
        sourceLabel: SOURCE_LABELS.actual_oneoff,
        category: tx.category,
      })
    }

    // Budget: per ogni settimana GIÀ INIZIATA (passata o in corso) conta la spesa reale
    // effettiva al posto della quota fissa. Non esistono più voci "Residuo" (entrata) né
    // "Sforamento" (uscita): il budget riflette semplicemente i movimenti reali registrati.
    // L'avanzo non speso non viene conteggiato come entrata (resta già nel saldo del fondo).
    const budgetTx = actualTx.filter(t => !t.is_planned && !t.is_memo && t.budget_id)
    for (const b of weeklyBudgets) {
      if (!b.is_active) continue
      if (b.fund_id && excluded.has(b.fund_id)) continue
      const wcur = new Date(lowerBound)
      while (!isAfter(wcur, endDate)) {
        if (getDay(wcur) === 1 && !isBefore(wcur, startDate) && !isAfter(wcur, today)) {
          const weekStart = new Date(wcur)
          const weekEnd = addDays(weekStart, 7)
          const wsStr = toDateString(weekStart)
          const weStr = toDateString(weekEnd)
          let spent = 0
          for (const t of budgetTx) {
            if (t.budget_id === b.id && t.date >= wsStr && t.date < weStr) spent += Number(t.amount)
          }
          spent = Math.round(spent * 100) / 100
          if (spent > 0) {
            items.push({
              date: wsStr, description: `${b.name} (speso settimana)`, amount: spent,
              kind: 'expense', source: 'weekly_budget', sourceLabel: SOURCE_LABELS.weekly_budget,
            })
          }
        }
        wcur.setDate(wcur.getDate() + 1)
      }
    }
  }

  items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  return items
}

export function totalsFromBreakdown(items: BreakdownItem[]): { income: number; expenses: number } {
  let income = 0, expenses = 0
  for (const it of items) {
    if (it.kind === 'income') income += it.amount
    else expenses += it.amount
  }
  return { income: Math.round(income * 100) / 100, expenses: Math.round(expenses * 100) / 100 }
}
