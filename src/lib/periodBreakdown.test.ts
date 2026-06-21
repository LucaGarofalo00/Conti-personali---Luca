import { describe, it, expect } from 'vitest'
import { addDays } from 'date-fns'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import { toDateString } from './utils'
import type { RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

function mkInc(id: string, opts: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id, user_id: 'u', name: 'Inc-' + id, amount: 1500,
    is_variable: false, frequency: 'monthly', day_of_month: 27, day_of_week: null,
    delay_days: 0, fund_id: null, is_active: true, start_date: null, end_date: null, created_at: '',
    ...opts,
  }
}
function mkExp(id: string, day: number, amount: number): RecurringExpense {
  return {
    id, user_id: 'u', name: 'Exp-' + id, amount,
    frequency: 'monthly', day_of_month: day, day_of_week: null, month_of_year: null,
    fund_id: null, fund_to_id: null, category: 'altro',
    type: 'expense', is_active: true, auto_deduct: false, start_date: null, end_date: null, created_at: '',
  }
}
function mkBudget(id: string, amount: number): WeeklyBudget {
  return { id, user_id: 'u', name: 'B-' + id, amount, fund_id: null, is_active: true, created_at: '' }
}
function mkPlanned(amount: number, type: 'income' | 'expense', date: string): Transaction {
  return {
    id: 'p-' + Math.random(), user_id: 'u', type, amount, description: 'plan ' + type,
    fund_id: null, fund_to_id: null, category: 'altro', budget_id: null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: true,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date, created_at: '',
  }
}
function mkActualTx(opts: {
  amount: number
  date: string
  recurring_income_id?: string
  recurring_expense_id?: string
  is_memo?: boolean
  planned_date?: string
}): Transaction {
  return {
    id: 'tx-' + Math.random(), user_id: 'u',
    type: opts.recurring_income_id ? 'income' : 'expense',
    amount: opts.amount, description: 'actual',
    fund_id: null, fund_to_id: null, category: 'altro', budget_id: null,
    recurring_expense_id: opts.recurring_expense_id ?? null,
    recurring_income_id: opts.recurring_income_id ?? null,
    is_memo: opts.is_memo ?? false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, planned_date: opts.planned_date ?? null, created_at: '',
  }
}

describe('getPeriodBreakdown - includes all source types', () => {
  it('returns recurring income on its day_of_month', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [mkInc('s', { day_of_month: 27 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const stipendi = out.filter(i => i.source === 'recurring_income')
    expect(stipendi).toHaveLength(1)
    expect(stipendi[0].date).toBe('2026-05-27')
    expect(stipendi[0].amount).toBe(1500)
  })

  it('returns weekly income with delay (Saturday + 2 = Monday)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2, amount: 50 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const sabati = out.filter(i => i.source === 'recurring_income')
    expect(sabati.length).toBeGreaterThan(0)
  })

  it('returns recurring expenses on their day_of_month', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [mkExp('aff', 1, 400)], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(1)
    expect(out[0].amount).toBe(400)
  })

  it('returns one weekly budget entry per Monday in the period', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [],
      weeklyBudgets: [mkBudget('sfizi', 50)], planned: [], excludedFundIds: [],
    })
    const sfizi = out.filter(i => i.source === 'weekly_budget')
    expect(sfizi.length).toBeGreaterThanOrEqual(4)
    expect(sfizi.every(i => i.amount === 50)).toBe(true)
  })

  it('returns planned only on their exact date', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [], recurringIncome: [],
      weeklyBudgets: [],
      planned: [mkPlanned(500, 'expense', '2026-06-05'), mkPlanned(200, 'income', '2026-05-20')],
      excludedFundIds: [],
    })
    const plannedItems = out.filter(i => i.source === 'planned')
    expect(plannedItems).toHaveLength(2)
  })

  it('skips inactive recurring', () => {
    const inactive = mkExp('inactive', 5, 999)
    inactive.is_active = false
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [inactive], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    expect(out).toHaveLength(0)
  })
})

describe('getPeriodBreakdown - expense start_date / end_date window', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('skips a recurring expense before its start_date', () => {
    const exp = mkExp('aff', 20, 400) // cade il 20 maggio
    exp.start_date = '2026-06-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })

  it('keeps a recurring expense on/after its start_date', () => {
    const exp = mkExp('aff', 20, 400)
    exp.start_date = '2026-05-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    const items = out.filter(i => i.source === 'recurring_expense')
    expect(items).toHaveLength(1)
    expect(items[0].date).toBe('2026-05-20')
  })

  it('skips a recurring expense after its end_date', () => {
    const exp = mkExp('aff', 20, 400)
    exp.end_date = '2026-05-01'
    const out = getPeriodBreakdown({ ...period, ...base, recurringExpenses: [exp] })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })
})

describe('totalsFromBreakdown', () => {
  it('correctly sums income and expenses separately', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [mkExp('a', 1, 400)],
      recurringIncome: [mkInc('s', { day_of_month: 27, amount: 1500 })],
      weeklyBudgets: [], planned: [], excludedFundIds: [],
    })
    const totals = totalsFromBreakdown(out)
    expect(totals.income).toBe(1500)
    expect(totals.expenses).toBe(400)
  })
})

describe('getPeriodBreakdown - reconciliation with actual transactions', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringExpenses: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('senza actualTx resta una pura proiezione', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const out = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] })
    const projected = out.filter(i => i.source === 'recurring_income')
    expect(projected.length).toBeGreaterThan(0)
    expect(totalsFromBreakdown(out).income).toBe(projected.length * 50)
  })

  it('un\'occorrenza settimanale segnata "non lavorato" (memo) non viene contata', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const projection = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] })
    const occurrences = projection.filter(i => i.source === 'recurring_income')
    const skipDate = occurrences[0].date // delay 0 → data emissione = data lavoro

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 0, date: skipDate, recurring_income_id: 'w', is_memo: true })],
    })
    const after = reconciled.filter(i => i.source === 'recurring_income')
    expect(after).toHaveLength(occurrences.length - 1)
    expect(after.some(i => i.date === skipDate)).toBe(false)
    expect(totalsFromBreakdown(reconciled).income).toBe((occurrences.length - 1) * 50)
  })

  it('un\'occorrenza confermata usa l\'importo effettivo, non quello previsto', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const occurrences = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] }).filter(i => i.source === 'recurring_income')
    const paidDate = occurrences[0].date

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 30, date: paidDate, recurring_income_id: 'w' })],
    })
    const item = reconciled.find(i => i.source === 'recurring_income' && i.date === paidDate)
    expect(item?.amount).toBe(30)
    expect(totalsFromBreakdown(reconciled).income).toBe((occurrences.length - 1) * 50 + 30)
  })

  it('riconcilia le entrate settimanali con ritardo usando la data di LAVORO', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, delay_days: 2, amount: 50 })
    const occurrences = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] }).filter(i => i.source === 'recurring_income')
    const emitDate = occurrences[0].date // data di pagamento (lavoro + 2)
    const workDate = toDateString(addDays(new Date(emitDate), -2))

    const reconciled = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 0, date: workDate, recurring_income_id: 'w', is_memo: true })],
    })
    const after = reconciled.filter(i => i.source === 'recurring_income')
    expect(after.some(i => i.date === emitDate)).toBe(false)
    expect(after).toHaveLength(occurrences.length - 1)
  })

  it('riconcilia anche le spese ricorrenti (importo effettivo e memo)', () => {
    const exp = mkExp('aff', 20, 400) // cade il 20 maggio
    const paid = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [], recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 380, date: '2026-05-20', recurring_expense_id: 'aff' })],
    })
    expect(paid.find(i => i.source === 'recurring_expense')?.amount).toBe(380)

    // memo CON importo: conta nei totali con l'importo effettivo (senza muovere i fondi)
    const memo = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [], recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 400, date: '2026-05-20', recurring_expense_id: 'aff', is_memo: true })],
    })
    expect(memo.find(i => i.source === 'recurring_expense')?.amount).toBe(400)

    // memo a 0 ("non avvenuto"): non conta
    const memoZero = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [], recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 0, date: '2026-05-20', recurring_expense_id: 'aff', is_memo: true })],
    })
    expect(memoZero.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })
})

describe('getPeriodBreakdown - exclusions', () => {
  it('skips items linked to excluded funds', () => {
    const exp = mkExp('a', 5, 100)
    exp.fund_id = 'savings'
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14),
      recurringExpenses: [exp], recurringIncome: [],
      weeklyBudgets: [], planned: [], excludedFundIds: ['savings'],
    })
    expect(out).toHaveLength(0)
  })
})

function mkOneOff(opts: {
  amount: number
  date: string
  type?: 'income' | 'expense' | 'transfer'
  budget_id?: string | null
  fund_id?: string | null
  is_memo?: boolean
}): Transaction {
  return {
    id: 'o-' + Math.random(), user_id: 'u',
    type: opts.type ?? 'expense',
    amount: opts.amount, description: 'manuale',
    fund_id: opts.fund_id ?? null, fund_to_id: null, category: 'cibo',
    budget_id: opts.budget_id ?? null,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: opts.is_memo ?? false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, created_at: '',
  }
}

describe('getPeriodBreakdown - includeActualOneOffs', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const empty = { recurringExpenses: [], recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('does NOT count manual one-offs by default (flag off)', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-20' })],
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(0)
  })

  it('counts a manual one-off expense when flag is on', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-20' })],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(1)
    expect(totalsFromBreakdown(out).expenses).toBe(30)
  })

  it('counts a manual one-off income when flag is on', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      actualTx: [mkOneOff({ amount: 100, date: '2026-05-20', type: 'income' })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(100)
  })

  it('excludes memo, transfer, CONSUMED recurring-linked and budget-linked transactions', () => {
    const out = getPeriodBreakdown({
      ...period, ...empty,
      // L'occorrenza del 20 riconcilia (consuma) il movimento legato sotto → niente voce one-off.
      recurringExpenses: [mkExp('x', 20, 10)],
      actualTx: [
        mkOneOff({ amount: 10, date: '2026-05-20', is_memo: true }),
        mkOneOff({ amount: 10, date: '2026-05-20', type: 'transfer' }),
        mkActualTx({ amount: 10, date: '2026-05-20', recurring_expense_id: 'x' }),
        mkOneOff({ amount: 10, date: '2026-05-20', budget_id: 'b' }),
      ],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
  })

  it('excludes one-offs outside the period and on excluded funds', () => {
    const out = getPeriodBreakdown({
      ...period, recurringExpenses: [], recurringIncome: [], weeklyBudgets: [], planned: [],
      excludedFundIds: ['savings'],
      actualTx: [
        mkOneOff({ amount: 30, date: '2026-07-01' }),
        mkOneOff({ amount: 30, date: '2026-05-20', fund_id: 'savings' }),
      ],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
  })

  it('does not double-count: reconciled recurring + manual one-off coexist', () => {
    const out = getPeriodBreakdown({
      ...period, recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [],
      recurringExpenses: [mkExp('aff', 20, 400)],
      actualTx: [
        mkActualTx({ amount: 380, date: '2026-05-20', recurring_expense_id: 'aff' }),
        mkOneOff({ amount: 30, date: '2026-05-21' }),
      ],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).expenses).toBe(410)
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(1)
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(1)
  })
})

describe('getPeriodBreakdown - budget conta la spesa reale', () => {
  // 2026-05-11 è lunedì: periodo di una sola settimana per isolare un budget.
  const period = { startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 17) }
  const base = { recurringExpenses: [], recurringIncome: [], planned: [], excludedFundIds: [] }
  const budget = mkBudget('sfizi', 50)

  it('settimana conclusa: conta lo speso reale, niente "Sforamento" separato', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 4, 25),
    })
    expect(totalsFromBreakdown(out).expenses).toBe(70)
    expect(totalsFromBreakdown(out).income).toBe(0)
    const budgetItems = out.filter(i => i.source === 'weekly_budget')
    expect(budgetItems).toHaveLength(1)
    expect(budgetItems[0].amount).toBe(70)
  })

  it('settimana con avanzo: nessuna entrata "Residuo", conta solo lo speso reale', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 4, 25),
    })
    expect(out.filter(i => i.kind === 'income')).toHaveLength(0)
    expect(totalsFromBreakdown(out).income).toBe(0)
    expect(totalsFromBreakdown(out).expenses).toBe(30)
  })

  it('settimana in corso SOTTO-spesa: usa la quota stimata, non lo speso parziale', () => {
    // Proiezione conservativa: finché la settimana non è chiusa, se ho speso MENO della quota si
    // assume di spendere comunque l'intero budget (max(quota, speso) = quota), così il "netto del
    // periodo" non risulta troppo ottimista a metà settimana.
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 4, 13),
    })
    expect(totalsFromBreakdown(out).expenses).toBe(50)
    expect(totalsFromBreakdown(out).income).toBe(0)
  })

  it('settimana in corso in SFORAMENTO: conta lo speso reale (max tra quota e speso)', () => {
    // Se a metà settimana ho già speso più della quota (70 > 50), il riepilogo deve riflettere
    // subito lo sforamento invece di restare inchiodato a 50 fino alla domenica.
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 4, 13),
    })
    const budgetItems = out.filter(i => i.source === 'weekly_budget')
    expect(budgetItems).toHaveLength(1)
    expect(budgetItems[0].amount).toBe(70)
    expect(totalsFromBreakdown(out).expenses).toBe(70)
    expect(totalsFromBreakdown(out).income).toBe(0)
  })

  it('settimana in corso + settimana futura: entrambe alla quota base (nessuna conclusa)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 24),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 4, 12),
    })
    // settimana dell'11 (in corso) e del 18 (futura): nessuna conclusa → quota 50 entrambe.
    const amounts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([50, 50])
    expect(totalsFromBreakdown(out).expenses).toBe(100)
  })

  it('senza il flag resta la quota fissa settimanale (pura proiezione)', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      now: new Date(2026, 4, 25),
    })
    expect(totalsFromBreakdown(out).expenses).toBe(50)
  })

  it('periodo che inizia a metà settimana: conta le spese budget della porzione iniziale (settimana a cavallo)', () => {
    // Periodo 18–21 giu 2026 (parte giovedì): la settimana lun 15 – dom 21 ha il lunedì PRIMA del
    // periodo. Le spese budget del 18–21 NON devono sparire dal riepilogo del periodo.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 60, date: '2026-06-19', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 5, 21),
    })
    const budgetItems = out.filter(i => i.source === 'weekly_budget')
    expect(budgetItems).toHaveLength(1)
    expect(budgetItems[0].amount).toBe(60)
    expect(budgetItems[0].date).toBe('2026-06-18')
    expect(totalsFromBreakdown(out).expenses).toBe(60)
  })

  it('settimana a cavallo CONCLUSA: NON conta le spese fatte prima dell\'inizio periodo', () => {
    // Speso il 16 giu (prima del periodo 18–21): appartiene al periodo precedente, non a questo.
    // Periodo concluso (now=25 giu) → la porzione conta solo lo speso reale dentro [18,22) = 0.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 40, date: '2026-06-16', budget_id: 'sfizi' })],
      includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 5, 25),
    })
    expect(out.filter(i => i.source === 'weekly_budget')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(0)
  })

  it('proration: la settimana tagliata dal confine del periodo si divide per i giorni', () => {
    // Periodo 18 giu – 14 lug, budget 50/sett, nessuna spesa reale (solo stima), now=19 giu (tutte
    // le settimane in corso/future). La quota si divide per i giorni di ogni settimana nel periodo:
    //   18–21 (4gg) = 50*4/7 = 28,57 · 22–28, 29–5, 6–12 (7gg) = 50 · 13–14 lug (2gg) = 50*2/7 = 14,29
    // Totale = 50 * 27/7 = 192,86.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      ...base, weeklyBudgets: [budget],
      actualTx: [], includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 5, 19),
    })
    const amts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount)
    expect(amts).toEqual([28.57, 50, 50, 50, 14.29])
    expect(totalsFromBreakdown(out).expenses).toBe(192.86)
  })

  it('proration con confine 14/15 sulla settimana 13–19: 2/7 in un periodo, 5/7 nell\'altro', () => {
    // 13 lug 2026 è lunedì. Settimana 13–19 lug. Confine al 14/15.
    // Periodo A finisce il 14 lug → porzione 13–14 (2gg) = 50*2/7 = 14,29.
    const a = getPeriodBreakdown({
      startDate: new Date(2026, 6, 1), endDate: new Date(2026, 6, 14),
      ...base, weeklyBudgets: [budget],
      actualTx: [], includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 6, 13),
    })
    const aWeek = a.filter(i => i.source === 'weekly_budget')
    expect(aWeek[aWeek.length - 1].amount).toBe(14.29)
    // Periodo B inizia il 15 lug → porzione 15–19 (5gg) = 50*5/7 = 35,71.
    const b = getPeriodBreakdown({
      startDate: new Date(2026, 6, 15), endDate: new Date(2026, 6, 31),
      ...base, weeklyBudgets: [budget],
      actualTx: [], includeActualOneOffs: true, reconcileBudgets: true, now: new Date(2026, 6, 15),
    })
    const bWeek = b.filter(i => i.source === 'weekly_budget')
    expect(bWeek[0].amount).toBe(35.71)
  })
})

describe('getPeriodBreakdown - budget come quota (home: includeActualOneOffs senza reconcileBudgets)', () => {
  // 2026-05-11 è lunedì: periodo di una sola settimana per isolare un budget.
  const period = { startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 17) }
  const base = { recurringExpenses: [], recurringIncome: [], planned: [], excludedFundIds: [] }
  const budget = mkBudget('sfizi', 50)

  it('conta la quota piena del budget (la previsione), non lo speso reale', () => {
    // La home usa includeActualOneOffs ma NON reconcileBudgets: il budget pesa come quota (50),
    // coerentemente col previsionale, anche se la settimana è iniziata e ho speso 70.
    const out = getPeriodBreakdown({
      ...period, ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      includeActualOneOffs: true, now: new Date(2026, 4, 25),
    })
    const budgetItems = out.filter(i => i.source === 'weekly_budget')
    expect(budgetItems).toHaveLength(1)
    expect(budgetItems[0].amount).toBe(50)
    // la transazione col budget_id NON viene contata come una tantum (no doppio conteggio)
    expect(out.filter(i => i.source === 'actual_oneoff')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(50)
  })
})

describe('getPeriodBreakdown - riconciliazione tollerante (stessa finestra)', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }
  const mkWeekly = (id: string, dayOfWeek: number, amount: number): RecurringExpense => ({
    id, user_id: 'u', name: id, amount,
    frequency: 'weekly', day_of_month: null, day_of_week: dayOfWeek, month_of_year: null,
    fund_id: null, fund_to_id: null, category: 'benzina',
    type: 'expense', is_active: true, auto_deduct: false, start_date: null, end_date: null, created_at: '',
  })

  it('spesa settimanale pagata in un altro giorno della stessa settimana → riconciliata con l\'importo reale', () => {
    // GPL ogni giovedì; occorrenza giovedì 28 mag pagata sabato 30 mag
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [mkWeekly('gpl', 4, 30)],
      actualTx: [mkActualTx({ amount: 30.08, date: '2026-05-30', recurring_expense_id: 'gpl' })],
      includeActualOneOffs: true,
    })
    expect(out.find(i => i.source === 'recurring_expense' && i.date === '2026-05-28')?.amount).toBe(30.08)
  })

  it('spesa mensile pagata il giorno dopo (stesso mese) → riconciliata', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [mkExp('benz', 29, 30)],
      actualTx: [mkActualTx({ amount: 30, date: '2026-05-30', recurring_expense_id: 'benz' })],
      includeActualOneOffs: true,
    })
    const occ = out.find(i => i.source === 'recurring_expense')
    expect(occ?.date).toBe('2026-05-29')
    expect(occ?.amount).toBe(30)
  })

  it('greedy: due transazioni in due settimane coprono due occorrenze distinte', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [mkWeekly('gpl', 4, 30)],
      actualTx: [
        mkActualTx({ amount: 34.21, date: '2026-05-21', recurring_expense_id: 'gpl' }),
        mkActualTx({ amount: 30.08, date: '2026-05-30', recurring_expense_id: 'gpl' }),
      ],
      includeActualOneOffs: true,
    })
    expect(out.find(i => i.date === '2026-05-21')?.amount).toBe(34.21)
    expect(out.find(i => i.date === '2026-05-28')?.amount).toBe(30.08)
    expect(out.find(i => i.date === '2026-06-04')?.amount).toBe(30) // occorrenza futura: resta stima
  })

  it('memo collegato nella finestra → occorrenza saltata (non contata)', () => {
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [mkWeekly('gpl', 4, 30)],
      actualTx: [mkActualTx({ amount: 0, date: '2026-05-30', recurring_expense_id: 'gpl', is_memo: true })],
      includeActualOneOffs: true,
    })
    // l'occorrenza di giovedì 28 (stessa settimana del memo) non viene emessa
    expect(out.some(i => i.source === 'recurring_expense' && i.date === '2026-05-28')).toBe(false)
  })

  it('aggancio per planned_date: spesa segnata in un\'ALTRA settimana resta legata all\'occorrenza', () => {
    // GPL giovedì 28 mag, ma segnata lunedì 1 giu (settimana diversa) con la data prevista.
    const tx = mkActualTx({ amount: 27, date: '2026-06-01', recurring_expense_id: 'gpl' })
    tx.planned_date = '2026-05-28'
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [mkWeekly('gpl', 4, 30)],
      actualTx: [tx], includeActualOneOffs: true,
    })
    // L'occorrenza del 28 è riconciliata con l'importo reale grazie a planned_date.
    expect(out.find(i => i.source === 'recurring_expense' && i.date === '2026-05-28')?.amount).toBe(27)
  })
})

describe('getPeriodBreakdown - excludeRealized (modalità previsionale)', () => {
  const period = { startDate: new Date(2026, 4, 15), endDate: new Date(2026, 5, 14) }
  const base = { recurringExpenses: [], recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [] }

  it('salta le occorrenze già realizzate (confermate): non le riproietta', () => {
    const exp = mkExp('aff', 20, 400)
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [exp],
      actualTx: [mkActualTx({ amount: 400, date: '2026-05-20', recurring_expense_id: 'aff' })],
      excludeRealized: true,
    })
    expect(out.filter(i => i.source === 'recurring_expense')).toHaveLength(0)
  })

  it('salta anche le occorrenze memo "non lavorato"', () => {
    const inc = mkInc('w', { frequency: 'weekly', day_of_month: null, day_of_week: 6, amount: 50 })
    const occ = getPeriodBreakdown({ ...period, ...base, recurringIncome: [inc] }).filter(i => i.source === 'recurring_income')
    const skipDate = occ[0].date
    const out = getPeriodBreakdown({
      ...period, ...base, recurringIncome: [inc],
      actualTx: [mkActualTx({ amount: 0, date: skipDate, recurring_income_id: 'w', is_memo: true })],
      excludeRealized: true,
    })
    const after = out.filter(i => i.source === 'recurring_income')
    expect(after).toHaveLength(occ.length - 1)
    expect(after.some(i => i.date === skipDate)).toBe(false)
  })

  it('senza match proietta normalmente l\'importo previsto (solo il pendente)', () => {
    const exp = mkExp('aff', 20, 400)
    const out = getPeriodBreakdown({
      ...period, ...base, recurringExpenses: [exp], actualTx: [], excludeRealized: true,
    })
    expect(out.find(i => i.source === 'recurring_expense')?.amount).toBe(400)
  })
})

describe('getPeriodBreakdown - budget previsionale (excludeRealized): residuo settimana in corso', () => {
  // now = mercoledì 13 mag 2026; la settimana in corso è lun 11 – dom 17. Nel previsionale lo speso
  // reale è già scontato dal saldo di partenza, quindi si proietta solo il residuo della quota.
  const now = new Date(2026, 4, 13)
  const base = { recurringExpenses: [], recurringIncome: [], planned: [], excludedFundIds: [] }
  const budget = mkBudget('sfizi', 50)

  it('settimana in corso SOTTO-spesa: proietta solo il residuo (quota − speso), datato a oggi', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 17),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 10, date: '2026-05-13', budget_id: 'sfizi' })],
      fromToday: true, excludeRealized: true, now,
    })
    const budgetItems = out.filter(i => i.source === 'weekly_budget')
    expect(budgetItems).toHaveLength(1)
    expect(budgetItems[0].amount).toBe(40)
    expect(budgetItems[0].date).toBe('2026-05-13')
  })

  it('settimana in corso in SFORAMENTO: nessun residuo (lo sforamento è già nel saldo, niente doppio conteggio)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 17),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 70, date: '2026-05-13', budget_id: 'sfizi' })],
      fromToday: true, excludeRealized: true, now,
    })
    expect(out.filter(i => i.source === 'weekly_budget')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(0)
  })

  it('settimana in corso (residuo) + settimana futura (quota piena)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 4, 11), endDate: new Date(2026, 4, 24),
      ...base, weeklyBudgets: [budget],
      actualTx: [mkOneOff({ amount: 30, date: '2026-05-13', budget_id: 'sfizi' })],
      fromToday: true, excludeRealized: true, now,
    })
    // residuo settimana in corso = 50−30 = 20; settimana futura (lun 18 mag) = quota piena 50
    const amounts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([20, 50])
  })
})

describe('getPeriodBreakdown - movimenti ricorrenti reali non agganciati restano visibili', () => {
  it('stipendio che AVVIA il periodo: occorrenza tipica (15) fuori dal periodo, accredito reale (18) dentro → contato', () => {
    // Stipendio tipico il 15, ma arrivato il 18 → periodo 18 giu – 14 lug. L'occorrenza del 15
    // (15 giu prima dell'inizio, 15 lug dopo la fine) NON è proiettata: l'accredito reale del 18
    // non deve sparire dalle entrate del periodo.
    const sal = mkInc('sal', { frequency: 'monthly', day_of_month: 15, day_of_week: null, amount: 1500 })
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      recurringExpenses: [], recurringIncome: [sal], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 1500, date: '2026-06-18', recurring_income_id: 'sal' })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(1500)
    expect(out.filter(i => i.kind === 'income')).toHaveLength(1)
  })

  it('NON conta due volte: se l\'occorrenza è nel periodo e viene riconciliata, niente voce extra', () => {
    // Stipendio il 20 (giorno tipico 20), periodo 18 giu – 14 lug: l'occorrenza del 20 giu è dentro
    // e si aggancia all'accredito reale → una sola entrata, con l'importo reale.
    const sal = mkInc('sal', { frequency: 'monthly', day_of_month: 20, day_of_week: null, amount: 1500 })
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      recurringExpenses: [], recurringIncome: [sal], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 1480, date: '2026-06-20', recurring_income_id: 'sal' })],
      includeActualOneOffs: true,
    })
    expect(out.filter(i => i.kind === 'income')).toHaveLength(1)
    expect(totalsFromBreakdown(out).income).toBe(1480)
  })

  it('periodo APERTO che scavalca il giorno tipico: niente doppio conteggio dello stipendio', () => {
    // Stipendio day 15, accredito reale il 18 giu (planned_date occorrenza di giugno = 15 giu).
    // Oggi è il 16 lug, nuovo stipendio non ancora arrivato → periodo esteso 18 giu – 16 lug:
    // l'occorrenza del 15 lug ora RIENTRA nel periodo (proiettata). L'accredito reale del 18 NON
    // deve sommarsi all'occorrenza proiettata: una sola entrata.
    const sal = mkInc('sal', { frequency: 'monthly', day_of_month: 15, day_of_week: null, amount: 1500 })
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 16),
      recurringExpenses: [], recurringIncome: [sal], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 1500, date: '2026-06-18', recurring_income_id: 'sal', planned_date: '2026-06-15' })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(1500)
  })

  it('stessa cosa sulle USCITE: periodo aperto, niente doppio conteggio della fissa', () => {
    const aff = mkExp('aff', 15, 200)
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 16),
      recurringExpenses: [aff], recurringIncome: [], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 200, date: '2026-07-16', recurring_expense_id: 'aff', planned_date: '2026-06-15' })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).expenses).toBe(200)
  })

  it('stipendio "segnato senza scalare" (memo>0) con occorrenza fuori periodo: contato nei totali', () => {
    const sal = mkInc('sal', { frequency: 'monthly', day_of_month: 15, day_of_week: null, amount: 1500 })
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      recurringExpenses: [], recurringIncome: [sal], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 1500, date: '2026-06-18', recurring_income_id: 'sal', is_memo: true })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(1500)
  })

  it('memo a importo 0 ("non avvenuto") con occorrenza fuori periodo: NON contato', () => {
    const sal = mkInc('sal', { frequency: 'monthly', day_of_month: 15, day_of_week: null, amount: 1500 })
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      recurringExpenses: [], recurringIncome: [sal], weeklyBudgets: [], planned: [], excludedFundIds: [],
      actualTx: [mkActualTx({ amount: 0, date: '2026-06-18', recurring_income_id: 'sal', is_memo: true })],
      includeActualOneOffs: true,
    })
    expect(totalsFromBreakdown(out).income).toBe(0)
  })
})
