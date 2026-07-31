import { supabase } from './supabase'
import type { Fund, Transaction } from '../types'

// Backup/export dei dati dell'utente. Tutto lato client: nessuna dipendenza dal backend oltre
// alle SELECT (protette da RLS, quindi escono solo i dati dell'utente loggato). Serve come rete
// di sicurezza: il piano gratuito di Supabase mette in pausa i progetti inattivi, e finora non
// c'era modo di portarsi via i propri dati.

const TABLES = ['funds', 'recurring_income', 'recurring_expenses', 'weekly_budgets', 'transactions', 'user_settings'] as const

export interface BackupBundle {
  app: 'FinanzApp'
  version: 1
  exported_at: string
  tables: Record<string, unknown[]>
}

// PostgREST applica un tetto di righe per risposta (su Supabase, di norma 1000). Una `select('*')`
// secca su `transactions` restituiva quindi le prime N righe SENZA alcun errore: il file di backup
// sembrava completo ma non lo era — il difetto peggiore possibile in una funzione di sicurezza.
// Qui si pagina finché la pagina torna piena.
const PAGE = 1000

async function fetchAllRows(table: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    // Una tabella mancante (DB non ancora migrato) non deve far fallire l'intero backup.
    if (error) {
      if (/does not exist|schema cache|find the table/i.test(error.message || '')) return []
      throw new Error(`Errore esportando ${table}: ${error.message}`)
    }
    const rows = data || []
    out.push(...rows)
    // Pagina non piena → era l'ultima. (Se il tetto del server fosse più basso di PAGE, la pagina
    // arriva comunque non piena e il ciclo si ferma: nessun rischio di ciclo infinito.)
    if (rows.length < PAGE) return out
  }
}

export async function fetchBackup(): Promise<BackupBundle> {
  // Le sei tabelle sono indipendenti: in serie erano sei attese sommate, in parallelo una sola.
  const results = await Promise.all(TABLES.map(t => fetchAllRows(t)))
  const tables: Record<string, unknown[]> = {}
  TABLES.forEach((t, i) => { tables[t] = results[i] })
  return { app: 'FinanzApp', version: 1, exported_at: new Date().toISOString(), tables }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadJson(bundle: BackupBundle) {
  triggerDownload(`finanzapp-backup-${stamp()}.json`, JSON.stringify(bundle, null, 2), 'application/json')
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CSV delle transazioni pensato per Excel italiano: separatore ';', virgola decimale, BOM UTF-8.
export function downloadTransactionsCsv(bundle: BackupBundle) {
  const txs = (bundle.tables.transactions || []) as Transaction[]
  const funds = (bundle.tables.funds || []) as Fund[]
  const fundName = (id: string | null) => funds.find(f => f.id === id)?.name ?? ''
  const typeLabel: Record<string, string> = { income: 'Entrata', expense: 'Uscita', transfer: 'Trasferimento' }
  const headers = ['Data', 'Tipo', 'Descrizione', 'Categoria', 'Importo', 'Fondo', 'Fondo destinazione', 'Memo', 'Pianificata']
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const rows = sorted.map(t => [
    t.date,
    typeLabel[t.type] ?? t.type,
    t.description,
    t.category,
    String(Number(t.amount)).replace('.', ','),
    fundName(t.fund_id),
    fundName(t.fund_to_id),
    t.is_memo ? 'sì' : '',
    t.is_planned ? 'sì' : '',
  ])
  const csv = [headers, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n')
  const BOM = String.fromCharCode(0xFEFF)
  triggerDownload(`finanzapp-transazioni-${stamp()}.csv`, BOM + csv, 'text/csv;charset=utf-8')
}
