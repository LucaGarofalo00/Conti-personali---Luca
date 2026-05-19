import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { RecurringExpense, Transaction } from '../types'

vi.mock('./supabase', () => {
  type Row = Record<string, unknown>
  const tables: Record<string, Row[]> = { transactions: [], funds: [] }

  const reset = () => { tables.transactions = []; tables.funds = [] }

  const builder = (name: string): {
    insert: (values: Row) => { select: () => { single: () => Promise<{ data: Row; error: null }> }; then?: undefined }
    update: (values: Row) => { eq: (col: string, val: unknown) => Promise<{ error: null }> }
    select: (cols?: string) => unknown
  } => ({
    insert: (values: Row) => {
      const row = { id: 'tx-' + Math.random().toString(36).slice(2, 9), ...values }
      tables[name].push(row)
      return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
    },
    update: (values: Row) => ({
      eq: async (col: string, val: unknown) => {
        for (const row of tables[name]) {
          if (row[col] === val) Object.assign(row, values)
        }
        return { error: null }
      },
    }),
    select: () => {
      const state = { col: '', val: undefined as unknown }
      const api = {
        eq(col: string, val: unknown) { state.col = col; state.val = val; return api },
        async single() {
          const row = tables[name].find(r => r[state.col] === state.val)
          return { data: row || null, error: null }
        },
      }
      return api
    },
  })

  return {
    supabase: { from: (name: string) => builder(name) },
    __mock__: { tables, reset },
  }
})

import { processAutoDeducts } from './autoDeduct'
import * as supabaseMod from './supabase'
const mock = (supabaseMod as unknown as { __mock__: { tables: { transactions: Record<string, unknown>[]; funds: Record<string, unknown>[] }; reset: () => void } }).__mock__

function mkExp(id: string, day: number, amount: number, opts: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id, user_id: 'u1', name: 'Exp-' + id, amount,
    frequency: 'monthly', day_of_month: day, day_of_week: null, month_of_year: null,
    fund_id: 'fund-1', fund_to_id: null, category: 'altro', type: 'expense',
    is_active: true, auto_deduct: true, end_date: null, created_at: '',
    ...opts,
  }
}

describe('processAutoDeducts - idempotency (the critical bug)', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))
  })
  afterAll(() => { vi.useRealTimers() })
  beforeEach(() => {
    mock.reset()
    mock.tables.funds.push({ id: 'fund-1', balance: 1000 })
  })

  it('inserts exactly one transaction per expense on first run', async () => {
    const expenses = [mkExp('e1', 15, 100), mkExp('e2', 18, 50)]
    const periodTx: Transaction[] = []
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx })
    expect(processed).toBe(2)
    expect(mock.tables.transactions).toHaveLength(2)
  })

  it('does NOT duplicate transactions on second run (regression for the timezone bug)', async () => {
    const expenses = [mkExp('e1', 15, 100)]

    // First run
    await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(mock.tables.transactions).toHaveLength(1)
    const firstTx = mock.tables.transactions[0] as unknown as Transaction

    // Simulate reload: pass back the existing transactions
    const periodTx2: Transaction[] = [firstTx]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: periodTx2 })
    expect(processed).toBe(0)
    expect(mock.tables.transactions).toHaveLength(1)
  })

  it('does not duplicate when transaction has recurring_expense_id link', async () => {
    const expenses = [mkExp('e1', 15, 100)]
    const existing: Transaction = {
      id: 'pre-existing', user_id: 'u1', type: 'expense', amount: 100,
      description: 'Different name', fund_id: 'fund-1', fund_to_id: null,
      category: 'altro', budget_id: null, recurring_expense_id: 'e1',
      recurring_income_id: null, is_memo: false, is_planned: false,
      date: '2026-05-15', created_at: '',
    }
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [existing] })
    expect(processed).toBe(0)
    expect(mock.tables.transactions).toHaveLength(0)
  })

  it('does not duplicate when matching transaction exists by name+fund+type', async () => {
    const expenses = [mkExp('e1', 15, 100)]
    const existing: Transaction = {
      id: 'manual', user_id: 'u1', type: 'expense', amount: 100,
      description: 'Exp-e1', fund_id: 'fund-1', fund_to_id: null,
      category: 'altro', budget_id: null, recurring_expense_id: null,
      recurring_income_id: null, is_memo: false, is_planned: false,
      date: '2026-05-15', created_at: '',
    }
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [existing] })
    expect(processed).toBe(0)
  })

  it('inserts transaction with LOCAL date (not UTC) to match billing period query', async () => {
    const expenses = [mkExp('e1', 15, 100)]
    await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    const tx = mock.tables.transactions[0]
    expect(tx.date).toBe('2026-05-15')
  })

  it('updates the fund balance correctly (subtract amount)', async () => {
    const expenses = [mkExp('e1', 15, 100)]
    await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    const fund = mock.tables.funds[0]
    expect(fund.balance).toBe(900)
  })

  it('skips inactive expenses', async () => {
    const expenses = [mkExp('e1', 15, 100, { is_active: false })]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(0)
  })

  it('skips non-auto-deduct expenses', async () => {
    const expenses = [mkExp('e1', 15, 100, { auto_deduct: false })]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(0)
  })

  it('skips expenses with future due dates', async () => {
    // Today is May 19. Day 25 is May 25 (future).
    const expenses = [mkExp('e1', 25, 100)]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(0)
  })

  it('processes day 19 (today) but skips day 25 (future)', async () => {
    const expenses = [mkExp('today', 19, 50), mkExp('future', 25, 100)]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(1)
    expect((mock.tables.transactions[0] as unknown as Transaction).description).toBe('Exp-today')
  })

  it('skips expense with end_date in past', async () => {
    const expenses = [mkExp('e1', 15, 100, { end_date: '2026-04-30' })]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(0)
  })

  it('skips expense without a fund_id', async () => {
    const expenses = [mkExp('e1', 15, 100, { fund_id: null })]
    const processed = await processAutoDeducts({ userId: 'u1', expenses, periodTx: [] })
    expect(processed).toBe(0)
  })

  it('multiple reloads in sequence stay idempotent', async () => {
    const expenses = [mkExp('e1', 15, 100), mkExp('e2', 18, 50)]
    let periodTx: Transaction[] = []

    for (let i = 0; i < 5; i++) {
      const count = await processAutoDeducts({ userId: 'u1', expenses, periodTx })
      if (i === 0) expect(count).toBe(2)
      else expect(count).toBe(0)
      periodTx = mock.tables.transactions as unknown as Transaction[]
    }

    expect(mock.tables.transactions).toHaveLength(2)
    expect(mock.tables.funds[0].balance).toBe(850)
  })
})
