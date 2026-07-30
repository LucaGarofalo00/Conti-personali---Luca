import { round2 } from './utils'
import type { Transaction } from '../types'

// Una spesa pianificata può funzionare come "budget a progetto": si fissa un tetto (es. 350 € per
// una vacanza) e le spese reali si agganciano man mano tramite transactions.planned_parent_id.
// A differenza dei budget SETTIMANALI (weekly_budgets), che sono una quota che si ripete ogni
// settimana, qui il tetto è UNA TANTUM e si consuma fino a esaurimento.
//
// Regola dei totali, pensata perché la cifra del periodo non cambi mentre si spende:
//   pianificata (residuo) + spese già fatte = tetto
// Finché il tetto non è superato la somma resta il tetto; se si sfora, il residuo è 0 e conta la
// spesa reale — lo sforamento emerge subito invece di restare nascosto sotto il tetto.

export interface PlannedBudgetStatus {
  /** Tetto fissato sulla pianificata. */
  total: number
  /** Somma delle spese realmente agganciate. */
  spent: number
  /** Quanto resta da spendere: mai negativo. */
  remaining: number
  /** Quanto si è superato il tetto: 0 se si è ancora dentro. */
  overspent: number
  /** Percentuale consumata, 0–100 (satura a 100 quando si sfora). */
  percent: number
  /** Numero di spese agganciate. */
  count: number
  /** Tetto raggiunto o superato. */
  exhausted: boolean
}

// Le figlie di una pianificata: spese reali (mai altre pianificate) agganciate al suo id.
// I memo a 0 ("non avvenuta") non consumano budget, coerentemente col resto dell'app.
export function childrenOfPlanned(plannedId: string, all: Transaction[]): Transaction[] {
  return all.filter(t =>
    t.planned_parent_id === plannedId &&
    !t.is_planned &&
    !(t.is_memo && Number(t.amount) === 0),
  )
}

export function plannedBudgetStatus(planned: Transaction, all: Transaction[]): PlannedBudgetStatus {
  const children = childrenOfPlanned(planned.id, all)
  const total = round2(Number(planned.amount) || 0)
  const spent = round2(children.reduce((s, t) => s + Number(t.amount), 0))
  const remaining = round2(Math.max(0, total - spent))
  const overspent = round2(Math.max(0, spent - total))
  return {
    total,
    spent,
    remaining,
    overspent,
    percent: total > 0 ? Math.min(100, (spent / total) * 100) : spent > 0 ? 100 : 0,
    count: children.length,
    exhausted: spent >= total,
  }
}

// Importo con cui la pianificata deve entrare nei totali del periodo: il RESIDUO, perché le spese
// già agganciate ci entrano per conto proprio. Senza questo la stessa spesa conterebbe due volte
// (una nel tetto previsto, una come movimento reale).
export function plannedResidualAmount(planned: Transaction, all: Transaction[]): number {
  return plannedBudgetStatus(planned, all).remaining
}

// Una pianificata è "in corso" quando ha già almeno una spesa agganciata ma non ha esaurito il
// tetto: è lo stato in cui va mostrata la barra di avanzamento.
export function isPlannedBudgetActive(planned: Transaction, all: Transaction[]): boolean {
  const s = plannedBudgetStatus(planned, all)
  return s.count > 0 && !s.exhausted
}
