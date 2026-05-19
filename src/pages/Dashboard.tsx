import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Wallet, TrendingUp, TrendingDown, Target, ArrowRight, Calendar, PiggyBank, CheckCircle2, Check } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { generateForecast, getMonthlyEstimates } from '../lib/forecast'
import { cur, iconMap, getBillingPeriodStart, formatDayMonth } from '../lib/utils'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense, Transaction } from '../types'

interface PendingItem {
  id: string
  kind: 'income' | 'expense'
  name: string
  amount: number
  fund_id: string | null
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
  const [loading, setLoading] = useState(true)

  const [confirmItem, setConfirmItem] = useState<PendingItem | null>(null)
  const [confirmAmount, setConfirmAmount] = useState(0)
  const [confirmFundId, setConfirmFundId] = useState('')
  const [confirmSaving, setConfirmSaving] = useState(false)

  const load = async () => {
    const periodStart = getBillingPeriodStart()

    const [f, e, i, b, v, tx] = await Promise.all([
      supabase.from('funds').select('*').order('sort_order'),
      supabase.from('recurring_expenses').select('*'),
      supabase.from('recurring_income').select('*'),
      supabase.from('weekly_budgets').select('*'),
      supabase.from('variable_expenses').select('*'),
      supabase.from('transactions').select('*').gte('date', periodStart),
    ])
    if (f.error || e.error || i.error || b.error || v.error) {
      toast.error('Errore nel caricamento dei dati')
    }
    setFunds(f.data || [])
    setExpenses(e.data || [])
    setIncome(i.data || [])
    setBudgets(b.data || [])
    setVarExp(v.data || [])
    setPeriodTx(tx.data || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const today = new Date().toISOString().split('T')[0]

  const isExpenseConfirmed = (name: string) =>
    periodTx.some(tx => tx.type === 'expense' && tx.description === name)

  const pendingRecurring: PendingItem[] = expenses
    .filter(exp => exp.is_active && (!exp.end_date || exp.end_date >= today))
    .sort((a, b) => a.day_of_month - b.day_of_month)
    .map(exp => ({
      id: 'rec-' + exp.id,
      kind: 'expense',
      name: exp.name,
      amount: Number(exp.amount),
      fund_id: exp.fund_id,
      category: exp.category,
      label: `${formatDayMonth(exp.day_of_month)} · ${exp.category}`,
      confirmed: isExpenseConfirmed(exp.name),
    }))

  const pendingIncome: PendingItem[] = income
    .filter(i => i.is_active && i.frequency === 'weekly')
    .map(i => ({
      id: 'inc-' + i.id,
      kind: 'income',
      name: i.name,
      amount: Number(i.amount),
      fund_id: i.fund_id,
      category: 'lavoro',
      label: 'Entrata settimanale',
      confirmed: false,
    }))

  const pendingVarExp: PendingItem[] = varExp
    .filter(v => v.is_active && v.needs_confirmation)
    .map(v => ({
      id: 'var-' + v.id,
      kind: 'expense',
      name: v.name,
      amount: Number(v.estimated_amount),
      fund_id: v.fund_id,
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
    await supabase.from('transactions').insert({
      user_id: user!.id,
      type: confirmItem.kind === 'income' ? 'income' : 'expense',
      amount: confirmAmount,
      description: confirmItem.name,
      fund_id: fundId,
      fund_to_id: null,
      category: confirmItem.category,
      date: new Date().toISOString().split('T')[0],
    })

    if (fundId) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
      if (fund) {
        const delta = confirmItem.kind === 'income' ? confirmAmount : -confirmAmount
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fundId)
      }
    }

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success(confirmItem.kind === 'income' ? 'Entrata registrata' : 'Spesa registrata')
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
      date: new Date().toISOString().split('T')[0],
    })

    setConfirmSaving(false)
    setConfirmItem(null)
    toast.success('Segnato come pagato')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const totalBalance = funds.reduce((s, f) => s + Number(f.balance), 0)
  const est = getMonthlyEstimates(expenses, income, budgets, varExp)
  const forecast = generateForecast(funds, expenses, income, budgets, varExp, 3)
  const mainFunds = funds.filter(f => f.type === 'main')
  const subFunds = funds.filter(f => f.type === 'sub')
  const upcoming = [...expenses].filter(e => e.is_active && (!e.end_date || e.end_date >= today)).sort((a, b) => {
    const now = new Date()
    const todayD = now.getDate()
    const ad = a.day_of_month >= todayD ? a.day_of_month - todayD : a.day_of_month + 30 - todayD
    const bd = b.day_of_month >= todayD ? b.day_of_month - todayD : b.day_of_month + 30 - todayD
    return ad - bd
  }).slice(0, 5)

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
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card icon={Wallet} color="bg-indigo-100 text-indigo-600" label="Saldo Totale" value={cur(totalBalance)} />
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
                {pendingRecurring.map(item => (
                  <div key={item.id} className={`bg-white rounded-xl border-l-4 border border-slate-200 p-4 flex items-center justify-between ${item.confirmed ? 'border-l-emerald-400 opacity-60' : 'border-l-red-400'}`}>
                    <div>
                      <p className={`font-medium text-slate-800 ${item.confirmed ? 'line-through' : ''}`}>{item.name}</p>
                      <p className="text-xs text-slate-400">{item.label} · {cur(item.amount)}</p>
                    </div>
                    {item.confirmed ? (
                      <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                        <Check className="w-4 h-4" /> Pagato
                      </span>
                    ) : (
                      <button
                        onClick={() => openConfirm(item)}
                        className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition"
                      >
                        Paga
                      </button>
                    )}
                  </div>
                ))}
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

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-700">Prossime Scadenze</h3>
            <Calendar className="w-4 h-4 text-slate-400" />
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-3">
              {upcoming.map(exp => {
                const now = new Date()
                const todayD = now.getDate()
                const daysUntil = exp.day_of_month >= todayD ? exp.day_of_month - todayD : exp.day_of_month + 30 - todayD
                const nextDate = exp.day_of_month >= todayD
                  ? new Date(now.getFullYear(), now.getMonth(), exp.day_of_month)
                  : new Date(now.getFullYear(), now.getMonth() + 1, exp.day_of_month)
                return (
                  <div key={exp.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{exp.name}</p>
                      <p className="text-xs text-slate-400">
                        {daysUntil === 0 ? 'Oggi' : daysUntil === 1 ? 'Domani' : `Tra ${daysUntil} giorni`} &middot; {format(nextDate, 'd MMM', { locale: it })}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-red-500">-{cur(Number(exp.amount))}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-4 text-center">Nessuna spesa ricorrente configurata</p>
          )}
        </div>
      </div>

      <Modal isOpen={!!confirmItem} onClose={() => setConfirmItem(null)} title={confirmItem?.kind === 'income' ? 'Conferma Entrata' : 'Conferma Pagamento'}>
        {confirmItem && (
          <div className="space-y-4">
            <div className={`p-3 rounded-lg ${confirmItem.kind === 'income' ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <p className={`font-medium ${confirmItem.kind === 'income' ? 'text-emerald-700' : 'text-red-700'}`}>{confirmItem.name}</p>
              <p className={`text-xs ${confirmItem.kind === 'income' ? 'text-emerald-500' : 'text-red-500'}`}>{confirmItem.label}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={confirmAmount || ''} onChange={e => setConfirmAmount(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {confirmItem.kind === 'income' ? 'Accredita su' : 'Paga con'}
              </label>
              <select value={confirmFundId} onChange={e => setConfirmFundId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                <option value="">Nessun fondo</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
              </select>
            </div>
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
