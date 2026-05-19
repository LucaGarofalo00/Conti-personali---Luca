import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Wallet, TrendingUp, TrendingDown, Target, ArrowRight, Calendar, CreditCard, Smartphone, Globe, Banknote, BookOpen, PiggyBank } from 'lucide-react'
import { getDate } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { generateForecast, getMonthlyEstimates } from '../lib/forecast'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense } from '../types'

const iconMap: Record<string, React.ElementType> = {
  'credit-card': CreditCard, 'smartphone': Smartphone, 'globe': Globe,
  'banknote': Banknote, 'book-open': BookOpen, 'piggy-bank': PiggyBank, 'wallet': Wallet,
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

const cur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

export default function Dashboard() {
  const { user } = useAuth()
  const [funds, setFunds] = useState<Fund[]>([])
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [income, setIncome] = useState<RecurringIncome[]>([])
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [varExp, setVarExp] = useState<VariableExpense[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('funds').select('*').order('sort_order'),
      supabase.from('recurring_expenses').select('*'),
      supabase.from('recurring_income').select('*'),
      supabase.from('weekly_budgets').select('*'),
      supabase.from('variable_expenses').select('*'),
    ]).then(([f, e, i, b, v]) => {
      setFunds(f.data || [])
      setExpenses(e.data || [])
      setIncome(i.data || [])
      setBudgets(b.data || [])
      setVarExp(v.data || [])
      setLoading(false)
    })
  }, [user])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const totalBalance = funds.reduce((s, f) => s + Number(f.balance), 0)
  const est = getMonthlyEstimates(expenses, income, budgets, varExp)
  const forecast = generateForecast(funds, expenses, income, budgets, varExp, 3)
  const mainFunds = funds.filter(f => f.type === 'main')
  const subFunds = funds.filter(f => f.type === 'sub')
  const todayDay = getDate(new Date())
  const upcoming = [...expenses].filter(e => e.is_active).sort((a, b) => {
    const ad = a.day_of_month >= todayDay ? a.day_of_month - todayDay : a.day_of_month + 30 - todayDay
    const bd = b.day_of_month >= todayDay ? b.day_of_month - todayDay : b.day_of_month + 30 - todayDay
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
                const daysUntil = exp.day_of_month >= todayDay ? exp.day_of_month - todayDay : exp.day_of_month + 30 - todayDay
                return (
                  <div key={exp.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{exp.name}</p>
                      <p className="text-xs text-slate-400">
                        {daysUntil === 0 ? 'Oggi' : daysUntil === 1 ? 'Domani' : `Tra ${daysUntil} giorni`} &middot; Giorno {exp.day_of_month}
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
