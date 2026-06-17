import { describe, it, expect } from 'vitest'
import { payloadDeltas, type TxPayload } from './postTransaction'

const base: TxPayload = { type: 'expense', amount: 100, date: '2026-06-01' }

describe('payloadDeltas', () => {
  it('uscita: scala il fondo di origine', () => {
    expect(payloadDeltas({ ...base, type: 'expense', fund_id: 'a', amount: 100 }))
      .toEqual([{ fundId: 'a', delta: -100 }])
  })

  it('entrata: accredita il fondo', () => {
    expect(payloadDeltas({ ...base, type: 'income', fund_id: 'a', amount: 100 }))
      .toEqual([{ fundId: 'a', delta: 100 }])
  })

  it('trasferimento: scala l\'origine e accredita la destinazione', () => {
    expect(payloadDeltas({ ...base, type: 'transfer', fund_id: 'a', fund_to_id: 'b', amount: 50 }))
      .toEqual([{ fundId: 'a', delta: -50 }, { fundId: 'b', delta: 50 }])
  })

  it('senza fondo non genera movimenti di saldo', () => {
    expect(payloadDeltas({ ...base, type: 'expense', fund_id: null, amount: 100 })).toEqual([])
  })

  it('memo e pianificate non muovono i saldi', () => {
    expect(payloadDeltas({ ...base, fund_id: 'a', is_memo: true })).toEqual([])
    expect(payloadDeltas({ ...base, fund_id: 'a', is_planned: true })).toEqual([])
  })
})
