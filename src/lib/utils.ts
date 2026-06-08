import { CreditCard, Smartphone, Globe, Banknote, BookOpen, PiggyBank, Wallet } from 'lucide-react'
import { format, addMonths, addDays, startOfDay } from 'date-fns'
import { it } from 'date-fns/locale'
import { isAmountsHidden } from './privacy'
import { getAnchorDay, getPeriodStartOverride } from './periodSettings'

// Maschera mostrata quando la privacy importi è attiva (toggle "occhio" nell'header).
const HIDDEN_MASK = '••••• €'

export const cur = (n: number) =>
  isAmountsHidden() ? HIDDEN_MASK : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayString(): string {
  return toDateString(new Date())
}

// Parsa 'YYYY-MM-DD' come data LOCALE a mezzanotte (new Date(stringa) la interpreterebbe come UTC).
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function clampDay(year: number, monthIdx: number, day: number): number {
  const dim = new Date(year, monthIdx + 1, 0).getDate()
  return Math.min(day, dim)
}

export interface Period { start: string; end: string; startDate: Date; endDate: Date }

function toPeriod(startDate: Date, endDate: Date): Period {
  return { start: toDateString(startDate), end: toDateString(endDate), startDate, endDate }
}

// Periodo "a giorno fisso" per una data qualsiasi, ancorato ad `anchor` (1..28): da `anchor` del
// mese al giorno prima di `anchor` del mese successivo. Con anchor=15 → ciclo storico 15→14.
// Usato per i periodi DIVERSI da quello corrente (previsioni, riconciliazione di mesi passati).
function periodForAnchor(date: Date, anchor: number): Period {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  // Se il giorno è >= anchor, il periodo inizia in questo mese; altrimenti nel mese precedente.
  const startBase = d >= anchor ? new Date(y, m, 1) : new Date(y, m - 1, 1)
  const sy = startBase.getFullYear()
  const sm = startBase.getMonth()
  const startDate = new Date(sy, sm, clampDay(sy, sm, anchor))
  // Fine = giorno prima di `anchor` del mese successivo all'inizio.
  const endExclusive = new Date(sy, sm + 1, clampDay(sy, sm + 1, anchor))
  const endDate = addDays(endExclusive, -1)
  return toPeriod(startDate, endDate)
}

// Periodo CORRENTE. Se è stato confermato l'inizio reale (giorno dello stipendio), parte da lì e
// dura fino al giorno prima dello stesso giorno del mese dopo (fine PROVVISORIA). Se oggi ha già
// superato quella fine provvisoria (il nuovo stipendio non è ancora arrivato/confermato), il
// periodo resta aperto fino a OGGI: così i soldi "devono bastare" finché non arriva l'accredito,
// e l'eventuale stipendio appena registrato rientra nel periodo ed è rilevabile.
// Senza override → fallback sul periodo a giorno fisso (anchorDay, default 15).
// Calcola il periodo da valori ESPLICITI (override + anchor), senza leggere lo store. Riusata sia
// da getCurrentPeriod (valori salvati) sia dall'anteprima in Impostazioni (valori non ancora
// salvati del form), così la preview riflette ciò che si sta digitando.
export function computePeriod(override: string | null, anchor: number): Period {
  if (override) {
    const startDate = parseLocalDate(override)
    const provisionalEnd = addDays(addMonths(startDate, 1), -1)
    const today = startOfDay(new Date())
    const endDate = today > provisionalEnd ? today : provisionalEnd
    return toPeriod(startDate, endDate)
  }
  return periodForAnchor(startOfDay(new Date()), anchor)
}

export function getCurrentPeriod(): Period {
  return computePeriod(getPeriodStartOverride(), getAnchorDay())
}

export function getBillingPeriod(): { start: string; end: string } {
  const { start, end } = getCurrentPeriod()
  return { start, end }
}

export function getBillingPeriodFor(date: Date): Period {
  const current = getCurrentPeriod()
  const dStr = toDateString(startOfDay(date))
  // Se la data cade nel periodo corrente, restituisci quello (coerente con getBillingPeriod);
  // altrimenti calcola il periodo a giorno fisso per quella data.
  if (dStr >= current.start && dStr <= current.end) return current
  return periodForAnchor(date, getAnchorDay())
}

// Colloca un giorno-del-mese dentro il periodo corrente: nel mese d'inizio se è >= al giorno
// d'inizio del periodo, altrimenti nel mese successivo. Generalizza la vecchia soglia fissa 15.
export function getDateInCurrentPeriod(dayOfMonth: number): Date {
  const { startDate } = getCurrentPeriod()
  const startDay = startDate.getDate()
  const base = dayOfMonth >= startDay
    ? startDate
    : new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1)
  return new Date(base.getFullYear(), base.getMonth(), clampDay(base.getFullYear(), base.getMonth(), dayOfMonth))
}

export function formatDayMonth(dayOfMonth: number): string {
  return format(getDateInCurrentPeriod(dayOfMonth), 'd MMM', { locale: it })
}

// Tutte le occorrenze di una spesa/entrata MENSILE che cadono nel periodo corrente. Di norma è
// una sola, ma in un periodo "aperto"/esteso (stipendio in ritardo) che copre più di un mese lo
// stesso giorno può ricorrere due volte: questa le restituisce entrambe, così scadenze e addebiti
// automatici non perdono la seconda occorrenza.
export function monthlyOccurrencesInCurrentPeriod(dayOfMonth: number): Date[] {
  const { startDate, endDate } = getCurrentPeriod()
  const out: Date[] = []
  let y = startDate.getFullYear()
  let m = startDate.getMonth()
  for (let guard = 0; guard < 24; guard++) {
    const d = new Date(y, m, clampDay(y, m, dayOfMonth))
    if (d > endDate) break
    if (d >= startDate) out.push(d)
    m++
    if (m > 11) { m = 0; y++ }
  }
  return out
}

// Etichetta leggibile del periodo corrente (es. "10 giu – 9 lug"), per le card/InfoBox al posto
// del vecchio "(15-14)" fisso.
export function formatPeriodRange(startDate: Date, endDate: Date): string {
  return `${format(startDate, 'd MMM', { locale: it })} – ${format(endDate, 'd MMM', { locale: it })}`
}

export function currentPeriodLabel(): string {
  const { startDate, endDate } = getCurrentPeriod()
  return formatPeriodRange(startDate, endDate)
}

export const iconMap: Record<string, React.ElementType> = {
  'credit-card': CreditCard, 'smartphone': Smartphone, 'globe': Globe,
  'banknote': Banknote, 'book-open': BookOpen, 'piggy-bank': PiggyBank, 'wallet': Wallet,
}

export const ICONS = [
  { value: 'credit-card', label: 'Carta' }, { value: 'smartphone', label: 'App' },
  { value: 'globe', label: 'Internazionale' }, { value: 'banknote', label: 'Contanti' },
  { value: 'book-open', label: 'Libretto' }, { value: 'piggy-bank', label: 'Salvadanaio' },
  { value: 'wallet', label: 'Portafoglio' },
]

export const COLORS = ['#3B82F6', '#F59E0B', '#8B5CF6', '#10B981', '#F97316', '#EC4899', '#EF4444', '#06B6D4']

export const EXPENSE_CATEGORIES = [
  'casa', 'bollette', 'trasporti', 'benzina', 'cibo', 'salute',
  'abbonamenti', 'svago', 'vestiti', 'istruzione', 'risparmio', 'altro',
]

export const TRANSACTION_CATEGORIES = [
  'casa', 'bollette', 'trasporti', 'benzina', 'cibo', 'salute',
  'abbonamenti', 'svago', 'vestiti', 'stipendio', 'lavoro', 'trasferimento', 'altro',
]

export const FUEL_CATEGORY = 'benzina'

// Etichetta di visualizzazione delle categorie. Il valore salvato resta invariato (es.
// 'benzina' attiva i campi rifornimento), ma a schermo mostriamo "Carburante" perché copre
// sia benzina sia GPL.
const CATEGORY_LABELS: Record<string, string> = { benzina: 'Carburante' }
export function catLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c
}

// Converte l'input utente in numero accettando sia la virgola (separatore decimale italiano) sia il punto.
export function parseDecimal(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export const VARIABLE_CATEGORIES = ['trasporti', 'cibo', 'svago', 'salute', 'altro']
