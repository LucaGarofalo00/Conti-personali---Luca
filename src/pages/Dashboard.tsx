import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Wallet, TrendingUp, TrendingDown, Target, ArrowRight, PiggyBank, CheckCircle2, Check, Clock, CalendarClock, Plus, Trash2, Pencil, ArrowLeftRight, LineChart } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import FundExcluder from '../components/FundExcluder'
import SchemaBanner from '../components/SchemaBanner'
import InfoBox from '../components/InfoBox'
import BreakdownList from '../components/BreakdownList'
import { getPeriodBreakdown } from '../lib/periodBreakdown'
import { generateForecast, projectBalanceAtDate, findNextMonthlyIncomeDate } from '../lib/forecast'
import { totalsFromBreakdown } from '../lib/periodBreakdown'
import { addDays } from 'date-fns'
import { cur, iconMap, getBillingPeriod, getBillingPeriodFor, monthlyOccurrencesInCurrentPeriod, todayString, currentPeriodLabel, TRANSACTION_CATEGORIES, FUEL_CATEGORY, parseDecimal, catLabel, parseLocalDate, fmtDate } from '../lib/utils'
import CategorySelect from '../components/CategorySelect'
import { isAmountsHidden } from '../lib/privacy'
import { getSalaryIncomeId } from '../lib/periodSettings'
import { savePeriodSettings } from '../lib/periodSettingsDb'
import { probePlannedDateSupport, withPlannedDate } from '../lib/schemaSupport'
import { postTransaction } from '../lib/postTransaction'
import { logSupabaseError } from '../lib/logError'
import { useExcludedFunds } from '../lib/excludedFunds'
import { processAutoDeducts } from '../lib/autoDeduct'
import { markPlannedAsDone } from '../lib/plannedTransactions'
import { generateIncomeOccurrences, type IncomeOccurrence } from '../lib/incomeOccurrences'
import { FUEL_TYPE_LABEL, fuelStatsOdometer, lifetimeCostPerKmOdometer, lifetimePerFuelStima, type FuelType } from '../lib/fuelConsumption'
import { inSameRecurrenceWindow } from '../lib/recurrenceMatch'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, Transaction } from '../types'

interface PendingItem {
  id: string
  kind: 'income' | 'expense' | 'transfer'
  name: string
  amount: number
  fund_id: string | null
  fund_to_id: string | null
  category: string
  label: string
  confirmed: boolean
  auto?: boolean
  occurrence?: IncomeOccurrence
  recurring_income_id?: string
  recurring_expense_id?: string
  occurrence_date?: string
}

const FUEL_COLUMNS = ['transactions.fuel_km', 'transactions.fuel_liters', 'transactions.fuel_price_per_liter', 'transactions.fuel_type', 'transactions.fuel_odometer']

function isFuelColumnError(msg?: string | null): boolean {
  if (!msg) return false
  return /fuel_(km|liters|price_per_liter|type)/.test(msg) && /column|schema|find/i.test(msg)
}

function formatItalianDayMonth(d: Date): string {
  return format(d, 'EEE d MMM', { locale: it })
}

// Etichette asse Y compatte (€1,2k / €1,2M): un valore intero in euro mangia la larghezza del
// grafico su mobile. Coerente con la stessa formattazione nella pagina Previsione.
function fmtAxisEur(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `€${(v / 1_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k`
  return `€${Number(v).toLocaleString('it-IT')}`
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; balance: number; income: number; expenses: number } }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white p-3 rounded-lg shadow-xl border border-slate-100 text-[13px]">
      <p className="font-medium text-slate-700 mb-1">{d.label}</p>
      <p className="text-slate-800">Saldo: {cur(d.balance)}</p>
      <p className="text-emerald-600">Entrate: {cur(d.income)}</p>
      <p className="text-red-500">Uscite: {cur(d.expenses)}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [funds, setFunds] = useState<Fund[]>([])
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [income, setIncome] = useState<RecurringIncome[]>([])
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [periodTx, setPeriodTx] = useState<Transaction[]>([])
  const [planned, setPlanned] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [loadError, setLoadError] = useState(false)
  const [excludedFundIds, , toggleExcluded] = useExcludedFunds()

  const [confirmItem, setConfirmItem] = useState<PendingItem | null>(null)
  const [confirmAmount, setConfirmAmount] = useState(0)
  const [confirmDate, setConfirmDate] = useState(todayString())
  const [confirmFundId, setConfirmFundId] = useState('')
  const [confirmSaving, setConfirmSaving] = useState(false)
  const [confirmFuelOdometer, setConfirmFuelOdometer] = useState('')
  const [confirmFuelLiters, setConfirmFuelLiters] = useState('')
  const [confirmFuelPrice, setConfirmFuelPrice] = useState('')
  const [confirmFuelType, setConfirmFuelType] = useState<FuelType>('gpl')
  const [confirmFuelFills, setConfirmFuelFills] = useState<Transaction[]>([])

  const [plannedModal, setPlannedModal] = useState(false)
  const [plannedListOpen, setPlannedListOpen] = useState(false)
  const [breakdownModal, setBreakdownModal] = useState<'income' | 'expense' | 'net' | null>(null)
  const [completePlannedItem, setCompletePlannedItem] = useState<Transaction | null>(null)
  const [completeAmount, setCompleteAmount] = useState(0)
  const [completeFundId, setCompleteFundId] = useState('')
  const [completeDate, setCompleteDate] = useState(todayString())
  const [completeSaving, setCompleteSaving] = useState(false)
  const [plannedForm, setPlannedForm] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: 0, description: '', fund_id: '', category: 'altro', date: todayString(),
  })
  const [plannedSaving, setPlannedSaving] = useState(false)
  const [editingPlanned, setEditingPlanned] = useState<Transaction | null>(null)

  const load = async () => {
    try {
      setLoadError(false)
      // Rileva il supporto a planned_date prima di eventuali inserimenti (auto-deduct in fondo).
      await probePlannedDateSupport()
      const { start: periodStart, end: periodEnd } = getBillingPeriod()

      const [f, e, i, b] = await Promise.all([
        supabase.from('funds').select('*').order('sort_order'),
        supabase.from('recurring_expenses').select('*'),
        supabase.from('recurring_income').select('*'),
        supabase.from('weekly_budgets').select('*'),
      ])

      let periodTxData: Transaction[] = []
      let plannedData: Transaction[] = []
      const missing: string[] = []

      const txRes = await supabase.from('transactions').select('*').gte('date', periodStart).lte('date', periodEnd).eq('is_planned', false)
      if (txRes.error && /column.*is_planned.*does not exist/i.test(txRes.error.message || '')) {
        missing.push('transactions.is_planned')
        const fallback = await supabase.from('transactions').select('*').gte('date', periodStart).lte('date', periodEnd)
        periodTxData = fallback.data || []
      } else if (txRes.error) {
        logSupabaseError('Errore tx:', txRes.error)
        toast.error('Errore caricamento transazioni: ' + txRes.error.message)
      } else {
        periodTxData = txRes.data || []
      }

      const plRes = await supabase.from('transactions').select('*').eq('is_planned', true).order('date', { ascending: true })
      if (plRes.error && /column.*is_planned.*does not exist/i.test(plRes.error.message || '')) {
        if (!missing.includes('transactions.is_planned')) missing.push('transactions.is_planned')
      } else if (plRes.error) {
        logSupabaseError('Errore planned:', plRes.error)
      } else {
        plannedData = plRes.data || []
      }

      const firstError = [f, e, i, b].find(r => r.error)?.error
      if (firstError) {
        logSupabaseError('Errore Supabase:', firstError)
        setLoadError(true)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }

      const expensesData = e.data || []

      let fundsData = f.data || []
      let finalPeriodTx = periodTxData

      if (user && !firstError && missing.length === 0) {
        try {
          const processed = await processAutoDeducts({
            userId: user.id,
            expenses: expensesData,
            periodTx: periodTxData,
          })
          if (processed > 0) {
            const [fRefetch, txRefetch] = await Promise.all([
              supabase.from('funds').select('*').order('sort_order'),
              supabase.from('transactions').select('*').gte('date', periodStart).lte('date', periodEnd).eq('is_planned', false),
            ])
            fundsData = fRefetch.data || fundsData
            finalPeriodTx = txRefetch.data || finalPeriodTx
            toast.success(`${processed} ${processed === 1 ? 'spesa automatica registrata' : 'spese automatiche registrate'}`)
          }
        } catch (err) {
          console.error('Errore auto-deduct:', err)
        }
      }

      setFunds(fundsData)
      setExpenses(expensesData)
      setIncome(i.data || [])
      setBudgets(b.data || [])
      setPeriodTx(finalPeriodTx)
      setPlanned(plannedData)
      setMissingColumns(missing)
    } catch (err) {
      logSupabaseError('Errore fatale in load:', err)
      setLoadError(true)
      toast.error('Errore imprevisto: controlla la console (F12)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) load() }, [user])

  // Rilevamento automatico (con conferma) del nuovo periodo: se nel periodo corrente è stato
  // registrato un accredito dello stipendio in una data SUCCESSIVA all'inizio del periodo, vuol
  // dire che è arrivato il nuovo stipendio → propongo di far ripartire il periodo da quel giorno.
  const salaryPromptRef = useRef(false)
  useEffect(() => {
    if (loading || !user) return
    const salaryId = getSalaryIncomeId()
    if (!salaryId) return
    const { start } = getBillingPeriod()
    const candidate = periodTx
      .filter(t => t.recurring_income_id === salaryId && !t.is_planned && !t.is_memo && t.type === 'income' && t.date > start)
      .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)[0]
    if (!candidate) return
    let dismissed: string | null = null
    try { dismissed = localStorage.getItem('finanzapp:periodPromptDismissed') } catch { /* no-op */ }
    if (dismissed === candidate.date || salaryPromptRef.current) return
    salaryPromptRef.current = true
    ;(async () => {
      const dateLabel = format(new Date(candidate.date + 'T00:00:00'), 'd MMM', { locale: it })
      const ok = await confirm({
        title: 'Nuovo stipendio rilevato',
        message: `Sembra che lo stipendio sia arrivato il ${dateLabel}. Vuoi far iniziare il nuovo periodo da quella data?`,
        confirmText: 'Sì, nuovo periodo',
        cancelText: 'Non ora',
      })
      if (ok) {
        const { error } = await savePeriodSettings(user.id, { periodStart: candidate.date })
        salaryPromptRef.current = false
        if (error) { toast.error('Errore impostazione periodo: ' + error); return }
        toast.success(`Periodo aggiornato: parte dal ${dateLabel}`)
        load()
      } else {
        try { localStorage.setItem('finanzapp:periodPromptDismissed', candidate.date) } catch { /* no-op */ }
        salaryPromptRef.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, periodTx, user])

  // Memoizzato: la proiezione a 3 mesi (walk settimanale su entrate/spese) è la computazione più
  // pesante della pagina e dipende solo dai dati; senza memo verrebbe rifatta a ogni keystroke nei
  // modali di conferma. Si ricalcola solo quando cambiano davvero i dati o i fondi esclusi.
  const forecast = useMemo(
    () => generateForecast(funds, expenses, income, budgets, 3, excludedFundIds, planned, periodTx),
    [funds, expenses, income, budgets, excludedFundIds, planned, periodTx],
  )

  const today = todayString()
  const periodLabel = currentPeriodLabel()

  const { startDate: periodStartObj, endDate: periodEndObj } = getBillingPeriodFor(new Date())

  const pendingRecurring: PendingItem[] = expenses
    .filter(exp => exp.is_active && (!exp.end_date || exp.end_date >= today))
    .flatMap(exp => {
      const isTransfer = (exp.type || 'expense') === 'transfer'
      const fromName = funds.find(f => f.id === exp.fund_id)?.name
      const toName = funds.find(f => f.id === exp.fund_to_id)?.name
      const baseLabel = isTransfer ? `${fromName || '?'} → ${toName || '?'}` : catLabel(exp.category)
      const freq = exp.frequency || 'monthly'
      const occurrences: { date: Date; dateStr: string }[] = []

      if (freq === 'weekly' && exp.day_of_week !== null) {
        const cursor = new Date(periodStartObj)
        while (cursor <= periodEndObj) {
          if (cursor.getDay() === exp.day_of_week) {
            occurrences.push({ date: new Date(cursor), dateStr: format(cursor, 'yyyy-MM-dd') })
          }
          cursor.setDate(cursor.getDate() + 1)
        }
      } else if (freq === 'monthly' && exp.day_of_month !== null) {
        // Tutte le occorrenze mensili del periodo: di norma 1, ma in un periodo "esteso"
        // (stipendio in ritardo, fine prolungata fino a oggi) lo span può superare il mese e una
        // mensile ricorre due volte (es. il 12 di due mesi). Allineato a auto-deduct.
        for (const due of monthlyOccurrencesInCurrentPeriod(exp.day_of_month)) {
          occurrences.push({ date: due, dateStr: format(due, 'yyyy-MM-dd') })
        }
      } else if (freq === 'yearly' && exp.day_of_month !== null && exp.month_of_year !== null) {
        const cursor = new Date(periodStartObj)
        while (cursor <= periodEndObj) {
          const dim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
          if (cursor.getDate() === Math.min(exp.day_of_month, dim) && cursor.getMonth() + 1 === exp.month_of_year) {
            occurrences.push({ date: new Date(cursor), dateStr: format(cursor, 'yyyy-MM-dd') })
          }
          cursor.setDate(cursor.getDate() + 1)
        }
      }

      const filteredOccs = occurrences
        .filter(o => (!exp.start_date || o.dateStr >= exp.start_date) && (!exp.end_date || o.dateStr <= exp.end_date))

      // Un'occorrenza è "pagata" se esiste un movimento reale nella stessa finestra
      // (settimana per le settimanali, mese per le mensili): non serve la data esatta.
      // Priorità alle transazioni collegate; come ripiego, quelle non collegate ma con lo
      // stesso nome (es. vecchi memo "solo pagato"). Consumo greedy: una transazione copre
      // al più un'occorrenza.
      const byDate = (a: Transaction, b: Transaction) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      const linkedTx = periodTx.filter(tx => tx.recurring_expense_id === exp.id).sort(byDate)
      const namedTx = periodTx.filter(tx =>
        !tx.recurring_expense_id && tx.description === exp.name &&
        (isTransfer ? tx.type === 'transfer' : tx.type === 'expense')
      ).sort(byDate)
      const consumed = new Set<string>()
      // Restituisce la transazione reale che copre l'occorrenza (o null). Preferisce la data
      // prevista (planned_date) per agganciare l'occorrenza giusta anche se la spesa è stata
      // segnata giorni prima/dopo; in assenza, ricade sulla finestra.
      const matchOccurrence = (dateStr: string): Transaction | null => {
        const matches = (t: Transaction) => t.planned_date ? t.planned_date === dateStr : inSameRecurrenceWindow(t.date, dateStr, freq)
        const pick = (arr: Transaction[]) => arr.find(t => !consumed.has(t.id) && matches(t))
        const tx = pick(linkedTx) || pick(namedTx)
        if (!tx) return null
        consumed.add(tx.id)
        return tx
      }

      return filteredOccs.map(o => {
        const paidTx = matchOccurrence(o.dateStr)
        const dateLabel = freq === 'weekly'
          ? format(o.date, 'EEE d MMM', { locale: it })
          : format(o.date, 'd MMM', { locale: it })
        return {
          id: 'rec-' + exp.id + '-' + o.dateStr,
          kind: isTransfer ? 'transfer' as const : 'expense' as const,
          name: exp.name,
          // Già pagata → mostra l'importo REALE registrato (può differire dal previsto, es.
          // benzina pagata 25€ invece di 30€); ancora da pagare → la stima della ricorrente.
          amount: paidTx ? Number(paidTx.amount) : Number(exp.amount),
          fund_id: exp.fund_id,
          fund_to_id: exp.fund_to_id || null,
          category: exp.category,
          label: `${dateLabel} · ${baseLabel}`,
          confirmed: !!paidTx,
          auto: !!exp.auto_deduct,
          recurring_expense_id: exp.id,
          occurrence_date: o.dateStr,
        }
      })
    })
    .sort((a, b) => (a.occurrence_date || '').localeCompare(b.occurrence_date || ''))

  const pendingRecurringManual = pendingRecurring.filter(p => !p.auto)
  const pendingAutoUpcoming = pendingRecurring.filter(p => p.auto && !p.confirmed && !!p.occurrence_date && p.occurrence_date >= today)

  const { start: pStartStr, end: pEndStr } = getBillingPeriod()
  const incomeOccurrences = generateIncomeOccurrences(income, pStartStr, pEndStr, periodTx)
    .filter(o => o.status === 'pending')

  const pendingIncome: PendingItem[] = incomeOccurrences.map(o => {
    const inc = o.income
    const isWeekly = inc.frequency === 'weekly'
    const sameDay = o.workDateStr === o.paymentDateStr
    const label = isWeekly
      ? sameDay
        ? `${formatItalianDayMonth(o.workDate)}`
        : `Lavoro ${formatItalianDayMonth(o.workDate)} · pagamento ${formatItalianDayMonth(o.paymentDate)}`
      : `Atteso il ${formatItalianDayMonth(o.workDate)}`
    return {
      id: 'inc-' + inc.id + '-' + o.workDateStr,
      kind: 'income' as const,
      name: inc.name,
      amount: Number(inc.amount),
      fund_id: inc.fund_id,
      fund_to_id: null,
      category: 'lavoro',
      label,
      confirmed: false,
      occurrence: o,
      recurring_income_id: inc.id,
      occurrence_date: o.paymentDateStr,
    }
  })

  const confirmedRecurringCount = pendingRecurringManual.filter(p => p.confirmed).length

  const openConfirm = (item: PendingItem) => {
    setConfirmItem(item)
    setConfirmAmount(item.amount)
    // Data effettiva = oggi (il momento in cui registro), modificabile. La data prevista
    // dell'occorrenza viene comunque salvata a parte in planned_date.
    setConfirmDate(todayString())
    setConfirmFundId(item.fund_id || '')
    setConfirmFuelOdometer('')
    setConfirmFuelLiters('')
    setConfirmFuelPrice('')
    setConfirmFuelType('gpl')
    setConfirmFuelFills([])
    if (item.kind === 'expense' && item.category === FUEL_CATEGORY) {
      void loadFuelFills()
    }
  }

  const loadFuelFills = async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('category', FUEL_CATEGORY)
    if (error) return
    setConfirmFuelFills((data || []).filter(t => !t.is_planned))
  }

  const handleConfirm = async () => {
    if (!confirmItem || confirmAmount <= 0) return
    setConfirmSaving(true)

    const fundId = confirmFundId || null
    const fundToId = confirmItem.kind === 'transfer' ? (confirmItem.fund_to_id || null) : null
    const txType = confirmItem.kind === 'transfer' ? 'transfer' : confirmItem.kind === 'income' ? 'income' : 'expense'
    // La data EFFETTIVA (quando registro) è quella che conta nei saldi e nei totali; la data
    // PREVISTA dell'occorrenza resta in planned_date per riagganciare la ricorrente anche se
    // l'ho segnata giorni prima o dopo.
    const effectiveDate = confirmDate || todayString()
    const plannedDate = confirmItem.occurrence_date || effectiveDate
    const isFuel = confirmItem.kind === 'expense' && confirmItem.category === FUEL_CATEGORY
    const fuelFields = isFuel ? {
      fuel_km: null,
      fuel_liters: parseDecimal(confirmFuelLiters) || null,
      fuel_price_per_liter: parseDecimal(confirmFuelPrice) || null,
      fuel_type: confirmFuelType,
      ...(parseDecimal(confirmFuelOdometer) > 0 ? { fuel_odometer: parseDecimal(confirmFuelOdometer) } : {}),
    } : {}

    // Insert + saldo atomici via post_transaction (con fallback al percorso storico).
    const { error } = await postTransaction(user!.id, {
      type: txType,
      amount: confirmAmount,
      description: confirmItem.name,
      fund_id: fundId,
      fund_to_id: fundToId,
      category: confirmItem.category,
      recurring_income_id: confirmItem.recurring_income_id || null,
      recurring_expense_id: confirmItem.recurring_expense_id || null,
      date: effectiveDate,
      planned_date: plannedDate,
      ...fuelFields,
    })

    if (error) {
      setConfirmSaving(false)
      if (isFuelColumnError(error)) {
        setMissingColumns(prev => Array.from(new Set([...prev, ...FUEL_COLUMNS])))
        toast.error('Colonne benzina mancanti: esegui la SQL indicata nel banner in alto')
      } else {
        toast.error('Errore nel salvataggio: ' + error)
      }
      return
    }

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success(confirmItem.kind === 'transfer' ? 'Trasferimento registrato' : confirmItem.kind === 'income' ? 'Entrata registrata' : 'Spesa registrata')
    load()
  }

  const skipIncomeOccurrence = async (item: PendingItem) => {
    if (!item.recurring_income_id || !item.occurrence_date) return
    const { error } = await supabase.from('transactions').insert(withPlannedDate({
      user_id: user!.id,
      type: 'income',
      amount: 0,
      description: item.name + ' (non lavorato)',
      fund_id: null,
      fund_to_id: null,
      category: item.category,
      recurring_income_id: item.recurring_income_id,
      is_memo: true,
      date: item.occurrence_date,
    }, item.occurrence_date))
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Segnato come "non lavorato"')
    load()
  }

  const resetPlannedForm = () => setPlannedForm({ type: 'expense', amount: 0, description: '', fund_id: '', category: 'altro', date: todayString() })

  const openAddPlanned = () => {
    setEditingPlanned(null)
    resetPlannedForm()
    setPlannedModal(true)
  }

  const openEditPlanned = (p: Transaction) => {
    setPlannedListOpen(false)
    setEditingPlanned(p)
    setPlannedForm({
      type: p.type === 'income' ? 'income' : 'expense',
      amount: Number(p.amount),
      description: p.description,
      fund_id: p.fund_id || '',
      category: p.category,
      date: p.date,
    })
    setPlannedModal(true)
  }

  const savePlanned = async () => {
    if (plannedForm.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    if (!plannedForm.description.trim()) { toast.error('Inserisci una descrizione'); return }
    if (!plannedForm.date) { toast.error('Inserisci una data'); return }
    setPlannedSaving(true)
    const data = {
      type: plannedForm.type,
      amount: plannedForm.amount,
      description: plannedForm.description,
      fund_id: plannedForm.fund_id || null,
      fund_to_id: null,
      category: plannedForm.category,
      date: plannedForm.date,
    }
    // Le pianificate non muovono i fondi finché non vengono completate: modificarle è un
    // semplice update dei campi, senza toccare i saldi.
    const { error } = editingPlanned
      ? await supabase.from('transactions').update(data).eq('id', editingPlanned.id)
      : await supabase.from('transactions').insert({ user_id: user!.id, ...data, is_planned: true })
    setPlannedSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editingPlanned ? 'Pianificazione aggiornata' : 'Pianificazione aggiunta')
    setPlannedModal(false)
    setEditingPlanned(null)
    resetPlannedForm()
    load()
  }

  const openCompletePlanned = (p: Transaction) => {
    setPlannedListOpen(false)
    setCompletePlannedItem(p)
    setCompleteAmount(Number(p.amount))
    setCompleteFundId(p.fund_id || '')
    setCompleteDate(todayString())
  }

  const confirmCompletePlanned = async () => {
    if (!completePlannedItem || completeAmount <= 0) return
    setCompleteSaving(true)
    const { error } = await markPlannedAsDone(completePlannedItem, { amount: completeAmount, fund_id: completeFundId || null, date: completeDate || todayString() })
    setCompleteSaving(false)
    if (error) { toast.error('Errore nel completamento: ' + error); return }
    setCompletePlannedItem(null)
    toast.success('Pianificazione completata')
    load()
  }

  const deletePlanned = async (id: string) => {
    if (!(await confirm({ message: 'Eliminare questa pianificazione?', confirmText: 'Elimina', danger: true }))) return
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { toast.error('Errore'); return }
    toast.success('Pianificazione eliminata')
    load()
  }

  const handleMarkOnly = async () => {
    if (!confirmItem) return
    setConfirmSaving(true)

    const isFuel = confirmItem.kind === 'expense' && confirmItem.category === FUEL_CATEGORY
    const fuelFields = isFuel ? {
      fuel_km: null,
      fuel_liters: parseDecimal(confirmFuelLiters) || null,
      fuel_price_per_liter: parseDecimal(confirmFuelPrice) || null,
      fuel_type: confirmFuelType,
      ...(parseDecimal(confirmFuelOdometer) > 0 ? { fuel_odometer: parseDecimal(confirmFuelOdometer) } : {}),
    } : {}

    const effectiveDate = confirmDate || todayString()
    const plannedDate = confirmItem.occurrence_date || effectiveDate
    const { error: insertError } = await supabase.from('transactions').insert(withPlannedDate({
      user_id: user!.id,
      // Rispetta il tipo dell'occorrenza: un trasferimento "segnato senza scalare" resta un memo di
      // tipo 'transfer' (escluso da entrate/uscite), non un'uscita che falserebbe i totali.
      type: confirmItem.kind === 'income' ? 'income' : confirmItem.kind === 'transfer' ? 'transfer' : 'expense',
      amount: confirmAmount,
      description: confirmItem.name,
      fund_id: null,
      fund_to_id: null,
      category: confirmItem.category,
      recurring_income_id: confirmItem.recurring_income_id || null,
      recurring_expense_id: confirmItem.recurring_expense_id || null,
      is_memo: true,
      date: effectiveDate,
      ...fuelFields,
    }, plannedDate))

    if (insertError) {
      setConfirmSaving(false)
      if (isFuelColumnError(insertError.message)) {
        setMissingColumns(prev => Array.from(new Set([...prev, ...FUEL_COLUMNS])))
        toast.error('Colonne benzina mancanti: esegui la SQL indicata nel banner in alto')
      } else {
        toast.error('Errore nel salvataggio: ' + (insertError.message || ''))
      }
      return
    }

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success('Segnato come pagato')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Caricamento...</div>

  const includedFunds = funds.filter(f => !excludedFundIds.includes(f.id))
  const totalBalance = includedFunds.reduce((s, f) => s + Number(f.balance), 0)
  const totalBalanceAll = funds.reduce((s, f) => s + Number(f.balance), 0)
  const hasExclusions = excludedFundIds.some(id => funds.some(f => f.id === id))
  const { start: pStartForEst, end: pEndForEst } = getBillingPeriod()
  const plannedInPeriod = planned.filter(p => p.date >= pStartForEst && p.date <= pEndForEst)
  const periodBreakdown = getPeriodBreakdown({
    startDate: parseLocalDate(pStartForEst),
    endDate: parseLocalDate(pEndForEst),
    recurringExpenses: expenses,
    recurringIncome: income,
    weeklyBudgets: budgets,
    planned: plannedInPeriod,
    excludedFundIds,
    fromToday: false,
    actualTx: periodTx,
    includeActualOneOffs: true,
    // Budget: settimane concluse → spesa reale; settimana in corso e future → quota stimata.
    reconcileBudgets: true,
  })
  const est = totalsFromBreakdown(periodBreakdown)
  const periodNet = Math.round((est.income - est.expenses) * 100) / 100
  // Coerente col valore della card: il breakdown scarta le pianificate su fondi esclusi, quindi
  // anche il sottotitolo "incl. … pianif." deve escluderle, altrimenti i numeri non tornano.
  const notExcluded = (p: Transaction) => !(p.fund_id && excludedFundIds.includes(p.fund_id))
  const plannedIncomeInPeriod = plannedInPeriod.filter(p => p.type === 'income' && notExcluded(p)).reduce((s, p) => s + Number(p.amount), 0)
  const plannedExpensesInPeriod = plannedInPeriod.filter(p => p.type === 'expense' && notExcluded(p)).reduce((s, p) => s + Number(p.amount), 0)
  const mainFunds = funds.filter(f => f.type === 'main')
  const subFunds = funds.filter(f => f.type === 'sub')

  const recentTx = [...periodTx]
    .filter(tx => !tx.is_memo)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (funds.length === 0) {
    if (loadError) {
      return (
        <div className="text-center py-16">
          <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Impossibile caricare i dati</h2>
          <p className="text-sm text-slate-400 mb-6">Si è verificato un problema di connessione. Riprova.</p>
          <button onClick={() => { setLoading(true); load() }} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 active:scale-[0.98] transition-[transform,background-color] text-sm font-medium">
            Riprova
          </button>
        </div>
      )
    }
    return (
      <div className="text-center py-16">
        <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-4" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-700 mb-1">Benvenuto in FinanzApp!</h2>
        <p className="text-sm text-slate-400 mb-6">Inizia configurando i tuoi fondi per gestire le tue finanze</p>
        <Link to="/fondi" className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 active:scale-[0.98] transition-[transform,background-color] text-sm font-medium">
          Configura Fondi <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    )
  }

  return (
    <div>
      <SchemaBanner missingColumns={missingColumns} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          {hasExclusions && (
            <p className="text-xs text-slate-500 mt-1">
              Stime calcolate escludendo {excludedFundIds.filter(id => funds.some(f => f.id === id)).length} fondo/i ·
              Saldo totale reale: <span className="font-semibold text-slate-700">{cur(totalBalanceAll)}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={openAddPlanned} className="inline-flex items-center gap-2 min-h-[40px] px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-[13px] font-medium hover:bg-white hover:border-slate-300 active:scale-[0.98] transition-[transform,background-color,border-color]">
            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /> Pianifica
          </button>
          <FundExcluder
            funds={funds}
            excludedIds={excludedFundIds}
            onToggle={toggleExcluded}
            onClear={() => excludedFundIds.forEach(id => toggleExcluded(id))}
          />
        </div>
      </div>

      {(() => {
        const nextSalary = findNextMonthlyIncomeDate(income)
        const projectionTarget = nextSalary ? addDays(nextSalary.date, -1) : null
        const projection = projectionTarget
          ? projectBalanceAtDate(projectionTarget, totalBalance, expenses, income, budgets, planned, excludedFundIds, periodTx)
          : null
        return (
          <>
            <div className="bg-brand hero-glow rounded-3xl p-5 sm:p-8 mb-4 text-white shadow-lg shadow-indigo-600/25">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/15">
                  <Wallet className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-white/85">{hasExclusions ? 'Saldo Filtrato' : 'Saldo Totale'}</span>
              </div>
              <p className="text-4xl sm:text-5xl font-bold tracking-tight tabular-nums">{cur(totalBalance)}</p>
              {hasExclusions
                ? <p className="text-xs text-white/75 mt-2.5">Saldo totale reale: <span className="font-semibold text-white">{cur(totalBalanceAll)}</span></p>
                : <p className="text-xs text-white/70 mt-2.5">Somma di tutti i tuoi fondi · {periodLabel}</p>}
              <div className="mt-6 grid grid-cols-4 gap-1.5 sm:gap-3">
                <button onClick={openAddPlanned} className="flex flex-col items-center gap-1.5 px-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors active:scale-95 min-w-0">
                  <CalendarClock className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-white/90 leading-tight text-center w-full">Pianifica</span>
                </button>
                <Link to="/transazioni" className="flex flex-col items-center gap-1.5 px-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors active:scale-95 min-w-0">
                  <ArrowLeftRight className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-white/90 leading-tight text-center w-full">Transazioni</span>
                </Link>
                <Link to="/budget" className="flex flex-col items-center gap-1.5 px-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors active:scale-95 min-w-0">
                  <PiggyBank className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-white/90 leading-tight text-center w-full">Budget</span>
                </Link>
                <Link to="/previsione" className="flex flex-col items-center gap-1.5 px-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors active:scale-95 min-w-0">
                  <LineChart className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-white/90 leading-tight text-center w-full">Previsione</span>
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Card icon={TrendingUp} color="bg-emerald-500/15 text-emerald-600" tint="bg-emerald-50 border-emerald-100" label={`Entrate del Periodo (${periodLabel})`} value={cur(est.income)} valueColor="text-emerald-700" sub={plannedIncomeInPeriod > 0 ? `incl. ${cur(plannedIncomeInPeriod)} pianif.` : undefined} onClick={() => setBreakdownModal('income')} />
              <Card
                icon={Target}
                color={periodNet >= 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-red-500/15 text-red-600'}
                tint={periodNet >= 0 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'}
                label={`Netto del Periodo (${periodLabel})`}
                value={cur(periodNet)}
                valueColor={periodNet >= 0 ? 'text-amber-700' : 'text-red-700'}
                sub={`Entrate ${cur(est.income)} · Uscite ${cur(est.expenses)}${plannedExpensesInPeriod > 0 ? ` (incl. ${cur(plannedExpensesInPeriod)} pianif.)` : ''}`}
                onClick={() => setBreakdownModal('net')}
              />
              {projection && projectionTarget && nextSalary ? (
                <Card
                  icon={projection.balance >= 0 ? TrendingUp : TrendingDown}
                  color={projection.balance >= 0 ? 'bg-violet-500/15 text-violet-600' : 'bg-red-500/15 text-red-600'}
                  tint={projection.balance >= 0 ? 'bg-violet-50 border-violet-100' : 'bg-red-50 border-red-100'}
                  label={`Saldo il ${format(projectionTarget, 'd MMM', { locale: it })}`}
                  value={cur(projection.balance)}
                  valueColor={projection.balance >= 0 ? 'text-violet-700' : 'text-red-700'}
                  sub={`Giorno prima di "${nextSalary.income.name.trim()}"`}
                />
              ) : (
                <Card icon={TrendingDown} color="bg-slate-200 text-slate-400" tint="bg-slate-50 border-slate-200" label="Saldo prossimo stipendio" value="—" sub="Configura un'entrata mensile" />
              )}
            </div>
            <InfoBox title="Come vengono calcolate queste cifre" tone="blue">
              <p><strong>Saldo Totale</strong> (mostrato come <strong>Saldo Filtrato</strong> quando escludi dei fondi col selettore in alto): somma di tutti i fondi inclusi.</p>
              <p><strong>Entrate del Periodo ({periodLabel})</strong>: somma di tutto quello che effettivamente entra nel periodo corrente. Es: se hai stipendio mensile 1500€ + sabato 50€ × 4 occorrenze = 1700€. Una spesa annuale del bollo a marzo non compare se non siamo a marzo.</p>
              <p><strong>Netto del Periodo</strong>: Entrate − Uscite del periodo ({periodLabel}). Click per vedere il dettaglio.</p>
              <p>Queste cifre comprendono sia le voci <strong>previste</strong> (ricorrenti, budget, pianificate) sia le <strong>transazioni manuali</strong> già registrate nel periodo: ogni movimento che aggiungi, modifichi o elimini si riflette qui (badge <span className="font-medium text-cyan-700">EFFETTIVA</span>).</p>
              <p><strong>Budget</strong>: per le settimane <strong>già concluse</strong> conta quanto hai <strong>speso davvero</strong> (le transazioni del budget); per la settimana <strong>in corso</strong> conta il <strong>maggiore tra quota e speso</strong> (così uno <strong>sforamento</strong> si riflette subito, ma sotto la quota resta la stima conservativa); le settimane <strong>future</strong> contano la <strong>quota stimata</strong> (la previsione). L'avanzo non speso <strong>non</strong> viene conteggiato come entrata.</p>
              {projection && projectionTarget && nextSalary && (
                <p>
                  <strong>Saldo il {format(projectionTarget, 'd MMM', { locale: it })}</strong>: proiezione del saldo il giorno PRIMA del prossimo stipendio ({nextSalary.income.name.trim()}, atteso il {format(nextSalary.date, 'd MMM', { locale: it })}).
                  Conta <strong>TUTTO</strong>: ricorrenti, budget settimanali, spese variabili (GPL/benzina come stima), pianificate.
                  Da oggi al {format(projectionTarget, 'd MMM', { locale: it })}: <span className="text-emerald-600">+{cur(projection.totalIncome)}</span> entrate, <span className="text-red-500">-{cur(projection.totalExpenses)}</span> uscite.
                </p>
              )}
              <p className="text-amber-700"><strong>Nota su GPL/Benzina</strong>: usate come <strong>stime fisse</strong> per la previsione (es. 30€/sett GPL). Se in alcuni mesi spendi diversamente (25€ invece di 30€), modifica l'importo nella pagina <strong>Spese Ricorrenti</strong>. Quando registri il rifornimento puoi inserire km/litri per vedere i consumi reali.</p>
            </InfoBox>
          </>
        )
      })()}

      {(pendingRecurringManual.length > 0 || pendingIncome.length > 0 || pendingAutoUpcoming.length > 0) && (
        <div className="mb-6 sm:mb-8">
          <InfoBox title="Come funzionano le Prossime Scadenze" tone="emerald">
            <p>Tutte le voci del periodo corrente ({periodLabel}): cosa devi <strong>confermare</strong> e cosa verrà scalato in <strong>automatico</strong>.</p>
            <p><strong>Spese fisse del mese</strong>: spese ricorrenti manuali. Clicca "Paga" → puoi modificare l'importo prima di registrare, poi viene creata la transazione e aggiornato il saldo del fondo.</p>
            <p><strong>Entrate da confermare</strong>: ogni sabato lavorato (con la data di pagamento attesa) e lo stipendio mensile. "Non lavorato" su un sabato → memo che lo segna come gestito senza generare entrata.</p>
            <p><strong>Spese automatiche</strong>: vengono scalate da sole dal fondo nel giorno previsto. Qui le vedi solo come promemoria — non c'è nulla da confermare.</p>
          </InfoBox>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-slate-700 whitespace-nowrap">Prossime Scadenze</h3>
            </div>
            {pendingRecurringManual.length > 0 && (
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full whitespace-nowrap">
                {confirmedRecurringCount}/{pendingRecurringManual.length} spese fisse confermate
              </span>
            )}
          </div>

          {pendingRecurringManual.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Spese Fisse del Mese</p>
              {(() => {
                const renderItem = (item: PendingItem) => {
                  const borderColor = item.confirmed ? 'border-l-emerald-400 opacity-60' : item.kind === 'transfer' ? 'border-l-blue-400' : 'border-l-red-400'
                  const btnClass = item.kind === 'transfer' ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-red-50 text-red-600 hover:bg-red-100'
                  const btnLabel = item.kind === 'transfer' ? 'Trasferisci' : 'Paga'
                  return (
                    <div key={item.id} className={`bg-white rounded-xl border-l-4 border border-slate-200 p-4 flex items-center justify-between gap-3 ${borderColor}`}>
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium text-slate-800 break-words ${item.confirmed ? 'line-through' : ''}`}>{item.name}</p>
                        <p className="text-xs text-slate-500 break-words">{item.label} · {cur(item.amount)}</p>
                      </div>
                      {item.confirmed ? (
                        <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium shrink-0">
                          <Check className="w-4 h-4" aria-hidden="true" /> Fatto
                        </span>
                      ) : (
                        <button
                          onClick={() => openConfirm(item)}
                          className={`inline-flex items-center justify-center min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium transition-[transform,background-color] active:scale-[0.98] shrink-0 ${btnClass}`}
                        >
                          {btnLabel}
                        </button>
                      )}
                    </div>
                  )
                }
                const daPagare = pendingRecurringManual.filter(p => !p.confirmed)
                const giaFatte = pendingRecurringManual.filter(p => p.confirmed)
                return (
                  <div className="space-y-3">
                    {daPagare.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-red-600 mb-1.5 uppercase tracking-wide">Da pagare ({daPagare.length})</p>
                        <div className="space-y-2">{daPagare.map(renderItem)}</div>
                      </div>
                    )}
                    {giaFatte.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Già fatte ({giaFatte.length})</p>
                        <div className="space-y-2">{giaFatte.map(renderItem)}</div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {pendingIncome.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Entrate da Confermare ({pendingIncome.length})</p>
              <div className="space-y-2">
                {pendingIncome.map(item => {
                  const isWeekly = item.occurrence?.income.frequency === 'weekly'
                  return (
                    <div key={item.id} className="bg-white rounded-xl border-l-4 border-l-emerald-500 border border-slate-200 p-4 flex items-center justify-between flex-wrap gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800 break-words">{item.name}</p>
                        <p className="text-xs text-slate-500 break-words">{item.label} · ~{cur(item.amount)}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {isWeekly && (
                          <button
                            onClick={() => skipIncomeOccurrence(item)}
                            className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 active:scale-[0.98] transition-[transform,background-color]"
                            title="Segnala come non lavorato (non genera entrata)"
                          >
                            Non lavorato
                          </button>
                        )}
                        <button
                          onClick={() => openConfirm(item)}
                          className="inline-flex items-center justify-center min-h-[40px] px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-100 active:scale-[0.98] transition-[transform,background-color]"
                        >
                          Ricevuto
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {pendingAutoUpcoming.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Spese Automatiche in arrivo ({pendingAutoUpcoming.length})</p>
              <div className="space-y-2">
                {pendingAutoUpcoming.map(item => {
                  const due = new Date((item.occurrence_date as string) + 'T00:00:00')
                  return (
                    <div key={item.id} className="bg-white rounded-xl border-l-4 border-l-emerald-400 border border-slate-200 p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-slate-800 truncate">{item.name}</p>
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium">Automatica</span>
                        </div>
                        <p className="text-xs text-slate-500">{format(due, 'EEE d MMM', { locale: it })} · si scalerà da sola</p>
                      </div>
                      <span className="text-sm font-semibold tracking-tight text-slate-500 shrink-0">-{cur(item.amount)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {(() => {
        const { start: pStart, end: pEnd } = getBillingPeriod()
        const periodPlanned = planned.filter(p => p.date >= pStart && p.date <= pEnd)
        const futurePlanned = planned.filter(p => p.date > pEnd)
        if (planned.length === 0) return null
        return (
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-purple-600" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-slate-700">Pianificate del periodo</h3>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{periodPlanned.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPlannedListOpen(true)} className="inline-flex items-center min-h-[40px] text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors">
                  Vedi tutte ({planned.length})
                </button>
                <button onClick={openAddPlanned} className="inline-flex items-center gap-1 min-h-[40px] text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Aggiungi
                </button>
              </div>
            </div>
            {periodPlanned.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
                Nessuna pianificata in questo periodo
                {futurePlanned.length > 0 && <span> · {futurePlanned.length} future visibili nella vista completa</span>}
              </div>
            ) : (
              <div className="space-y-2">
                {periodPlanned.map(p => {
                  const fundName = funds.find(f => f.id === p.fund_id)?.name
                  // Solo-data in locale: una pianificata in scadenza OGGI non è "scaduta".
                  const isPast = p.date < today
                  return (
                    <div key={p.id} className={`bg-white rounded-xl border-l-4 ${p.type === 'income' ? 'border-l-emerald-500' : 'border-l-purple-500'} border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-slate-800 break-words">{p.description}</p>
                          {isPast && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium uppercase">scaduta</span>}
                        </div>
                        <p className="text-xs text-slate-500">
                          {fmtDate(p.date)}
                          {fundName && ` · ${fundName}`}
                          {' · '}{p.type === 'income' ? '+' : '-'}{cur(Number(p.amount))}
                        </p>
                      </div>
                      <div className="flex items-center justify-end gap-1 shrink-0 w-full sm:w-auto">
                        <button onClick={() => openCompletePlanned(p)} className="inline-flex items-center justify-center min-h-[40px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 active:scale-[0.98] transition-[transform,background-color]">
                          Fatto
                        </button>
                        <button onClick={() => openEditPlanned(p)} aria-label="Modifica pianificazione" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 active:scale-90 transition-[transform,background-color,color]">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => deletePlanned(p.id)} aria-label="Elimina pianificazione" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 active:scale-90 transition-[transform,background-color,color]">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      <div className="mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">I tuoi Fondi</h3>
          <Link to="/fondi" className="text-[13px] text-slate-500 hover:text-slate-700 font-medium inline-flex items-center gap-1 min-h-[40px] transition-colors">
            Gestisci <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mainFunds.map(fund => {
            const Icon = iconMap[fund.icon] || Wallet
            const subs = subFunds.filter(s => s.parent_id === fund.id)
            const totalWithSubs = Number(fund.balance) + subs.reduce((s, sf) => s + Number(sf.balance), 0)
            return (
              <div key={fund.id} className="rounded-2xl border border-slate-200/70 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200" style={{ background: `linear-gradient(135deg, ${fund.color}1A 0%, #ffffff 60%)` }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: fund.color }}>
                    <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{fund.name}</p>
                    <p className="text-[11px] text-slate-400">{subs.length > 0 ? `Totale: ${cur(totalWithSubs)}` : ''}</p>
                  </div>
                </div>
                <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-900">{cur(Number(fund.balance))}</p>
                {subs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                    {subs.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between text-[13px]">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <PiggyBank className="w-3 h-3" aria-hidden="true" /> {sub.name}
                        </span>
                        <span className="font-medium text-slate-700">{cur(Number(sub.balance))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Previsione 3 Mesi</h3>
            <Link to="/previsione" className="text-[13px] text-slate-500 hover:text-slate-700 font-medium inline-flex items-center gap-1 min-h-[40px] transition-colors">
              Vedi tutto <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          </div>
          {forecast.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={forecast}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis width={46} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => isAmountsHidden() ? '•' : fmtAxisEur(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="balance" stroke="#3B82F6" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">Configura entrate e uscite per vedere la previsione</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold tracking-tight text-slate-900">Ultime Transazioni</h3>
              <Clock className="w-4 h-4 text-slate-300" aria-hidden="true" />
            </div>
            {recentTx.length > 0 ? (
              <div className="space-y-0 max-h-80 overflow-y-auto">
                {recentTx.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-700 truncate">{tx.description}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {fmtDate(tx.date)} &middot; {catLabel(tx.category)}
                      </p>
                    </div>
                    <span className={`text-[13px] font-semibold tracking-tight tabular-nums shrink-0 ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-red-500' : 'text-blue-600'}`}>
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{cur(Number(tx.amount))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-slate-400 py-4 text-center">Nessuna transazione nel periodo</p>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={!!confirmItem} onClose={() => setConfirmItem(null)} title={confirmItem?.kind === 'transfer' ? 'Conferma Trasferimento' : confirmItem?.kind === 'income' ? 'Conferma Entrata' : 'Conferma Pagamento'}>
        {confirmItem && (
          <div className="space-y-4">
            <div className={`p-3 rounded-lg ${confirmItem.kind === 'income' ? 'bg-emerald-50' : confirmItem.kind === 'transfer' ? 'bg-blue-50' : 'bg-red-50'}`}>
              <p className={`font-medium ${confirmItem.kind === 'income' ? 'text-emerald-700' : confirmItem.kind === 'transfer' ? 'text-blue-700' : 'text-red-700'}`}>{confirmItem.name}</p>
              <p className={`text-xs ${confirmItem.kind === 'income' ? 'text-emerald-500' : confirmItem.kind === 'transfer' ? 'text-blue-500' : 'text-red-500'}`}>{confirmItem.label}</p>
              <p className="text-xs text-slate-500 mt-1">Importo previsto: <span className="font-semibold">{cur(confirmItem.amount)}</span></p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">
              Modifica l'importo qui sotto se hai pagato/ricevuto una cifra diversa da quella prevista. La spesa/entrata ricorrente NON viene modificata, solo questa transazione.
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {confirmItem.kind === 'income' ? 'Importo effettivamente ricevuto (€)' : confirmItem.kind === 'transfer' ? 'Importo effettivamente trasferito (€)' : 'Importo effettivamente pagato (€)'}
              </label>
              <div className="relative">
                <DecimalInput
                  value={confirmAmount}
                  onChange={setConfirmAmount}
                  className={`w-full px-3 py-2.5 border-2 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-lg font-semibold ${confirmAmount !== confirmItem.amount ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'}`}
                />
                {confirmAmount !== confirmItem.amount && (
                  <button
                    type="button"
                    onClick={() => setConfirmAmount(confirmItem.amount)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 hover:text-blue-700 bg-white px-2 py-1 rounded-md border border-slate-200 active:scale-[0.98] transition-[transform,color]"
                  >
                    Ripristina {cur(confirmItem.amount)}
                  </button>
                )}
              </div>
              {confirmAmount !== confirmItem.amount && (
                <p className={`text-xs mt-1 ${confirmAmount > confirmItem.amount ? 'text-red-600' : 'text-emerald-600'}`}>
                  {confirmAmount > confirmItem.amount ? '+' : ''}{cur(confirmAmount - confirmItem.amount)} rispetto al previsto
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data effettiva</label>
              <input
                type="date"
                value={confirmDate}
                onChange={e => setConfirmDate(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow ${confirmItem.occurrence_date && confirmDate !== confirmItem.occurrence_date ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'}`}
              />
              {confirmItem.occurrence_date && confirmDate !== confirmItem.occurrence_date && (
                <p className="text-xs text-slate-500 mt-1">
                  Previsto il {format(new Date(confirmItem.occurrence_date + 'T00:00:00'), 'd MMM', { locale: it })}. Conta la data effettiva qui sopra; quella prevista resta registrata.
                </p>
              )}
            </div>
            {confirmItem.kind === 'expense' && confirmItem.category === FUEL_CATEGORY && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Dati rifornimento (facoltativi)</p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo carburante</label>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo carburante">
                    {(['gpl', 'benzina'] as const).map(ft => (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setConfirmFuelType(ft)}
                        aria-pressed={confirmFuelType === ft}
                        className={`min-h-[40px] py-2 rounded-lg text-sm font-medium border active:scale-[0.98] transition-[transform,background-color,border-color,color] ${confirmFuelType === ft ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      >
                        {FUEL_TYPE_LABEL[ft]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Contachilometri (km totali)</label>
                  <input
                    type="text" inputMode="decimal"
                    value={confirmFuelOdometer}
                    onChange={e => setConfirmFuelOdometer(e.target.value)}
                    placeholder="es. 124500"
                    className="w-full min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Litri</label>
                    <input type="text" inputMode="decimal" value={confirmFuelLiters} onChange={e => setConfirmFuelLiters(e.target.value)} placeholder="es. 30" className="w-full min-w-0 px-2 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-600 mb-1">€/litro</label>
                    <input type="text" inputMode="decimal" value={confirmFuelPrice} onChange={e => setConfirmFuelPrice(e.target.value)} placeholder="es. 1,80" className="w-full min-w-0 px-2 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
                  </div>
                </div>
                {(() => {
                  const odo = parseDecimal(confirmFuelOdometer)
                  const beforeDate = confirmDate || todayString()
                  const ref = { id: '', date: beforeDate, created_at: new Date().toISOString(), fuel_type: confirmFuelType, fuel_odometer: odo > 0 ? odo : null }
                  const stats = odo > 0 ? fuelStatsOdometer(ref, confirmFuelFills) : null
                  const lifeCost = lifetimeCostPerKmOdometer(confirmFuelFills)
                  const stima = lifetimePerFuelStima(confirmFuelFills, confirmFuelType)
                  return (
                    <div className="space-y-1">
                      {odo > 0 && (
                        stats && (stats.costPerKm != null || stats.kmPerLiter != null) ? (
                          <p className="text-xs text-slate-600">
                            {stats.costPerKm != null && <><span className="font-semibold text-slate-800">{cur(stats.costPerKm)}/km</span> reale</>}
                            {stats.costPerKm != null && stats.kmPerLiter != null && ' · '}
                            {stats.kmPerLiter != null && <>{FUEL_TYPE_LABEL[confirmFuelType]} <span className="font-semibold text-slate-800">~{stats.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span> (stima)</>}
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-600">Serve un rifornimento precedente col contachilometri per calcolare €/km e la stima.</p>
                        )
                      )}
                      {(lifeCost != null || stima) && (
                        <p className="text-xs text-slate-600">
                          Media:
                          {lifeCost != null && <> <span className="font-semibold text-slate-800">{cur(lifeCost)}/km</span> reale</>}
                          {lifeCost != null && stima && ' ·'}
                          {stima && <> {FUEL_TYPE_LABEL[confirmFuelType]} <span className="font-semibold text-slate-800">~{stima.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span> (stima)</>}
                        </p>
                      )}
                    </div>
                  )
                })()}
                <p className="text-[11px] text-slate-400">Inserisci la lettura del <strong>contachilometri</strong> (km totali). Per le auto bifuel il <strong>€/km è reale</strong>; il km/l per carburante è una <strong>stima</strong>. Dati solo per i consumi: non modificano l'importo pagato qui sopra.</p>
              </div>
            )}
            {confirmItem.kind !== 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {confirmItem.kind === 'income' ? 'Accredita su' : 'Paga con'}
                </label>
                <select value={confirmFundId} onChange={e => setConfirmFundId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                  <option value="">Nessun fondo</option>
                  {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={handleConfirm} disabled={confirmSaving || confirmAmount <= 0} className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color] text-sm">
                {confirmSaving ? 'Registrazione...' : 'Conferma e registra'}
              </button>
              <button onClick={handleMarkOnly} disabled={confirmSaving} className="py-2.5 px-4 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color] text-sm" title="Marca come fatto senza modificare il saldo dei fondi">
                Segna senza scalare
              </button>
            </div>
            <p className="text-[11px] text-slate-400 text-center -mt-1">
              «Conferma e registra» {confirmItem.kind === 'income' ? 'accredita il fondo' : 'scala il fondo'} e conta nei totali. «Segna senza scalare» conta nei totali del periodo ma <strong>non</strong> tocca il saldo dei fondi.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!breakdownModal}
        onClose={() => setBreakdownModal(null)}
        title={breakdownModal === 'income' ? `Entrate del periodo (${periodLabel})` : breakdownModal === 'net' ? `Netto del periodo (${periodLabel})` : `Uscite del periodo (${periodLabel})`}
      >
        {breakdownModal && (() => {
          const { startDate, endDate } = getBillingPeriodFor(new Date())
          const breakdown = getPeriodBreakdown({
            startDate, endDate,
            recurringExpenses: expenses, recurringIncome: income,
            weeklyBudgets: budgets, planned,
            excludedFundIds, fromToday: false,
            actualTx: periodTx,
            includeActualOneOffs: true,
            reconcileBudgets: true,
          })
          const detail = breakdownModal === 'income' ? 'tutte le entrate' : breakdownModal === 'net' ? 'tutte le entrate e le uscite' : 'tutte le uscite'
          return (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Dettaglio di {detail} previste nel periodo corrente. Include ricorrenti, budget settimanali (1× per settimana), spese variabili e pianificate una tantum.
              </p>
              <div className="max-h-[60vh] overflow-y-auto">
                <BreakdownList items={breakdown} kind={breakdownModal === 'net' ? 'both' : breakdownModal} emptyText="Nessuna voce nel periodo" />
              </div>
            </div>
          )
        })()}
      </Modal>

      <Modal isOpen={!!completePlannedItem} onClose={() => setCompletePlannedItem(null)} title="Completa pianificazione">
        {completePlannedItem && (
          <div className="space-y-4">
            <div className={`p-3 rounded-lg ${completePlannedItem.type === 'income' ? 'bg-emerald-50' : 'bg-purple-50'}`}>
              <p className={`font-medium ${completePlannedItem.type === 'income' ? 'text-emerald-700' : 'text-purple-700'}`}>{completePlannedItem.description}</p>
              <p className="text-xs text-slate-500 mt-1">Previsto: {cur(Number(completePlannedItem.amount))} · {format(new Date(completePlannedItem.date), 'd MMM yyyy', { locale: it })}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">
              Modifica l'importo se hai {completePlannedItem.type === 'income' ? 'ricevuto' : 'speso'} una cifra diversa dal previsto. Verrà registrata come transazione effettiva.
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {completePlannedItem.type === 'income' ? 'Importo ricevuto (€)' : 'Importo speso (€)'}
              </label>
              <div className="relative">
                <DecimalInput
                  value={completeAmount}
                  onChange={setCompleteAmount}
                  className={`w-full px-3 py-2.5 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg font-semibold ${completeAmount !== Number(completePlannedItem.amount) ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'}`}
                />
                {completeAmount !== Number(completePlannedItem.amount) && (
                  <button
                    type="button"
                    onClick={() => setCompleteAmount(Number(completePlannedItem.amount))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 hover:text-blue-700 bg-white px-2 py-1 rounded-md border border-slate-200 active:scale-[0.98] transition-[transform,color]"
                  >
                    Ripristina {cur(Number(completePlannedItem.amount))}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data effettiva</label>
              <input
                type="date"
                value={completeDate}
                onChange={e => setCompleteDate(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow ${completeDate !== completePlannedItem.date ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'}`}
              />
              {completeDate !== completePlannedItem.date && (
                <p className="text-xs text-slate-500 mt-1">
                  Previsto il {format(new Date(completePlannedItem.date + 'T00:00:00'), 'd MMM', { locale: it })}. Conta la data effettiva; quella prevista resta registrata.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {completePlannedItem.type === 'income' ? 'Accredita su' : 'Paga con'}
              </label>
              <select value={completeFundId} onChange={e => setCompleteFundId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                <option value="">Nessun fondo</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
              </select>
            </div>
            <button onClick={confirmCompletePlanned} disabled={completeSaving || completeAmount <= 0} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]">
              {completeSaving ? 'Completamento...' : 'Conferma e registra'}
            </button>
          </div>
        )}
      </Modal>

      <Modal isOpen={plannedListOpen} onClose={() => setPlannedListOpen(false)} title={`Tutte le pianificazioni (${planned.length})`}>
        {planned.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-6">Nessuna pianificazione</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {planned.map(p => {
              const fundName = funds.find(f => f.id === p.fund_id)?.name
              const isPast = p.date < today
              return (
                <div key={p.id} className={`bg-white rounded-lg border-l-4 ${p.type === 'income' ? 'border-l-emerald-500' : 'border-l-purple-500'} border border-slate-200 p-3 flex items-center justify-between gap-2`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-slate-800 break-words">{p.description}</p>
                      {isPast && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium uppercase">scaduta</span>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {fmtDate(p.date)}
                      {fundName && ` · ${fundName}`}
                      {' · '}{p.type === 'income' ? '+' : '-'}{cur(Number(p.amount))}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => openCompletePlanned(p)} className="inline-flex items-center justify-center min-h-[40px] px-2.5 py-1 bg-purple-50 text-purple-700 rounded text-xs font-medium hover:bg-purple-100 active:scale-[0.98] transition-[transform,background-color]">
                      Fatto
                    </button>
                    <button onClick={() => openEditPlanned(p)} aria-label="Modifica pianificazione" className="inline-flex items-center justify-center w-10 h-10 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 active:scale-90 transition-[transform,background-color,color]">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deletePlanned(p.id)} aria-label="Elimina pianificazione" className="inline-flex items-center justify-center w-10 h-10 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 active:scale-90 transition-[transform,background-color,color]">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal isOpen={plannedModal} onClose={() => { setPlannedModal(false); setEditingPlanned(null) }} title={editingPlanned ? 'Modifica pianificazione' : 'Pianifica spesa o entrata'}>
        <div className="space-y-4">
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
            Le pianificazioni appariranno nelle previsioni ma non intaccheranno il saldo dei fondi finché non le segnerai come fatte.
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo">
              <button onClick={() => setPlannedForm({ ...plannedForm, type: 'expense' })} aria-pressed={plannedForm.type === 'expense'} className={`min-h-[40px] py-2 rounded-lg text-sm font-medium border active:scale-[0.98] transition-[transform,background-color,border-color,color] ${plannedForm.type === 'expense' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                Uscita
              </button>
              <button onClick={() => setPlannedForm({ ...plannedForm, type: 'income' })} aria-pressed={plannedForm.type === 'income'} className={`min-h-[40px] py-2 rounded-lg text-sm font-medium border active:scale-[0.98] transition-[transform,background-color,border-color,color] ${plannedForm.type === 'income' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                Entrata
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={plannedForm.description} onChange={e => setPlannedForm({ ...plannedForm, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Vacanza estate, Rimborso..." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput value={plannedForm.amount} onChange={n => setPlannedForm({ ...plannedForm, amount: n })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-slate-700 mb-1">Data prevista</label>
              <input type="date" value={plannedForm.date} onChange={e => setPlannedForm({ ...plannedForm, date: e.target.value })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo (opzionale)</label>
            <select value={plannedForm.fund_id} onChange={e => setPlannedForm({ ...plannedForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Scegli al completamento</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <CategorySelect value={plannedForm.category} onChange={c => setPlannedForm({ ...plannedForm, category: c })} baseCategories={TRANSACTION_CATEGORIES} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow capitalize" />
          </div>
          <button onClick={savePlanned} disabled={plannedSaving || plannedForm.amount <= 0 || !plannedForm.description.trim()} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]">
            {plannedSaving ? 'Salvataggio...' : editingPlanned ? 'Salva modifiche' : 'Aggiungi pianificazione'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Card({ icon: Icon, color, label, value, valueColor, sub, onClick, tint }: { icon: React.ElementType; color: string; label: string; value: string; valueColor?: string; sub?: string; onClick?: () => void; tint?: string }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-2xl border shadow-sm p-5 text-left w-full ${tint || 'bg-white border-slate-200/70'} ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
        </div>
        <span className="text-[13px] font-medium text-slate-500 flex-1 leading-snug">{label}</span>
      </div>
      <p className={`text-2xl font-bold tracking-tight tabular-nums ${valueColor || 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{sub}</p>}
    </Wrapper>
  )
}
