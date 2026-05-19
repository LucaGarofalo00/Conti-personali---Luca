import { CreditCard, Smartphone, Globe, Banknote, BookOpen, PiggyBank, Wallet } from 'lucide-react'

export const cur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

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
