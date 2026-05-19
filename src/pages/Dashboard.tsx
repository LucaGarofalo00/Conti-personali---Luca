import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Wallet, TrendingUp, TrendingDown, Target, ArrowRight, Calendar, PiggyBank, CheckCircle2, Check, Clock, CalendarClock, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import FundExcluder from '../components/FundExcluder'
import SchemaBanner from '../components/SchemaBanner'
import { generateForecast, getMonthlyEstimates } from '../lib/forecast'
import { cur, iconMap, getBillingPeriod, getDateInCurrentPeriod, formatDayMonth, todayString, TRANSACTION_CATEGORIES } from '../lib/utils'
import { useExcludedFunds } from '../lib/excludedFunds'
import { processAutoDeducts } from '../lib/autoDeduct'
import { markPlannedAsDone } from '../lib/plannedTransactions'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense, Transaction } from '../types'

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
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; balance: number; income: number; expenses: number } }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200 text-sm">
      <p className="font-medium text-slate-700 mb-1">{d.label}</p>
      <p className="text-indigo-600">Saldo: {cur(d.balance)}</p>
      <p className="text-emerald-600">Entrate: {cur(d.income)}</p>
      <p className="text-red-500">Uscite: {cur(d.expenses)}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const [funds, setFunds] = useState<Fund[]>([])
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [income, setIncome] = useState<RecurringIncome[]>([])
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [varExp, setVarExp] = useState<VariableExpense[]>([])
  const [periodTx, setPeriodTx] = useState<Transaction[]>([])
  const [planned, setPlanned] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [excludedFundIds, , toggleExcluded] = useExcludedFunds()

  const [confirmItem, setConfirmItem] = useState<PendingItem | null>(null)
  const [confirmAmount, setConfirmAmount] = useState(0)
  const [confirmFundId, setConfirmFundId] = useState('')
  const [confirmSaving, setConfirmSaving] = useState(false)

  const [plannedModal, setPlannedModal] = useState(false)
  const [plannedForm, setPlannedForm] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: 0, description: '', fund_id: '', category: 'altro', date: todayString(),
  })
  const [plannedSaving, setPlannedSaving] = useState(false)

  const load = async () => {
    try {
      const { start: periodStart, end: periodEnd } = getBillingPeriod()

      const [f, e, i, b, v] = await Promise.all([
        supabase.from('funds').select('*').order('sort_order'),
        supabase.from('recurring_expenses').select('*'),
        supabase.from('recurring_income').select('*'),
        supabase.from('weekly_budgets').select('*'),
        supabase.from('variable_expenses').select('*'),
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
        console.error('Errore tx:', txRes.error)
        toast.error('Errore caricamento transazioni: ' + txRes.error.message)
      } else {
        periodTxData = txRes.data || []
      }

      const plRes = await supabase.from('transactions').select('*').eq('is_planned', true).order('date', { ascending: true })
      if (plRes.error && /column.*is_planned.*does not exist/i.test(plRes.error.message || '')) {
        if (!missing.includes('transactions.is_planned')) missing.push('transactions.is_planned')
      } else if (plRes.error) {
        console.error('Errore planned:', plRes.error)
      } else {
        plannedData = plRes.data || []
      }

      const firstError = [f, e, i, b, v].find(r => r.error)?.error
      if (firstError) {
        console.error('Errore Supabase:', firstError)
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
      setVarExp(v.data || [])
      setPeriodTx(finalPeriodTx)
      setPlanned(plannedData)
      setMissingColumns(missing)
    } catch (err) {
      console.error('Errore fatale in load:', err)
      toast.error('Errore imprevisto: controlla la console (F12)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) load() }, [user])

  const today = todayString()

  const isItemConfirmed = (name: string, type: string) =>
    periodTx.some(tx => tx.description === name && (type === 'transfer' ? tx.type === 'transfer' : tx.type === 'expense'))

  const pendingRecurring: PendingItem[] = expenses
    .filter(exp => exp.is_active && !exp.auto_deduct && (!exp.end_date || exp.end_date >= today))
    .sort((a, b) => {
      const aDate = getDateInCurrentPeriod(a.day_of_month).getTime()
      const bDate = getDateInCurrentPeriod(b.day_of_month).getTime()
      return aDate - bDate
    })
    .map(exp => {
      const isTransfer = (exp.type || 'expense') === 'transfer'
      const fromName = funds.find(f => f.id === exp.fund_id)?.name
      const toName = funds.find(f => f.id === exp.fund_to_id)?.name
      return {
        id: 'rec-' + exp.id,
        kind: isTransfer ? 'transfer' as const : 'expense' as const,
        name: exp.name,
        amount: Number(exp.amount),
        fund_id: exp.fund_id,
        fund_to_id: exp.fund_to_id || null,
        category: exp.category,
        label: isTransfer
          ? `${formatDayMonth(exp.day_of_month)} · ${fromName || '?'} → ${toName || '?'}`
          : `${formatDayMonth(exp.day_of_month)} · ${exp.category}`,
        confirmed: isItemConfirmed(exp.name, isTransfer ? 'transfer' : 'expense'),
      }
    })

  const pendingIncome: PendingItem[] = income
    .filter(i => i.is_active && i.frequency === 'weekly')
    .map(i => ({
      id: 'inc-' + i.id,
      kind: 'income' as const,
      name: i.name,
      amount: Number(i.amount),
      fund_id: i.fund_id,
      fund_to_id: null,
      category: 'lavoro',
      label: 'Entrata settimanale',
      confirmed: false,
    }))

  const pendingVarExp: PendingItem[] = varExp
    .filter(v => v.is_active && v.needs_confirmation)
    .map(v => ({
      id: 'var-' + v.id,
      kind: 'expense' as const,
      name: v.name,
      amount: Number(v.estimated_amount),
      fund_id: v.fund_id,
      fund_to_id: null,
      category: v.category,
      label: v.frequency === 'weekly' ? 'Spesa variabile settimanale' : 'Spesa variabile mensile',
      confirmed: false,
    }))

  const confirmedRecurringCount = pendingRecurring.filter(p => p.confirmed).length

  const openConfirm = (item: PendingItem) => {
    setConfirmItem(item)
    setConfirmAmount(item.amount)
    setConfirmFundId(item.fund_id || '')
  }

  const handleConfirm = async () => {
    if (!confirmItem || confirmAmount <= 0) return
    setConfirmSaving(true)

    const fundId = confirmFundId || null
    const fundToId = confirmItem.kind === 'transfer' ? (confirmItem.fund_to_id || null) : null
    const txType = confirmItem.kind === 'transfer' ? 'transfer' : confirmItem.kind === 'income' ? 'income' : 'expense'

    await supabase.from('transactions').insert({
      user_id: user!.id,
      type: txType,
      amount: confirmAmount,
      description: confirmItem.name,
      fund_id: fundId,
      fund_to_id: fundToId,
      category: confirmItem.category,
      date: todayString(),
    })

    if (confirmItem.kind === 'transfer' && fundId && fundToId) {
      const [{ data: from }, { data: to }] = await Promise.all([
        supabase.from('funds').select('balance').eq('id', fundId).single(),
        supabase.from('funds').select('balance').eq('id', fundToId).single(),
      ])
      if (from) await supabase.from('funds').update({ balance: Number(from.balance) - confirmAmount }).eq('id', fundId)
      if (to) await supabase.from('funds').update({ balance: Number(to.balance) + confirmAmount }).eq('id', fundToId)
    } else if (fundId) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
      if (fund) {
        const delta = confirmItem.kind === 'income' ? confirmAmount : -confirmAmount
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fundId)
      }
    }

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success(confirmItem.kind === 'transfer' ? 'Trasferimento registrato' : confirmItem.kind === 'income' ? 'Entrata registrata' : 'Spesa registrata')
    load()
  }

  const savePlanned = async () => {
    if (plannedForm.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    if (!plannedForm.description.trim()) { toast.error('Inserisci una descrizione'); return }
    if (!plannedForm.date) { toast.error('Inserisci una data'); return }
    setPlannedSaving(true)
    const { error } = await supabase.from('transactions').insert({
      user_id: user!.id,
      type: plannedForm.type,
      amount: plannedForm.amount,
      description: plannedForm.description,
      fund_id: plannedForm.fund_id || null,
      fund_to_id: null,
      category: plannedForm.category,
      date: plannedForm.date,
      is_planned: true,
    })
    setPlannedSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success('Pianificazione aggiunta')
    setPlannedModal(false)
    setPlannedForm({ type: 'expense', amount: 0, description: '', fund_id: '', category: 'altro', date: todayString() })
    load()
  }

  const completePlanned = async (p: Transaction) => {
    const { error } = await markPlannedAsDone(p)
    if (error) { toast.error('Errore nel completamento'); return }
    toast.success('Pianificazione completata')
    load()
  }

  const deletePlanned = async (id: string) => {
    if (!confirm('Eliminare questa pianificazione?')) return
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { toast.error('Errore'); return }
    toast.success('Pianificazione eliminata')
    load()
  }

  const handleMarkOnly = async () => {
    if (!confirmItem) return
    setConfirmSaving(true)

    await supabase.from('transactions').insert({
      user_id: user!.id,
      type: confirmItem.kind === 'income' ? 'income' : 'expense',
      amount: confirmItem.amount,
      description: confirmItem.name,
      fund_id: null,
      fund_to_id: null,
      category: confirmItem.category,
      is_memo: true,
      date: todayString(),
    })

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success('Segnato come pagato')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const includedFunds = funds.filter(f => !excludedFundIds.includes(f.id))
  const totalBalance = includedFunds.reduce((s, f) => s + Number(f.balance), 0)
  const totalBalanceAll = funds.reduce((s, f) => s + Number(f.balance), 0)
  const hasExclusions = excludedFundIds.some(id => funds.some(f => f.id === id))
  const est = getMonthlyEstimates(expenses, income, budgets, varExp, excludedFundIds)
  const forecast = generateForecast(funds, expenses, income, budgets, varExp, 3, excludedFundIds, planned)
  const mainFunds = funds.filter(f => f.type === 'main')
  const subFunds = funds.filter(f => f.type === 'sub')
  const { end: pEnd } = getBillingPeriod()
  const periodEndDate = new Date(pEnd)
  const nowDate = new Date()

  const upcoming = expenses
    .filter(e => e.is_active && (!e.end_date || e.end_date >= today))
    .map(e => ({ ...e, dueDate: getDateInCurrentPeriod(e.day_of_month) }))
    .filter(e => e.dueDate > nowDate && e.dueDate <= periodEndDate)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 5)

  const recentTx = [...periodTx]
    .filter(tx => !tx.is_memo)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)

  if (funds.length === 0) {
    return (
      <div className="text-center py-16">
        <Wallet className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Benvenuto in FinanzApp!</h2>
        <p className="text-slate-400 mb-6">Inizia configurando i tuoi fondi per gestire le tue finanze</p>
        <Link to="/fondi" className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
          Configura Fondi <ArrowRight className="w-4 h-4" />
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
          <button onClick={() => setPlannedModal(true)} className="flex items-center gap-2 px-3 py-1.5 border border-purple-300 text-purple-700 bg-purple-50 rounded-lg text-sm font-medium hover:bg-purple-100 transition">
            <CalendarClock className="w-3.5 h-3.5" /> Pianifica
          </button>
          <FundExcluder
            funds={funds}
            excludedIds={excludedFundIds}
            onToggle={toggleExcluded}
            onClear={() => excludedFundIds.forEach(id => toggleExcluded(id))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card icon={Wallet} color="bg-indigo-100 text-indigo-600" label={hasExclusions ? 'Saldo Filtrato' : 'Saldo Totale'} value={cur(totalBalance)} />
        <Card icon={TrendingUp} color="bg-emerald-100 text-emerald-600" label="Entrate / Mese" value={cur(est.monthlyIncome)} />
        <Card icon={TrendingDown} color="bg-red-100 text-red-600" label="Uscite / Mese" value={cur(est.monthlyExpenses)} />
        <Card icon={Target} color="bg-amber-100 text-amber-600" label="Netto / Mese" value={cur(est.monthlyNet)} valueColor={est.monthlyNet >= 0 ? 'text-emerald-600' : 'text-red-600'} />
      </div>

      {(pendingRecurring.length > 0 || pendingIncome.length > 0 || pendingVarExp.length > 0) && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-semibold text-slate-700">Da Confermare</h3>
            </div>
            {pendingRecurring.length > 0 && (
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                {confirmedRecurringCount}/{pendingRecurring.length} spese fisse confermate
              </span>
            )}
          </div>

          {pendingRecurring.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Spese Fisse del Mese</p>
              <div className="space-y-2">
                {pendingRecurring.map(item => {
                  const borderColor = item.confirmed ? 'border-l-emerald-400 opacity-60' : item.kind === 'transfer' ? 'border-l-blue-400' : 'border-l-red-400'
                  const btnClass = item.kind === 'transfer' ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-red-50 text-red-600 hover:bg-red-100'
                  const btnLabel = item.kind === 'transfer' ? 'Trasferisci' : 'Paga'
                  return (
                    <div key={item.id} className={`bg-white rounded-xl border-l-4 border border-slate-200 p-4 flex items-center justify-between ${borderColor}`}>
                      <div>
                        <p className={`font-medium text-slate-800 ${item.confirmed ? 'line-through' : ''}`}>{item.name}</p>
                        <p className="text-xs text-slate-400">{item.label} · {cur(item.amount)}</p>
                      </div>
                      {item.confirmed ? (
                        <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                          <Check className="w-4 h-4" /> Fatto
                        </span>
                      ) : (
                        <button
                          onClick={() => openConfirm(item)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${btnClass}`}
                        >
                          {btnLabel}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {pendingIncome.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Entrate da Confermare</p>
              <div className="space-y-2">
                {pendingIncome.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border-l-4 border-l-emerald-500 border border-slate-200 p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.label} · ~{cur(item.amount)}</p>
                    </div>
                    <button
                      onClick={() => openConfirm(item)}
                      className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-100 transition"
                    >
                      Ricevuto
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingVarExp.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Spese Variabili</p>
              <div className="space-y-2">
                {pendingVarExp.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border-l-4 border-l-amber-500 border border-slate-200 p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.label} · ~{cur(item.amount)}</p>
                    </div>
                    <button
                      onClick={() => openConfirm(item)}
                      className="px-4 py-2 bg-amber-50 text-amber-600 rounded-lg text-sm font-medium hover:bg-amber-100 transition"
                    >
                      Pagato
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {planned.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-purple-600" />
              <h3 className="text-lg font-semibold text-slate-700">Pianificate</h3>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{planned.length}</span>
            </div>
            <button onClick={() => setPlannedModal(true)} className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> Aggiungi
            </button>
          </div>
          <div className="space-y-2">
            {planned.slice(0, 5).map(p => {
              const fundName = funds.find(f => f.id === p.fund_id)?.name
              const dueDate = new Date(p.date)
              const isPast = dueDate <= nowDate
              return (
                <div key={p.id} className={`bg-white rounded-xl border-l-4 ${p.type === 'income' ? 'border-l-emerald-500' : 'border-l-purple-500'} border border-slate-200 p-4 flex items-center justify-between`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-800 truncate">{p.description}</p>
                      {isPast && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium uppercase">scaduta</span>}
                    </div>
                    <p className="text-xs text-slate-400">
                      {format(dueDate, 'd MMM yyyy', { locale: it })}
                      {fundName && ` · ${fundName}`}
                      {' · '}{p.type === 'income' ? '+' : '-'}{cur(Number(p.amount))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => completePlanned(p)} className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 transition">
                      Fatto
                    </button>
                    <button onClick={() => deletePlanned(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
            {planned.length > 5 && (
              <p className="text-xs text-slate-400 text-center mt-2">+ altre {planned.length - 5} pianificazioni</p>
            )}
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-700">I tuoi Fondi</h3>
          <Link to="/fondi" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
            Gestisci <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mainFunds.map(fund => {
            const Icon = iconMap[fund.icon] || Wallet
            const subs = subFunds.filter(s => s.parent_id === fund.id)
            const totalWithSubs = Number(fund.balance) + subs.reduce((s, sf) => s + Number(sf.balance), 0)
            return (
              <div key={fund.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: fund.color + '20' }}>
                    <Icon className="w-5 h-5" style={{ color: fund.color }} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">{fund.name}</p>
                    <p className="text-xs text-slate-400">{subs.length > 0 ? `Totale: ${cur(totalWithSubs)}` : ''}</p>
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-800">{cur(Number(fund.balance))}</p>
                {subs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    {subs.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <PiggyBank className="w-3.5 h-3.5" /> {sub.name}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-700">Previsione 3 Mesi</h3>
            <Link to="/previsione" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
              Vedi tutto <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {forecast.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={forecast}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `€${v}`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="balance" stroke="#4F46E5" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">Configura entrate e uscite per vedere la previsione</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-700">Prossime Scadenze</h3>
              <Calendar className="w-4 h-4 text-slate-400" />
            </div>
            {upcoming.length > 0 ? (
              <div className="space-y-3">
                {upcoming.map(exp => {
                  const diff = Math.ceil((exp.dueDate.getTime() - nowDate.getTime()) / 86400000)
                  return (
                    <div key={exp.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{exp.name}</p>
                        <p className="text-xs text-slate-400">
                          {diff === 0 ? 'Oggi' : diff === 1 ? 'Domani' : `Tra ${diff} giorni`} &middot; {format(exp.dueDate, 'd MMM', { locale: it })}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-red-500">-{cur(Number(exp.amount))}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400 py-4 text-center">Nessuna scadenza in arrivo</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-700">Ultime Transazioni</h3>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            {recentTx.length > 0 ? (
              <div className="space-y-3">
                {recentTx.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{tx.description}</p>
                      <p className="text-xs text-slate-400">
                        {format(new Date(tx.date), 'd MMM', { locale: it })} &middot; {tx.category}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {tx.type === 'income' ? '+' : '-'}{cur(Number(tx.amount))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 py-4 text-center">Nessuna transazione nel periodo</p>
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
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={confirmAmount || ''} onChange={e => setConfirmAmount(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            {confirmItem.kind !== 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {confirmItem.kind === 'income' ? 'Accredita su' : 'Paga con'}
                </label>
                <select value={confirmFundId} onChange={e => setConfirmFundId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                  <option value="">Nessun fondo</option>
                  {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleConfirm} disabled={confirmSaving || confirmAmount <= 0} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition text-sm">
                {confirmSaving ? 'Registrazione...' : 'Conferma e registra'}
              </button>
              <button onClick={handleMarkOnly} disabled={confirmSaving} className="py-2.5 px-4 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 transition text-sm">
                Solo pagato
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={plannedModal} onClose={() => setPlannedModal(false)} title="Pianifica spesa o entrata">
        <div className="space-y-4">
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
            Le pianificazioni appariranno nelle previsioni ma non intaccheranno il saldo dei fondi finché non le segnerai come fatte.
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPlannedForm({ ...plannedForm, type: 'expense' })} className={`py-2 rounded-lg text-sm font-medium border transition ${plannedForm.type === 'expense' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                Uscita
              </button>
              <button onClick={() => setPlannedForm({ ...plannedForm, type: 'income' })} className={`py-2 rounded-lg text-sm font-medium border transition ${plannedForm.type === 'income' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                Entrata
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={plannedForm.description} onChange={e => setPlannedForm({ ...plannedForm, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Vacanza estate, Rimborso..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={plannedForm.amount || ''} onChange={e => setPlannedForm({ ...plannedForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data prevista</label>
              <input type="date" value={plannedForm.date} onChange={e => setPlannedForm({ ...plannedForm, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo (opzionale)</label>
            <select value={plannedForm.fund_id} onChange={e => setPlannedForm({ ...plannedForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Scegli al completamento</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <select value={plannedForm.category} onChange={e => setPlannedForm({ ...plannedForm, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none capitalize">
              {TRANSACTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={savePlanned} disabled={plannedSaving || plannedForm.amount <= 0 || !plannedForm.description.trim()} className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition">
            {plannedSaving ? 'Salvataggio...' : 'Aggiungi pianificazione'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Card({ icon: Icon, color, label, value, valueColor }: { icon: React.ElementType; color: string; label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <p className={`text-xl font-bold ${valueColor || 'text-slate-800'}`}>{value}</p>
    </div>
  )
}
