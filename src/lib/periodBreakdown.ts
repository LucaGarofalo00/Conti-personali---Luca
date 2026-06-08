import { addDays, getDate, getDay, getDaysInMonth, startOfDay, isBefore, isAfter, isSameDay, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { toDateString } from './utils'
import { inSameRecurrenceWindow } from './recurrenceMatch'
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
  // Se true, i budget settimanali GIÀ INIZIATI vengono conteggiati per la spesa reale
  // effettiva (transazioni col budget_id) invece che per la quota fissa. Se false (default)
  // il budget conta SEMPRE come quota stimata, coerentemente col previsionale. Richiede actualTx.
  reconcileBudgets?: boolean
  // Modalità previsionale: se true, le occorrenze ricorrenti GIÀ realizzate (con una
  // transazione reale collegata, confermata o memo) NON vengono proiettate, perché il loro
  // effetto è già nel saldo di partenza (o, per i memo "non lavorato", non deve contare).
  // Solo le occorrenze ancora pendenti vengono stimate. Richiede actualTx.
  excludeRealized?: boolean
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
  const { startDate, endDate, recurringExpenses, recurringIncome, weeklyBudgets, planned, excludedFundIds, fromToday = false, actualTx, includeActualOneOffs = false, reconcileBudgets = false, excludeRealized = false, now } = args
  const excluded = new Set(excludedFundIds)
  const items: BreakdownItem[] = []
  const today = startOfDay(now ?? new Date())
  const lowerBound = fromToday && isAfter(today, startDate) ? today : startDate
  // Solo con reconcileBudgets attivo le settimane di budget GIÀ INIZIATE (passate o in corso)
  // vengono conteggiate per la spesa reale effettiva (vedi sotto), non per la quota fissa.
  // Altrimenti (default) il budget conta sempre come quota stimata, come nel previsionale.
  const reconcileBudgetWithActuals = reconcileBudgets && !!actualTx

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
  // L'aggancio preferisce la data PREVISTA (planned_date == data occorrenza): così una spesa
  // segnata giorni prima/dopo resta legata alla sua occorrenza anche se cade in un'altra
  // finestra. In assenza di planned_date (movimenti vecchi/manuali) si usa windowFn sulla data
  // effettiva: finestra (settimana/ciclo) per le normali, intervallo lavoro→pagamento per le
  // entrate settimanali con ritardo.
  const reconcile = (map: Map<string, Transaction[]>, recId: string, occDateStr: string, windowFn: (txDate: string) => boolean): Reconciled => {
    if (!actualTx) return null
    const arr = map.get(recId)
    if (!arr) return null
    const tx = arr.find(t => !consumedTxIds.has(t.id) && (t.planned_date ? t.planned_date === occDateStr : windowFn(t.date)))
    if (!tx) return null
    consumedTxIds.add(tx.id)
    // Memo con importo (es. "segnato senza scalare"): conta nei totali con l'importo effettivo
    // ma non muove i fondi. Memo a 0 (es. "non lavorato"/"non avvenuto"): non conta.
    if (tx.is_memo && Number(tx.amount) === 0) return 'skip'
    return { amount: Number(tx.amount) }
  }

  // Dato il risultato della riconciliazione e l'importo previsto, restituisce l'importo da
  // contare, oppure null se l'occorrenza non va emessa.
  //  - modalità previsionale (excludeRealized): si proietta SOLO il pendente (r === null).
  //  - modalità normale: si salta solo lo 'skip' (memo a 0); altrimenti importo reale o previsto.
  const resolveAmount = (r: Reconciled, plannedAmount: number): number | null => {
    if (excludeRealized) return r === null ? plannedAmount : null
    if (r === 'skip') return null
    return r ? r.amount : plannedAmount
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
          const r = reconcile(incomeByRec, inc.id, dateStr, d => inSameRecurrenceWindow(d, dateStr, 'monthly'))
          const amt = resolveAmount(r, Number(inc.amount))
          if (amt !== null) {
            items.push({
              date: dateStr, description: inc.name, amount: amt,
              kind: 'income', source: 'recurring_income', sourceLabel: SOURCE_LABELS.recurring_income,
            })
          }
        }
      } else if (inc.frequency === 'weekly' && inc.day_of_week !== null) {
        const delayDays = inc.delay_days || 0
        const baseDay = addDays(cursor, -delayDays)
        if (getDay(baseDay) === inc.day_of_week) {
          // L'entrata è contata nel periodo del pagamento (cursor = dateStr). La transazione
          // che la copre cade tra il giorno di lavoro (baseDay) e quello di pagamento (dateStr).
          const workStr = toDateString(baseDay)
          const r = reconcile(incomeByRec, inc.id, dateStr, d => d >= workStr && d <= dateStr)
          const amt = resolveAmount(r, Number(inc.amount))
          if (amt !== null) {
            items.push({
              date: dateStr, description: inc.name, amount: amt,
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
        const r = reconcile(expenseByRec, exp.id, dateStr, d => inSameRecurrenceWindow(d, dateStr, freq))
        const amt = resolveAmount(r, Number(exp.amount))
        if (amt !== null) {
          items.push({
            date: dateStr,
            description: exp.name + (freq === 'yearly' ? ' (annuale)' : ''),
            amount: amt,
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
        const range = `${format(cursor, 'd')}–${format(addDays(cursor, 6), 'd MMM', { locale: it })}`
        items.push({
          date: dateStr, description: `${b.name} (settimana ${range})`, amount: Number(b.amount),
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
  }

  // Budget: solo con reconcileBudgets, per ogni settimana GIÀ INIZIATA (passata o in corso)
  // conta la spesa reale effettiva al posto della quota fissa. Non esistono più voci "Residuo"
  // (entrata) né "Sforamento" (uscita): il budget riflette semplicemente i movimenti reali.
  // L'avanzo non speso non viene conteggiato come entrata (resta già nel saldo del fondo).
  if (reconcileBudgetWithActuals && actualTx) {
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
            const range = `${format(weekStart, 'd')}–${format(addDays(weekStart, 6), 'd MMM', { locale: it })}`
            items.push({
              date: wsStr, description: `${b.name} (speso ${range})`, amount: spent,
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
