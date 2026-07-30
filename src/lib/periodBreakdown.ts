import { addDays, getDate, getDay, getDaysInMonth, startOfDay, startOfWeek, isBefore, isAfter, isSameDay, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { toDateString, parseLocalDate } from './utils'
import { inSameRecurrenceWindow } from './recurrenceMatch'
import { plannedResidualAmount } from './plannedBudget'
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
  // Movimenti dei giorni PRECEDENTI l'inizio periodo, usabili SOLO per riconciliare le occorrenze:
  // non vengono mai emessi come voci né conteggiati come budget. Servono perché la finestra di
  // un'occorrenza a inizio periodo sconfina all'indietro (la settimana lun–dom di un'occorrenza di
  // mercoledì parte due giorni prima): senza questi, un rifornimento del lunedì con il confine di
  // periodo in mezzo resta orfano e l'occorrenza risulta non pagata pur essendolo.
  // Un'occorrenza agganciata a un movimento FUORI periodo vale 'skip': è soddisfatta, ma la spesa
  // è già stata contata nel periodo in cui è realmente avvenuta e qui non deve pesare.
  reconcileOnlyTx?: Transaction[]
  // Se true, conta anche le transazioni "una tantum" davvero registrate nel periodo
  // (spese/entrate manuali non legate a ricorrenti, budget o pianificate). Serve alle
  // card della home perché riflettano SEMPRE ogni movimento reale. Richiede actualTx.
  includeActualOneOffs?: boolean
  // Se true, i budget settimanali con la settimana GIÀ CONCLUSA (domenica passata) vengono
  // conteggiati per la spesa reale effettiva (transazioni col budget_id) invece che per la quota.
  // La settimana IN CORSO e quelle future restano alla quota stimata (proiezione conservativa: si
  // assume di spendere il budget finché la settimana non è chiusa). Se false (default) il budget
  // conta SEMPRE come quota fissa, coerentemente col previsionale. Richiede actualTx.
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
  const { startDate, endDate, recurringExpenses, recurringIncome, weeklyBudgets, planned, excludedFundIds, fromToday = false, actualTx, reconcileOnlyTx, includeActualOneOffs = false, reconcileBudgets = false, excludeRealized = false, now } = args
  const excluded = new Set(excludedFundIds)
  const items: BreakdownItem[] = []
  const today = startOfDay(now ?? new Date())
  const lowerBound = fromToday && isAfter(today, startDate) ? today : startDate
  // Solo con reconcileBudgets attivo le settimane di budget GIÀ INIZIATE (passate o in corso)
  // vengono conteggiate per la spesa reale effettiva (vedi sotto), non per la quota fissa.
  // Altrimenti (default) il budget conta sempre come quota stimata, come nel previsionale.
  const reconcileBudgetWithActuals = reconcileBudgets && !!actualTx
  // Modalità previsionale (excludeRealized) coi dati reali: lo speso della settimana in corso è
  // già scontato dal saldo di partenza, quindi il budget della settimana in corso non si proietta
  // alla quota piena ma solo al RESIDUO (vedi blocco dedicato in fondo). Le settimane future
  // restano alla quota.
  const excludeRealizedWithActuals = excludeRealized && !!actualTx

  // Transazioni reali collegate, raggruppate per ricorrente. La riconciliazione non avviene
  // più per data identica ma per "finestra" (settimana per le settimanali, mese per le
  // mensili/annuali): così un'occorrenza risulta pagata anche se il movimento cade in un
  // altro giorno della stessa settimana/mese. Ogni transazione viene assegnata ad al più
  // un'occorrenza (consumo greedy in ordine di data) per evitare doppi conteggi.
  const incomeByRec = new Map<string, Transaction[]>()
  const expenseByRec = new Map<string, Transaction[]>()
  // Ripiego per i movimenti NON collegati a una ricorrente (import, voci inserite a mano prima che
  // la ricorrente esistesse): si agganciano per NOME normalizzato — trim + minuscole, così "Gpl"
  // trova la ricorrente "GPL" — restando comunque vincolati alla finestra dell'occorrenza.
  // Stesso criterio già usato dalle "Prossime Scadenze" in dashboard: i due devono concordare,
  // altrimenti la lista dice "pagata" e i totali contano lo stesso l'importo previsto.
  const unlinkedExpenseByName = new Map<string, Transaction[]>()
  const normName = (s: string | null | undefined) => (s || '').trim().toLowerCase()
  const reconcilePool = [...(actualTx || []), ...(reconcileOnlyTx || [])]
  if (reconcilePool.length) {
    for (const tx of reconcilePool) {
      if (tx.is_planned) continue
      if (tx.recurring_income_id) {
        const arr = incomeByRec.get(tx.recurring_income_id) || []
        arr.push(tx); incomeByRec.set(tx.recurring_income_id, arr)
      }
      if (tx.recurring_expense_id) {
        const arr = expenseByRec.get(tx.recurring_expense_id) || []
        arr.push(tx); expenseByRec.set(tx.recurring_expense_id, arr)
      } else if (tx.type === 'expense' && !tx.budget_id) {
        const k = normName(tx.description)
        if (k) { const arr = unlinkedExpenseByName.get(k) || []; arr.push(tx); unlinkedExpenseByName.set(k, arr) }
      }
    }
    const byDate = (a: Transaction, b: Transaction) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    for (const arr of incomeByRec.values()) arr.sort(byDate)
    for (const arr of expenseByRec.values()) arr.sort(byDate)
    for (const arr of unlinkedExpenseByName.values()) arr.sort(byDate)
  }
  const consumedTxIds = new Set<string>()
  const periodStartStr = toDateString(startDate)
  const periodEndStr = toDateString(endDate)

  // Spese reali imputate a un budget settimanale (no memo, no pianificate): servono sia alla
  // riconciliazione delle settimane CONCLUSE (più sotto) sia a far emergere SUBITO un eventuale
  // sforamento della settimana IN CORSO nel loop principale (max tra quota e speso).
  const budgetTx = actualTx ? actualTx.filter(t => !t.is_planned && !t.is_memo && t.budget_id) : []

  // Id delle ricorrenti per cui ALMENO un'occorrenza è stata emessa (proiettata o riconciliata) nel
  // periodo. Serve al blocco "una tantum": un accredito/addebito reale legato a una ricorrente che
  // ha COMUNQUE una voce nel periodo NON va ricontato come one-off (evita il doppio conteggio nel
  // periodo aperto che scavalca il giorno tipico, dove l'occorrenza del mese dopo rientra).
  const emittedRecIds = new Set<string>()

  // null  → nessuna riconciliazione (usa l'importo previsto)
  // 'skip' → occorrenza gestita ma senza movimento reale (memo / "non lavorato"): non contare
  // {amount} → occorrenza confermata: usa l'importo effettivo
  // L'aggancio preferisce la data PREVISTA (planned_date == data occorrenza): così una spesa
  // segnata giorni prima/dopo resta legata alla sua occorrenza anche se cade in un'altra
  // finestra. In assenza di planned_date (movimenti vecchi/manuali) si usa windowFn sulla data
  // effettiva: finestra (settimana/ciclo) per le normali, intervallo lavoro→pagamento per le
  // entrate settimanali con ritardo.
  const reconcile = (
    map: Map<string, Transaction[]>,
    recId: string,
    occDateStr: string,
    windowFn: (txDate: string) => boolean,
    fallbackPool?: Transaction[],
  ): Reconciled => {
    if (!reconcilePool.length) return null
    const matches = (t: Transaction) =>
      !consumedTxIds.has(t.id) && (t.planned_date ? t.planned_date === occDateStr : windowFn(t.date))
    // Prima i movimenti COLLEGATI alla ricorrente; solo in loro assenza il ripiego per nome.
    const tx = (map.get(recId) || []).find(matches) || (fallbackPool || []).find(matches)
    if (!tx) return null
    consumedTxIds.add(tx.id)
    // Memo con importo (es. "segnato senza scalare"): conta nei totali con l'importo effettivo
    // ma non muove i fondi. Memo a 0 (es. "non lavorato"/"non avvenuto"): non conta.
    if (tx.is_memo && Number(tx.amount) === 0) return 'skip'
    // Movimento di un ALTRO periodo che soddisfa comunque questa occorrenza (finestra a cavallo del
    // confine): l'occorrenza è coperta, ma la spesa è già stata contata nel periodo in cui è
    // avvenuta — contarla di nuovo qui la conterebbe due volte.
    if (tx.date < periodStartStr || tx.date > periodEndStr) return 'skip'
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
            emittedRecIds.add(inc.id)
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
            emittedRecIds.add(inc.id)
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
      // end_date INCLUSIVO come stringa locale (coerente col ramo entrate sopra, niente shift UTC).
      if (exp.end_date && dateStr > exp.end_date) continue
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
        const r = reconcile(expenseByRec, exp.id, dateStr, d => inSameRecurrenceWindow(d, dateStr, freq), unlinkedExpenseByName.get(normName(exp.name)))
        const amt = resolveAmount(r, Number(exp.amount))
        if (amt !== null) {
          emittedRecIds.add(exp.id)
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
      const pDate = startOfDay(parseLocalDate(p.date))
      if (!isSameDay(pDate, cursor)) continue
      if (p.type === 'income') {
        items.push({
          date: dateStr, description: p.description || 'Pianificata',
          amount: Number(p.amount), kind: 'income', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
        })
      } else if (p.type === 'expense') {
        // Pianificata usata come budget a progetto: conta solo il RESIDUO, perché le spese già
        // agganciate entrano nei totali per conto proprio (blocco "una tantum" più sotto).
        // Residuo + speso = tetto, quindi la cifra del periodo non si muove mentre si spende.
        // Residuo 0 → tetto esaurito: la voce non si emette, contano solo le spese reali.
        const residual = plannedResidualAmount(p, actualTx || [])
        if (residual > 0) {
          items.push({
            date: dateStr, description: p.description || 'Pianificata',
            amount: residual, kind: 'expense', source: 'planned', sourceLabel: SOURCE_LABELS.planned,
            category: p.category,
          })
        }
      }
    }

    // Budget settimanali NON in modalità consuntivo: pura proiezione (nessun flag) e previsionale
    // (excludeRealized) emettono la quota PIENA sul lunedì. La modalità consuntivo (reconcileBudgets)
    // — con proration per giorni sui confini di periodo — è gestita dal blocco unificato dopo il loop.
    if (!reconcileBudgetWithActuals && getDay(cursor) === 1 && !isBefore(cursor, startDate)) {
      for (const b of weeklyBudgets) {
        if (!b.is_active) continue
        if (b.fund_id && excluded.has(b.fund_id)) continue
        // Previsionale: la settimana IN CORSO è gestita dal blocco "residuo" in fondo (il suo speso
        // è già nel saldo di partenza); qui il loop proietta solo le settimane FUTURE alla quota.
        if (excludeRealizedWithActuals && !isAfter(cursor, today) && isAfter(addDays(cursor, 7), today)) continue
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
  // sono già rappresentate dalle regole proiettate. Escluse: trasferimenti e quelle dentro un
  // budget (già coperte dalla quota settimanale) — così non si conta due volte.
  // Le transazioni legate a una ricorrente sono escluse SOLO se già AGGANCIATE a un'occorrenza
  // (consumedTxIds) o se la loro ricorrente ha COMUNQUE emesso un'occorrenza nel periodo
  // (emittedRecIds → evita il doppio conteggio nel periodo aperto che scavalca il giorno tipico).
  // Se invece il movimento reale NON è agganciato a nessuna occorrenza e la sua ricorrente non
  // ricorre affatto nel periodo (es. lo STIPENDIO che avvia il periodo: la sua occorrenza tipica —
  // il 15 — cade fuori dal periodo 18 giu – 14 lug), va contato qui, altrimenti sparirebbe pur
  // essendo un movimento reale del periodo. Per questi vale anche il MEMO con importo>0 ("segnato
  // senza scalare"): conta nei totali (come la riconciliazione delle occorrenze in-periodo).
  if (includeActualOneOffs && actualTx) {
    const lowerStr = toDateString(lowerBound)
    const endStr = toDateString(endDate)
    for (const tx of actualTx) {
      if (tx.is_planned) continue
      if (tx.type === 'transfer') continue
      if (tx.budget_id) continue
      const recId = tx.recurring_income_id || tx.recurring_expense_id || null
      // Consumata dalla riconciliazione → è GIÀ contata come occorrenza, qui la si conterebbe due
      // volte. Vale anche senza recurring_*_id: col ripiego per nome anche un movimento scollegato
      // può essere assorbito da un'occorrenza.
      if (consumedTxIds.has(tx.id)) continue
      if (recId && emittedRecIds.has(recId)) continue
      // Memo: contano solo quelli CON importo (>0) legati a una ricorrente non proiettata (es.
      // stipendio "segnato senza scalare" con occorrenza fuori periodo). Gli altri memo (manuali o
      // a importo 0 = "non avvenuto") non contano nei totali.
      if (tx.is_memo && !(recId && Number(tx.amount) !== 0)) continue
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

  // Budget settimanali — modalità CONSUNTIVO del periodo (reconcileBudgets). Ogni settimana (lun–dom)
  // che si sovrappone al periodo conta la quota PROPORZIONALE ai suoi giorni dentro il periodo
  // (giorni/7), così una settimana tagliata dal confine del periodo si divide correttamente tra i
  // due periodi (es. settimana 13–19 con confine al 15 → 2/7 nel periodo che finisce il 14, 5/7 in
  // quello che inizia il 15). Con i dati reali: porzione-in-periodo già CONCLUSA → spesa reale nella
  // porzione; porzione IN CORSO/FUTURA → max(quota proporzionale, speso) (lo sforamento emerge
  // subito; il sotto-speso resta alla quota proporzionale). Le spese col budget_id sono escluse
  // dalle voci "una tantum" (sopra), quindi qui non c'è doppio conteggio.
  if (reconcileBudgetWithActuals) {
    const periodEndExcl = addDays(endDate, 1)
    for (const b of weeklyBudgets) {
      if (!b.is_active) continue
      if (b.fund_id && excluded.has(b.fund_id)) continue
      const quota = Number(b.amount)
      let wMon = startOfWeek(lowerBound, { weekStartsOn: 1 })
      while (!isAfter(wMon, endDate)) {
        const wEndExcl = addDays(wMon, 7)
        // Sovrapposizione settimana ∩ periodo [lowerBound, endDate].
        const ovStart = isBefore(wMon, lowerBound) ? lowerBound : wMon
        const ovEndExcl = isBefore(wEndExcl, periodEndExcl) ? wEndExcl : periodEndExcl
        const ovDays = Math.round((ovEndExcl.getTime() - ovStart.getTime()) / 86_400_000)
        if (ovDays > 0) {
          const proratedQuota = Math.round(quota * ovDays / 7 * 100) / 100
          const ovStartStr = toDateString(ovStart)
          const ovEndStr = toDateString(ovEndExcl)
          let spent = 0
          for (const t of budgetTx) {
            if (t.budget_id === b.id && t.date >= ovStartStr && t.date < ovEndStr) spent += Number(t.amount)
          }
          spent = Math.round(spent * 100) / 100
          // Porzione-in-periodo interamente conclusa (ultimo giorno < oggi) → spesa reale; altrimenti
          // (in corso/futura) max tra quota proporzionale e speso.
          const concluded = !isAfter(ovEndExcl, today)
          const amount = concluded ? spent : Math.max(proratedQuota, spent)
          if (amount > 0) {
            const range = `${format(ovStart, 'd')}–${format(addDays(ovEndExcl, -1), 'd MMM', { locale: it })}`
            items.push({
              date: ovStartStr, description: `${b.name} (${range})`, amount,
              kind: 'expense', source: 'weekly_budget', sourceLabel: SOURCE_LABELS.weekly_budget,
            })
          }
        }
        wMon = addDays(wMon, 7)
      }
    }
  }

  // Previsionale (excludeRealized): la settimana IN CORSO ha lo speso reale già scontato dal saldo
  // di partenza, quindi qui si proietta solo il RESIDUO della quota: max(0, quota − speso). Se ho
  // speso MENO della quota assumo di arrivare alla quota (proiezione conservativa); se ho già
  // SFORATO il residuo è 0 (lo sforamento è già nel saldo → niente da aggiungere, niente doppio
  // conteggio). Emesso una sola volta, sul segmento che contiene "oggi" (datato a oggi).
  if (excludeRealizedWithActuals && actualTx && !isBefore(today, lowerBound) && !isAfter(today, endDate)) {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 })
    const wsStr = toDateString(weekStart)
    const weStr = toDateString(addDays(weekStart, 7))
    const todayStr = toDateString(today)
    for (const b of weeklyBudgets) {
      if (!b.is_active) continue
      if (b.fund_id && excluded.has(b.fund_id)) continue
      let spent = 0
      for (const t of budgetTx) {
        if (t.budget_id === b.id && t.date >= wsStr && t.date < weStr) spent += Number(t.amount)
      }
      const residual = Math.round((Number(b.amount) - spent) * 100) / 100
      if (residual > 0) {
        const range = `${format(weekStart, 'd')}–${format(addDays(weekStart, 6), 'd MMM', { locale: it })}`
        items.push({
          date: todayStr, description: `${b.name} (resto settimana ${range})`, amount: residual,
          kind: 'expense', source: 'weekly_budget', sourceLabel: SOURCE_LABELS.weekly_budget,
        })
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
