import { describe, it, expect } from 'vitest'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import type { RecurringExpense, Transaction } from '../types'

// Scenario reale che ha motivato questi test: GPL settimanale del mercoledì, periodo che parte
// martedì 14 lug. L'occorrenza di mer 15 lug è stata pagata lun 13 lug — stessa settimana
// (lun 13 – dom 19), ma il giorno PRIMA dell'inizio periodo. Senza la finestra di riconciliazione
// all'indietro il pagamento resta orfano: la dashboard mostra l'occorrenza come scaduta e i totali
// contano l'importo previsto di una spesa già sostenuta.

const PERIOD_START = new Date(2026, 6, 14) // mar 14 lug 2026
const PERIOD_END = new Date(2026, 7, 13)   // gio 13 ago 2026

function mkWeeklyExp(opts: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'gpl', user_id: 'u', name: 'GPL', amount: 30,
    frequency: 'weekly', day_of_month: null, day_of_week: 3, month_of_year: null,
    fund_id: null, fund_to_id: null, category: 'benzina',
    type: 'expense', is_active: true, auto_deduct: false,
    start_date: null, end_date: null, created_at: '',
    ...opts,
  }
}

function mkTx(opts: {
  id: string
  date: string
  amount: number
  description?: string
  recurring_expense_id?: string | null
  is_memo?: boolean
  planned_date?: string | null
}): Transaction {
  return {
    id: opts.id, user_id: 'u', type: 'expense',
    amount: opts.amount, description: opts.description ?? 'GPL',
    fund_id: null, fund_to_id: null, category: 'benzina', budget_id: null,
    recurring_expense_id: opts.recurring_expense_id ?? null,
    recurring_income_id: null,
    is_memo: opts.is_memo ?? false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, planned_date: opts.planned_date ?? null, created_at: '',
  }
}

function run(args: { actualTx?: Transaction[]; reconcileOnlyTx?: Transaction[]; exp?: RecurringExpense }) {
  return getPeriodBreakdown({
    startDate: PERIOD_START, endDate: PERIOD_END,
    recurringExpenses: [args.exp ?? mkWeeklyExp()], recurringIncome: [], weeklyBudgets: [], planned: [],
    excludedFundIds: [], fromToday: false,
    actualTx: args.actualTx ?? [], reconcileOnlyTx: args.reconcileOnlyTx,
    includeActualOneOffs: true,
  })
}

// Occorrenze GPL nel periodo: mer 15, 22, 29 lug, 5, 12 ago → 5 × 30 € = 150 € se nessuna è pagata.
const FULL_PROJECTION = 150

describe('riconciliazione a cavallo dell\'inizio periodo', () => {
  it('senza la finestra all\'indietro l\'occorrenza risulta non pagata (regressione da evitare)', () => {
    const out = run({ actualTx: [] })
    expect(totalsFromBreakdown(out).expenses).toBe(FULL_PROJECTION)
  })

  it('un pagamento del giorno prima aggancia l\'occorrenza della sua settimana', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 29, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    const gplItems = out.filter(i => i.description === 'GPL')
    // L'occorrenza del 15 non viene emessa: è coperta da una spesa di un ALTRO periodo.
    expect(gplItems.map(i => i.date)).not.toContain('2026-07-15')
    expect(gplItems).toHaveLength(4)
  })

  it('l\'occorrenza coperta da un movimento fuori periodo non pesa sui totali', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 29, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    // 4 occorrenze rimanenti × 30 €. NON 150 (occorrenza contata) né 179 (spesa del periodo scorso
    // ricontata qui): la spesa è già stata conteggiata nel periodo in cui è avvenuta.
    expect(totalsFromBreakdown(out).expenses).toBe(120)
  })

  it('i movimenti pre-periodo non vengono mai emessi come voci una tantum', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-02', amount: 99, description: 'Spesa vecchia' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    expect(out.some(i => i.description === 'Spesa vecchia')).toBe(false)
    expect(totalsFromBreakdown(out).expenses).toBe(FULL_PROJECTION)
  })

  it('un movimento troppo vecchio non aggancia nulla: la finestra fa da filtro', () => {
    // 6 lug è nella settimana 6–12, non in quella dell'occorrenza del 15 (13–19).
    const pre = [mkTx({ id: 't1', date: '2026-07-06', amount: 29, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    expect(totalsFromBreakdown(out).expenses).toBe(FULL_PROJECTION)
  })

  it('un pagamento DENTRO il periodo continua a contare col suo importo reale', () => {
    const tx = [mkTx({ id: 't1', date: '2026-07-15', amount: 28.1, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: tx })
    // 28,10 reale + 4 × 30 previsti.
    expect(totalsFromBreakdown(out).expenses).toBeCloseTo(148.1, 2)
  })

  it('una sola transazione pre-periodo copre una sola occorrenza', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 29, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    // Le altre quattro restano proiettate: nessun consumo multiplo dello stesso movimento.
    expect(out.filter(i => i.description === 'GPL')).toHaveLength(4)
  })
})

describe('ripiego per nome sui movimenti non collegati', () => {
  it('aggancia ignorando maiuscole e spazi', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 29, description: '  Gpl ', recurring_expense_id: null })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    expect(out.filter(i => i.description === 'GPL')).toHaveLength(4)
  })

  it('un nome diverso non aggancia', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 29, description: 'Benzina', recurring_expense_id: null })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    expect(totalsFromBreakdown(out).expenses).toBe(FULL_PROJECTION)
  })

  it('un movimento in-periodo assorbito per nome non viene contato due volte', () => {
    // Senza la guardia sui consumati, questo movimento conterebbe sia come occorrenza
    // riconciliata sia come voce "una tantum": 28 + 28 invece di 28.
    const tx = [mkTx({ id: 't1', date: '2026-07-15', amount: 28, description: 'gpl', recurring_expense_id: null })]
    const out = run({ actualTx: tx })
    expect(totalsFromBreakdown(out).expenses).toBe(148) // 28 reale + 4 × 30
    expect(out.filter(i => i.date === '2026-07-15')).toHaveLength(1)
  })

  it('i movimenti collegati hanno la precedenza sul ripiego per nome', () => {
    const tx = [
      mkTx({ id: 'linked', date: '2026-07-15', amount: 10, recurring_expense_id: 'gpl' }),
      mkTx({ id: 'named', date: '2026-07-15', amount: 99, description: 'GPL', recurring_expense_id: null }),
    ]
    const out = run({ actualTx: tx })
    const occ = out.find(i => i.date === '2026-07-15' && i.source === 'recurring_expense')
    expect(occ?.amount).toBe(10)
  })

  it('un memo a 0 pre-periodo continua a valere come "non avvenuta"', () => {
    const pre = [mkTx({ id: 't1', date: '2026-07-13', amount: 0, is_memo: true, recurring_expense_id: 'gpl' })]
    const out = run({ actualTx: [], reconcileOnlyTx: pre })
    expect(totalsFromBreakdown(out).expenses).toBe(120)
  })
})
