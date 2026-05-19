import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, Target } from 'lucide-react'
import { format, parse } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import FundExcluder from '../components/FundExcluder'
import { generateForecast, getMonthlyEstimates } from '../lib/forecast'
import { useExcludedFunds } from '../lib/excludedFunds'
import { cur } from '../lib/utils'
import type { Fund, RecurringExpense, RecurringIncome, WeeklyBudget, VariableExpense, Transaction, ForecastPoint } from '../types'

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ForecastPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200 text-sm">
      <p className="font-medium text-slate-700 mb-1">{d.label}</p>
      <p className="text-indigo-600">Saldo: {cur(d.balance)}</p>
      <p className="text-emerald-600">Entrate sett.: {cur(d.income)}</p>
      <p className="text-red-500">Uscite sett.: {cur(d.expenses)}</p>
    </div>
  )
}

export default function Forecast() {
  const { user } = useAuth()
  const toast = useToast()
  const [funds, setFunds] = useState<Fund[]>([])
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [income, setIncome] = useState<RecurringIncome[]>([])
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [varExp, setVarExp] = useState<VariableExpense[]>([])
  const [planned, setPlanned] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState(6)
  const [excludedFundIds, , toggleExcluded] = useExcludedFunds()

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('funds').select('*').order('sort_order'),
      supabase.from('recurring_expenses').select('*'),
      supabase.from('recurring_income').select('*'),
      supabase.from('weekly_budgets').select('*'),
      supabase.from('variable_expenses').select('*'),
      supabase.from('transactions').select('*').eq('is_planned', true),
    ]).then(([f, e, i, b, v, p]) => {
      if (f.error || e.error || i.error || b.error || v.error || p.error) {
        toast.error('Errore nel caricamento dei dati')
      }
      setFunds(f.data || [])
      setExpenses(e.data || [])
      setIncome(i.data || [])
      setBudgets(b.data || [])
      setVarExp(v.data || [])
      setPlanned(p.data || [])
      setLoading(false)
    })
  }, [user])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const forecast = generateForecast(funds, expenses, income, budgets, varExp, months, excludedFundIds, planned)
  const est = getMonthlyEstimates(expenses, income, budgets, varExp, excludedFundIds)
  const hasExclusions = excludedFundIds.some(id => funds.some(f => f.id === id))
  const excludedNames = funds.filter(f => excludedFundIds.includes(f.id)).map(f => f.name)

  const minPoint = forecast.reduce((min, p) => p.balance < min.balance ? p : min, forecast[0])
  const endBalance = forecast[forecast.length - 1]?.balance || 0
  const startBalance = forecast[0]?.balance || 0
  const trend = endBalance - startBalance

  const monthlyAgg = new Map<string, { income: number; expenses: number; endBalance: number }>()
  for (const p of forecast) {
    const key = p.date.substring(0, 7)
    const existing = monthlyAgg.get(key) || { income: 0, expenses: 0, endBalance: 0 }
    existing.income += p.income
    existing.expenses += p.expenses
    existing.endBalance = p.balance
    monthlyAgg.set(key, existing)
  }
  const monthlyData = Array.from(monthlyAgg.entries()).map(([month, data]) => ({
    month,
    label: format(parse(month + '-01', 'yyyy-MM-dd', new Date()), 'MMMM yyyy', { locale: it }),
    ...data,
    net: data.income - data.expenses,
  }))

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          {hasExclusions && (
            <p className="text-xs text-slate-500 mt-1">Esclusi: {excludedNames.join(', ')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FundExcluder
            funds={funds}
            excludedIds={excludedFundIds}
            onToggle={toggleExcluded}
            onClear={() => excludedFundIds.forEach(id => toggleExcluded(id))}
          />
          <select value={months} onChange={e => setMonths(parseInt(e.target.value))} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value={3}>3 mesi</option>
            <option value={6}>6 mesi</option>
            <option value={9}>9 mesi</option>
            <option value={12}>12 mesi</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard icon={Target} color="bg-indigo-100 text-indigo-600" label="Saldo Attuale" value={cur(startBalance)} />
        <MetricCard icon={trend >= 0 ? TrendingUp : TrendingDown} color={trend >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'} label={`Saldo a ${months} mesi`} value={cur(endBalance)} />
        <MetricCard icon={AlertTriangle} color={minPoint.balance < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'} label="Minimo Previsto" value={cur(minPoint.balance)} sub={minPoint.label} />
        <MetricCard icon={TrendingUp} color="bg-emerald-100 text-emerald-600" label="Netto Mensile" value={cur(est.monthlyNet)} sub={est.monthlyNet >= 0 ? 'Positivo' : 'Negativo'} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Proiezione Saldo</h3>
        {forecast.length > 1 ? (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={forecast}>
              <defs>
                <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={Math.floor(forecast.length / 8)} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `€${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="balance" stroke="#4F46E5" fill="url(#forecastGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center text-slate-400 py-12">Configura fondi, entrate e uscite per vedere la previsione</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-700">Riepilogo Mensile</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Mese</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Entrate</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Uscite</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Netto</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Saldo Fine Mese</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(row => (
                <tr key={row.month} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700 capitalize">{row.label}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{cur(row.income)}</td>
                  <td className="px-4 py-3 text-right text-red-500">{cur(row.expenses)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${row.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{cur(row.net)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.endBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{cur(row.endBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {minPoint.balance < 0 && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-700">Attenzione: saldo negativo previsto</p>
            <p className="text-sm text-red-600 mt-1">Il saldo potrebbe scendere a {cur(minPoint.balance)} intorno al {minPoint.label}. Considera di ridurre le spese o aumentare le entrate.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon: Icon, color, label, value, sub }: { icon: React.ElementType; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
