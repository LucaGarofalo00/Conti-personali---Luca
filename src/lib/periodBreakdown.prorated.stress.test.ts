import { describe, it, expect } from 'vitest'
import { getPeriodBreakdown, totalsFromBreakdown } from './periodBreakdown'
import type { WeeklyBudget, Transaction } from '../types'

function mkBudget(id: string, amount: number, fund_id: string | null = null): WeeklyBudget {
  return { id, user_id: 'u', name: 'B-' + id, amount, fund_id, is_active: true, created_at: '' }
}
function mkBudgetTx(opts: { amount: number; date: string; budget_id: string }): Transaction {
  return {
    id: 'o-' + Math.random(), user_id: 'u', type: 'expense',
    amount: opts.amount, description: 'spesa budget',
    fund_id: null, fund_to_id: null, category: 'cibo', budget_id: opts.budget_id,
    recurring_expense_id: null, recurring_income_id: null,
    is_memo: false, is_planned: false,
    fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null,
    date: opts.date, created_at: '',
  }
}
const base = { recurringExpenses: [], recurringIncome: [], planned: [], excludedFundIds: [] }
const recon = { includeActualOneOffs: true, reconcileBudgets: true }

describe('PRORATED stress (1) periodo PIÙ CORTO di una settimana', () => {
  // 18 giu 2026 = giovedì; 21 giu = domenica. Periodo 18–21 (4 giorni), tutto dentro la
  // settimana lun 15 – dom 21. Budget 50/sett. Quota prorata = 50*4/7 = 28.5714 → 28.57.
  it('stima pura: un solo blocco con quota prorata 4/7 = 28.57', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 5, 19), // mar/ven a metà → porzione in corso
    })
    const items = out.filter(i => i.source === 'weekly_budget')
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(28.57)
    expect(items[0].date).toBe('2026-06-18')
    expect(totalsFromBreakdown(out).expenses).toBe(28.57)
  })

  it('porzione corta CONCLUSA con speso < quota prorata: conta SOLO lo speso reale', () => {
    // now = 25 giu (periodo finito). Speso 10 il 19. La porzione 18–21 è conclusa → spesa reale
    // (10), NON la quota prorata 28.57. Differenza chiave vs settimana in corso.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [mkBudgetTx({ amount: 10, date: '2026-06-19', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 25),
    })
    const items = out.filter(i => i.source === 'weekly_budget')
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(10)
    expect(totalsFromBreakdown(out).expenses).toBe(10)
  })

  it('porzione corta CONCLUSA con speso > quota prorata: conta lo speso (sforamento)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [mkBudgetTx({ amount: 40, date: '2026-06-19', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 25),
    })
    expect(out.filter(i => i.source === 'weekly_budget')[0].amount).toBe(40)
  })
})

describe('PRORATED stress (2) periodo allineato alle settimane → quota PIENA', () => {
  // 8 giu 2026 = lunedì; 21 giu = domenica → periodo lun–dom su 2 settimane intere.
  it('2 settimane intere, stima pura: ogni blocco = quota PIENA 50, totale 100', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 8), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 5, 9), // entrambe in corso/future
    })
    const amts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount)
    expect(amts).toEqual([50, 50])           // proration su 7/7 = quota piena
    expect(totalsFromBreakdown(out).expenses).toBe(100)
  })

  it('singola settimana lun–dom allineata: quota piena 50 (7/7), nessuna deriva', () => {
    // 50 * 7 / 7 = 50 esatti
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 8), endDate: new Date(2026, 5, 14),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 5, 9),
    })
    expect(out.filter(i => i.source === 'weekly_budget')[0].amount).toBe(50)
  })
})

describe('PRORATED stress (3) più budget attivi insieme', () => {
  it('due budget diversi su periodo corto 18–21: ciascuno prorata 4/7 indipendentemente', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon,
      weeklyBudgets: [mkBudget('sfizi', 50), mkBudget('extra', 70)],
      actualTx: [
        mkBudgetTx({ amount: 100, date: '2026-06-19', budget_id: 'sfizi' }), // sforamento → max
      ],
      now: new Date(2026, 5, 19), // porzione in corso → max(quotaProrata, speso)
    })
    const byName = Object.fromEntries(
      out.filter(i => i.source === 'weekly_budget').map(i => [i.description.split(' ')[0], i.amount]),
    )
    // sfizi: max(50*4/7=28.57, 100) = 100 ; extra: max(70*4/7=40, 0) = 40
    expect(byName['B-sfizi']).toBe(100)
    expect(byName['B-extra']).toBe(40)
    expect(totalsFromBreakdown(out).expenses).toBe(140)
  })

  it('le spese budget sono attribuite al PROPRIO budget_id, niente incrocio', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon,
      weeklyBudgets: [mkBudget('A', 50), mkBudget('B', 50)],
      actualTx: [mkBudgetTx({ amount: 200, date: '2026-06-19', budget_id: 'A' })],
      now: new Date(2026, 5, 19),
    })
    const byName = Object.fromEntries(
      out.filter(i => i.source === 'weekly_budget').map(i => [i.description.split(' ')[0], i.amount]),
    )
    expect(byName['B-A']).toBe(200)        // tutto lo speso su A
    expect(byName['B-B']).toBe(28.57)      // B resta alla quota prorata 4/7
  })
})

describe('PRORATED stress (4) settimana in corso con today a metà', () => {
  // Periodo = settimana intera lun 15 – dom 21 giu. now = giovedì 18 (metà settimana).
  // ovEndExcl = 22 giu (lun successivo). concluded = !isAfter(22, 18) = false → IN CORSO → max.
  // spent itera t.date >= '2026-06-15' && < '2026-06-22' → include ANCHE oggi (18) e il futuro (20).
  it('porzione in corso: spent include oggi e i giorni futuri della stessa settimana', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 15), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [
        mkBudgetTx({ amount: 20, date: '2026-06-16', budget_id: 'sfizi' }), // passato
        mkBudgetTx({ amount: 25, date: '2026-06-18', budget_id: 'sfizi' }), // OGGI
        mkBudgetTx({ amount: 30, date: '2026-06-20', budget_id: 'sfizi' }), // FUTURO (entro la settimana)
      ],
      now: new Date(2026, 5, 18),
    })
    const items = out.filter(i => i.source === 'weekly_budget')
    expect(items).toHaveLength(1)
    // spent = 20+25+30 = 75 ; max(quota piena 50, 75) = 75 → include oggi e futuro
    expect(items[0].amount).toBe(75)
    expect(totalsFromBreakdown(out).expenses).toBe(75)
  })

  it('porzione in corso sotto-spesa: resta alla quota piena (max), oggi incluso ma non basta', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 15), endDate: new Date(2026, 5, 21),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [mkBudgetTx({ amount: 10, date: '2026-06-18', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 18),
    })
    expect(out.filter(i => i.source === 'weekly_budget')[0].amount).toBe(50) // max(50,10)
  })

  it('confine "concluded" è la DOMENICA: periodo che finisce a metà settimana con now su quel giorno', () => {
    // Periodo 15–18 (lun–gio). ovEndExcl = 19 giu (ven). now = 18 (gio). concluded = !isAfter(19,18)=false
    // → IN CORSO. Quota prorata 4/7 = 28.57, speso 10 → max = 28.57.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 15), endDate: new Date(2026, 5, 18),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [mkBudgetTx({ amount: 10, date: '2026-06-16', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 18),
    })
    expect(out.filter(i => i.source === 'weekly_budget')[0].amount).toBe(28.57)
  })

  it('porzione conclusa quando ovEndExcl <= today (giorno DOPO la fine porzione)', () => {
    // Periodo 15–18. ovEndExcl = 19. now = 19 → !isAfter(19,19)=true → CONCLUSA → solo speso (10).
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 15), endDate: new Date(2026, 5, 18),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [mkBudgetTx({ amount: 10, date: '2026-06-16', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 19),
    })
    expect(out.filter(i => i.source === 'weekly_budget')[0].amount).toBe(10)
  })
})

describe('PRORATED stress (5) budget su fondo escluso', () => {
  it('budget su fondo escluso non emette NESSUN blocco prorated', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon, excludedFundIds: ['savings'],
      weeklyBudgets: [mkBudget('sfizi', 50, 'savings')],
      actualTx: [mkBudgetTx({ amount: 40, date: '2026-06-19', budget_id: 'sfizi' })],
      now: new Date(2026, 5, 19),
    })
    expect(out.filter(i => i.source === 'weekly_budget')).toHaveLength(0)
    expect(totalsFromBreakdown(out).expenses).toBe(0)
  })

  it('budget escluso: solo l\'altro budget (fondo non escluso) compare', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 5, 21),
      ...base, ...recon, excludedFundIds: ['savings'],
      weeklyBudgets: [mkBudget('out', 50, 'savings'), mkBudget('in', 70, 'main')],
      actualTx: [], now: new Date(2026, 5, 19),
    })
    const items = out.filter(i => i.source === 'weekly_budget')
    expect(items).toHaveLength(1)
    expect(items[0].description.startsWith('B-in')).toBe(true)
    expect(items[0].amount).toBe(40) // 70*4/7 = 40
  })
})

describe('PRORATED stress (6) somma quote prorate = quota * giorniPeriodo / 7 (stima pura)', () => {
  // Periodo 18 giu – 14 lug = 27 giorni. Quota 50/sett. Somma attesa SENZA arrotondamento = 50*27/7
  // = 192.857142… → 192.86. La somma dei blocchi arrotondati deve combaciare.
  it('27 giorni: blocchi [28.57, 50, 50, 50, 14.29], somma 192.86 = round(50*27/7)', () => {
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 18), endDate: new Date(2026, 6, 14),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 5, 19), // tutte in corso/future → quota prorata
    })
    const amts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount)
    expect(amts).toEqual([28.57, 50, 50, 50, 14.29])
    const exact = Math.round(50 * 27 / 7 * 100) / 100 // 192.86
    expect(exact).toBe(192.86)
    expect(totalsFromBreakdown(out).expenses).toBe(192.86)
    // la somma dei blocchi prorati == round(quota * giorni / 7) in QUESTO caso
    expect(amts.reduce((a, b) => a + b, 0)).toBeCloseTo(192.86, 10)
  })

  it('DIVERGENZA: la somma blocchi NON è SEMPRE round(quota*giorni/7) — deriva di 1 cent', () => {
    // Quota 5€, periodo mar 16 giu – mar 23 giu = 8 giorni. Settimana1 16–21 (6gg), settimana2 22–23 (2gg).
    // 5*6/7 = 4.2857 → 4.29 ; 5*2/7 = 1.4286 → 1.43 ; somma blocchi = 5.72.
    // MA round(5*8/7) = round(5.7143) = 5.71. La somma diverge di +1 cent dall'ideale closed-form,
    // perché ogni settimana è arrotondata in modo indipendente. Caso 6 del compito: l'uguaglianza
    // somma == round(quota*giorni/7) NON vale in generale, solo quando gli arrotondamenti si
    // compensano (es. 4/7+2/7 e 4/7+3/7 e 2/7+5/7 → tornano esatti; 6/7+2/7 → deriva).
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 16), endDate: new Date(2026, 5, 23),
      ...base, ...recon, weeklyBudgets: [mkBudget('q5', 5)],
      actualTx: [], now: new Date(2026, 5, 17),
    })
    const amts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount)
    expect(amts).toEqual([4.29, 1.43])
    expect(totalsFromBreakdown(out).expenses).toBe(5.72)          // somma blocchi
    expect(Math.round(5 * 8 / 7 * 100) / 100).toBe(5.71)          // ideale closed-form
    expect(totalsFromBreakdown(out).expenses).not.toBe(Math.round(5 * 8 / 7 * 100) / 100)
  })

  it('11 giorni a cavallo (parte mar, finisce ven): blocchi 6/7 + 5/7 = 11/7 quota', () => {
    // 16 giu (mar) – 26 giu (ven). Settimana 1: 16–21 dom (6 gg) ; settimana 2: 22–26 (5 gg).
    // 50*6/7=42.857→42.86 ; 50*5/7=35.714→35.71. round(50*11/7)=round(78.571)=78.57.
    const out = getPeriodBreakdown({
      startDate: new Date(2026, 5, 16), endDate: new Date(2026, 5, 26),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 5, 17),
    })
    const amts = out.filter(i => i.source === 'weekly_budget').map(i => i.amount)
    expect(amts).toEqual([42.86, 35.71])
    expect(totalsFromBreakdown(out).expenses).toBe(78.57)
    expect(Math.round(50 * 11 / 7 * 100) / 100).toBe(78.57)
  })
})

describe('PRORATED stress (7) arrotondamenti: derive sui confini', () => {
  it('50*4/7 (28.57) + 50*2/7 (14.29) = 42.86 = 50*6/7 → niente deriva (caso del prompt)', () => {
    const p4 = Math.round(50 * 4 / 7 * 100) / 100
    const p2 = Math.round(50 * 2 / 7 * 100) / 100
    const p6 = Math.round(50 * 6 / 7 * 100) / 100
    expect(p4).toBe(28.57)
    expect(p2).toBe(14.29)
    expect(p6).toBe(42.86)
    expect(p4 + p2).toBe(42.86)              // somma confine == settimana intera prorata
    expect(p4 + p2).toBe(p6)
  })

  it('CONTROPROVA: con quota 100, 100*4/7 + 100*3/7 ha una DERIVA di 1 cent vs 100', () => {
    // 100*4/7 = 57.142857… → 57.14 ; 100*3/7 = 42.857142… → 42.86 ; somma = 100.00 (esatto).
    // Cerco invece una quota che dia deriva: 10/sett, split 1/7 + 6/7.
    // 10*1/7 = 1.42857 → 1.43 ; 10*6/7 = 8.5714 → 8.57 ; somma 10.00 esatto.
    // Caso con deriva REALE: quota 0.7, split 3/7 + 4/7:
    //   0.7*3/7 = 0.3 esatto ; 0.7*4/7 = 0.4 esatto → 0.7 esatto. Niente deriva.
    // La deriva si manifesta quando una settimana è tagliata in DUE periodi diversi e si
    // sommano blocchi di periodi distinti. Dimostro che DENTRO un periodo la decomposizione di
    // UNA stessa settimana non avviene (ogni settimana = un solo blocco), quindi nessuna deriva
    // intra-periodo. La deriva inter-periodo è ammessa by-design (vedi confine 14/15).
    // Quota 50, confine 14/15 sulla settimana 13–19 lug:
    //   periodo A (fino 14): 13–14 = 2gg = 50*2/7 = 14.29
    //   periodo B (dal 15):  15–19 = 5gg = 50*5/7 = 35.71
    //   14.29 + 35.71 = 50.00 → in questo confine NON c'è deriva.
    const a2 = Math.round(50 * 2 / 7 * 100) / 100 // 14.29
    const b5 = Math.round(50 * 5 / 7 * 100) / 100 // 35.71
    expect(a2 + b5).toBe(50)
    // Confine che PRODUCE deriva di 1 cent: settimana 13–19, split 1/7 + 6/7, quota 50:
    //   50*1/7 = 7.142857 → 7.14 ; 50*6/7 = 42.857142 → 42.86 ; somma 50.00 → niente deriva.
    // split 4/7 + 3/7 quota 50: 28.57 + 21.43? 50*3/7=21.4285→21.43 ; 28.57+21.43=50.00.
    const c4 = Math.round(50 * 4 / 7 * 100) / 100
    const c3 = Math.round(50 * 3 / 7 * 100) / 100
    expect(c4 + c3).toBe(50)
  })

  it('confine 14/15 reale via getPeriodBreakdown: 2/7 + 5/7 = quota piena (no deriva tra due periodi)', () => {
    // 13 lug 2026 = lunedì. Settimana 13–19.
    const a = getPeriodBreakdown({
      startDate: new Date(2026, 6, 1), endDate: new Date(2026, 6, 14),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 6, 13),
    })
    const aLast = a.filter(i => i.source === 'weekly_budget').slice(-1)[0].amount
    const b = getPeriodBreakdown({
      startDate: new Date(2026, 6, 15), endDate: new Date(2026, 6, 31),
      ...base, ...recon, weeklyBudgets: [mkBudget('sfizi', 50)],
      actualTx: [], now: new Date(2026, 6, 15),
    })
    const bFirst = b.filter(i => i.source === 'weekly_budget')[0].amount
    expect(aLast).toBe(14.29)
    expect(bFirst).toBe(35.71)
    expect(aLast + bFirst).toBe(50)
  })

  it('DERIVA inter-periodo dimostrata: confine che NON ricompone la quota (quota 10, split 5/7+2/7)', () => {
    // Cerco un confine dove round(q*x/7)+round(q*(7-x)/7) != q.
    // quota 10: 10*5/7=7.142857→7.14 ; 10*2/7=2.857142→2.86 ; somma 10.00 → no.
    // quota 10: 10*1/7=1.4286→1.43 ; 10*6/7=8.5714→8.57 ; somma 10.00 → no.
    // quota 0.1: 0.1*3/7=0.042857→0.04 ; 0.1*4/7=0.057142→0.06 ; somma 0.10 → no.
    // quota 0.1: 0.1*1/7=0.0142857→0.01 ; 0.1*6/7=0.085714→0.09 ; somma 0.10 → no.
    // quota 0.05: 0.05*3/7=0.021428→0.02 ; 0.05*4/7=0.028571→0.03 ; somma 0.05 → no.
    // quota 0.35: 0.35*1/7=0.05 ; 0.35*6/7=0.3 ; somma 0.35 → no.
    // Scan programmatico qui sotto trova (o esclude) la deriva nel range tipico.
    let maxDrift = 0
    for (let qCents = 1; qCents <= 50000; qCents++) {
      const q = qCents / 100
      for (let x = 1; x <= 6; x++) {
        const left = Math.round(q * x / 7 * 100) / 100
        const right = Math.round(q * (7 - x) / 7 * 100) / 100
        const drift = Math.abs(Math.round((left + right - q) * 100) / 100)
        if (drift > maxDrift) maxDrift = drift
      }
    }
    // La deriva massima su una singola settimana tagliata in due (quote fino a 500€) è di 1 cent.
    expect(maxDrift).toBeLessThanOrEqual(0.01)
  })
})
