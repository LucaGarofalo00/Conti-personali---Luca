import { CreditCard, Smartphone, Globe, Banknote, BookOpen, PiggyBank, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { isAmountsHidden } from './privacy'

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

export function getBillingPeriod(): { start: string; end: string } {
  const now = new Date()
  if (now.getDate() >= 15) {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 14)
    return {
      start: toDateString(new Date(now.getFullYear(), now.getMonth(), 15)),
      end: toDateString(end),
    }
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 15)
  const end = new Date(now.getFullYear(), now.getMonth(), 14)
  return { start: toDateString(start), end: toDateString(end) }
}

export function getBillingPeriodFor(date: Date): { start: string; end: string; startDate: Date; endDate: Date } {
  if (date.getDate() >= 15) {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 15)
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 14)
    return { start: toDateString(startDate), end: toDateString(endDate), startDate, endDate }
  }
  const startDate = new Date(date.getFullYear(), date.getMonth() - 1, 15)
  const endDate = new Date(date.getFullYear(), date.getMonth(), 14)
  return { start: toDateString(startDate), end: toDateString(endDate), startDate, endDate }
}

export function getDateInCurrentPeriod(dayOfMonth: number): Date {
  const { start, end } = getBillingPeriod()
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (dayOfMonth >= 15) {
    return new Date(startDate.getFullYear(), startDate.getMonth(), dayOfMonth)
  }
  return new Date(endDate.getFullYear(), endDate.getMonth(), dayOfMonth)
}

export function formatDayMonth(dayOfMonth: number): string {
  return format(getDateInCurrentPeriod(dayOfMonth), 'd MMM', { locale: it })
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
