import { CreditCard, Smartphone, Globe, Banknote, BookOpen, PiggyBank, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export const cur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

export function getBillingPeriodStart(): string {
  const now = new Date()
  if (now.getDate() >= 15) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-15`
}

export function formatDayMonth(dayOfMonth: number): string {
  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dayOfMonth)
  const target = thisMonth.getDate() === dayOfMonth && thisMonth >= now
    ? thisMonth
    : new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth)
  return format(target, 'd MMM', { locale: it })
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
  'casa', 'bollette', 'trasporti', 'cibo', 'salute',
  'abbonamenti', 'svago', 'vestiti', 'istruzione', 'risparmio', 'altro',
]

export const TRANSACTION_CATEGORIES = [
  'casa', 'bollette', 'trasporti', 'cibo', 'salute',
  'abbonamenti', 'svago', 'vestiti', 'stipendio', 'lavoro', 'trasferimento', 'altro',
]

export const VARIABLE_CATEGORIES = ['trasporti', 'cibo', 'svago', 'salute', 'altro']
