import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ShoppingBag, Fuel, Receipt } from 'lucide-react'
import { startOfWeek, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, VARIABLE_CATEGORIES, todayString, toDateString } from '../lib/utils'
import type { WeeklyBudget, VariableExpense, Fund, Transaction } from '../types'

export default function Budgets() {
  const { user } = useAuth()
  const toast = useToast()
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [varExp, setVarExp] = useState<VariableExpense[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [weekTx, setWeekTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [editingBudget, setEditingBudget] = useState<WeeklyBudget | null>(null)
  const [budgetForm, setBudgetForm] = useState({ name: '', amount: 0, fund_id: '' })

  const [showVarModal, setShowVarModal] = useState(false)
  const [editingVar, setEditingVar] = useState<VariableExpense | null>(null)
  const [varForm, setVarForm] = useState({ name: '', estimated_amount: 0, frequency: 'weekly' as 'weekly' | 'monthly', fund_id: '', category: 'trasporti', needs_confirmation: false })

  const [expBudgetId, setExpBudgetId] = useState<string | null>(null)
  const [expForm, setExpForm] = useState({ description: '', amount: 0, fund_id: '' })

  const weekStart = toDateString(startOfWeek(new Date(), { weekStartsOn: 1 }))

  const load = async () => {
    const [{ data: b, error: e1 }, { data: v, error: e2 }, { data: f, error: e3 }, { data: tx, error: e4 }] = await Promise.all([
      supabase.from('weekly_budgets').select('*').order('created_at'),
      supabase.from('variable_expenses').select('*').order('created_at'),
      supabase.from('funds').select('*').order('sort_order'),
      supabase.from('transactions').select('*').gte('date', weekStart).not('budget_id', 'is', null),
    ])
    if (e1 || e2 || e3 || e4) toast.error('Errore nel caricamento')
    setBudgets(b || [])
    setVarExp(v || [])
    setFunds(f || [])
    setWeekTx(tx || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const saveBudget = async () => {
    if (!budgetForm.name.trim()) { toast.error('Inserisci un nome'); return }
    if (budgetForm.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    const data = { name: budgetForm.name, amount: budgetForm.amount, fund_id: budgetForm.fund_id || null }
    const { error } = editingBudget
      ? await supabase.from('weekly_budgets').update(data).eq('id', editingBudget.id)
      : await supabase.from('weekly_budgets').insert({ user_id: user!.id, ...data })
    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editingBudget ? 'Budget aggiornato' : 'Budget aggiunto')
    setShowBudgetModal(false)
    load()
  }

  const saveExpense = async () => {
    if (!expBudgetId) return
    if (!expForm.description.trim()) { toast.error('Inserisci una descrizione'); return }
    if (expForm.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    const fundId = expForm.fund_id || null

    const { error } = await supabase.from('transactions').insert({
      user_id: user!.id,
      type: 'expense',
      amount: expForm.amount,
      description: expForm.description,
      fund_id: fundId,
      fund_to_id: null,
      category: 'budget',
      budget_id: expBudgetId,
      date: todayString(),
    })

    if (!error && fundId) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
      if (fund) {
        await supabase.from('funds').update({ balance: Number(fund.balance) - expForm.amount }).eq('id', fundId)
      }
    }

    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success('Spesa registrata')
    setExpBudgetId(null)
    load()
  }

  const saveVar = async () => {
    if (!varForm.name.trim()) { toast.error('Inserisci un nome'); return }
    if (varForm.estimated_amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    const data = { ...varForm, fund_id: varForm.fund_id || null }
    const { error } = editingVar
      ? await supabase.from('variable_expenses').update(data).eq('id', editingVar.id)
      : await supabase.from('variable_expenses').insert({ user_id: user!.id, ...data })
    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editingVar ? 'Spesa aggiornata' : 'Spesa aggiunta')
    setShowVarModal(false)
    load()
  }

  const removeBudget = async (id: string) => {
    if (!confirm('Eliminare?')) return
    const { error } = await supabase.from('weekly_budgets').delete().eq('id', id)
    if (error) { toast.error('Errore'); return }
    toast.success('Eliminato')
    load()
  }

  const removeVar = async (id: string) => {
    if (!confirm('Eliminare?')) return
    const { error } = await supabase.from('variable_expenses').delete().eq('id', id)
    if (error) { toast.error('Errore'); return }
    toast.success('Eliminato')
    load()
  }

  const toggleBudget = async (b: WeeklyBudget) => {
    const { error } = await supabase.from('weekly_budgets').update({ is_active: !b.is_active }).eq('id', b.id)
    if (error) toast.error('Errore')
    load()
  }

  const toggleVar = async (v: VariableExpense) => {
    const { error } = await supabase.from('variable_expenses').update({ is_active: !v.is_active }).eq('id', v.id)
    if (error) toast.error('Errore')
    load()
  }

  const openAddExpense = (budget: WeeklyBudget) => {
    setExpBudgetId(budget.id)
    setExpForm({ description: '', amount: 0, fund_id: budget.fund_id || '' })
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const totalWeeklyBudgets = budgets.filter(b => b.is_active).reduce((s, b) => s + Number(b.amount), 0)
  const totalWeeklyVar = varExp.filter(v => v.is_active && v.frequency === 'weekly').reduce((s, v) => s + Number(v.estimated_amount), 0)
  const totalMonthlyVar = varExp.filter(v => v.is_active && v.frequency === 'monthly').reduce((s, v) => s + Number(v.estimated_amount), 0)
  const totalMonthlyAll = (totalWeeklyBudgets + totalWeeklyVar) * 4.33 + totalMonthlyVar

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Budget e Spese Variabili</h2>
        <p className="text-sm text-slate-500 mt-1">Stima mensile totale: <span className="font-semibold text-red-500">{cur(totalMonthlyAll)}</span></p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-slate-700">Budget Settimanali</h3>
          </div>
          <button onClick={() => { setEditingBudget(null); setBudgetForm({ name: '', amount: 0, fund_id: '' }); setShowBudgetModal(true) }} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
            <Plus className="w-4 h-4" /> Nuovo Budget
          </button>
        </div>

        {budgets.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-400 text-sm">Nessun budget settimanale configurato</p>
          </div>
        ) : (
          <div className="space-y-4">
            {budgets.map(b => {
              const budgetTx = weekTx.filter(t => t.budget_id === b.id)
              const spent = budgetTx.reduce((s, t) => s + Number(t.amount), 0)
              const limit = Number(b.amount)
              const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0
              const remaining = limit - spent
              const overBudget = remaining < 0
              const fundName = funds.find(f => f.id === b.fund_id)?.name

              return (
                <div key={b.id} className={`bg-white rounded-xl border border-slate-200 p-5 ${!b.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleBudget(b)}>{b.is_active ? <ToggleRight className="w-6 h-6 text-indigo-600" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}</button>
                      <div>
                        <p className="font-semibold text-slate-800">{b.name}</p>
                        <p className="text-xs text-slate-400">
                          {cur(limit)}/settimana{fundName ? ` · ${fundName}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditingBudget(b); setBudgetForm({ name: b.name, amount: limit, fund_id: b.fund_id || '' }); setShowBudgetModal(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => removeBudget(b.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-slate-500">Speso: <span className="font-medium text-slate-700">{cur(spent)}</span> / {cur(limit)}</span>
                      <span className={`font-medium ${overBudget ? 'text-red-500' : 'text-emerald-600'}`}>
                        {overBudget ? `Sforato: ${cur(Math.abs(remaining))}` : `Rimangono: ${cur(remaining)}`}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {budgetTx.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      {budgetTx.map(tx => (
                        <div key={tx.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Receipt className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-slate-600">{tx.description}</span>
                            <span className="text-xs text-slate-400">{format(new Date(tx.date), 'dd MMM', { locale: it })}</span>
                          </div>
                          <span className="font-medium text-red-500">-{cur(Number(tx.amount))}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {b.is_active && (
                    <button
                      onClick={() => openAddExpense(b)}
                      className="mt-3 w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-sm font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Aggiungi spesa
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Fuel className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-semibold text-slate-700">Spese Variabili</h3>
          </div>
          <button onClick={() => { setEditingVar(null); setVarForm({ name: '', estimated_amount: 0, frequency: 'weekly', fund_id: '', category: 'trasporti', needs_confirmation: false }); setShowVarModal(true) }} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
            <Plus className="w-4 h-4" /> Aggiungi
          </button>
        </div>

        {varExp.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-400 text-sm">Nessuna spesa variabile configurata</p>
          </div>
        ) : (
          <div className="space-y-3">
            {varExp.map(v => (
              <div key={v.id} className={`bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between ${!v.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <button onClick={() => toggleVar(v)}>{v.is_active ? <ToggleRight className="w-6 h-6 text-amber-600" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}</button>
                  <div>
                    <p className="font-medium text-slate-800">{v.name}</p>
                    <p className="text-xs text-slate-400 capitalize">{v.category} · {v.frequency === 'weekly' ? `${cur(Number(v.estimated_amount) * 4.33)}/mese` : 'mensile'}{v.needs_confirmation ? ' · Da confermare' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold text-amber-600">~{cur(Number(v.estimated_amount))}<span className="text-xs font-normal text-slate-400">/{v.frequency === 'weekly' ? 'sett' : 'mese'}</span></span>
                  <button onClick={() => { setEditingVar(v); setVarForm({ name: v.name, estimated_amount: Number(v.estimated_amount), frequency: v.frequency, fund_id: v.fund_id || '', category: v.category, needs_confirmation: v.needs_confirmation }); setShowVarModal(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => removeVar(v.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={showBudgetModal} onClose={() => setShowBudgetModal(false)} title={editingBudget ? 'Modifica Budget' : 'Nuovo Budget Settimanale'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" value={budgetForm.name} onChange={e => setBudgetForm({ ...budgetForm, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Sfizi, Mangiare fuori..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Budget settimanale (€)</label>
            <input type="number" step="0.01" value={budgetForm.amount || ''} onChange={e => setBudgetForm({ ...budgetForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo predefinito (opzionale)</label>
            <select value={budgetForm.fund_id} onChange={e => setBudgetForm({ ...budgetForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Scegli al momento della spesa</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={saveBudget} disabled={saving} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : editingBudget ? 'Salva' : 'Aggiungi'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!expBudgetId} onClose={() => setExpBudgetId(null)} title="Aggiungi Spesa al Budget">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={expForm.description} onChange={e => setExpForm({ ...expForm, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Pizza, Gelato..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
            <input type="number" step="0.01" value={expForm.amount || ''} onChange={e => setExpForm({ ...expForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Paga con</label>
            <select value={expForm.fund_id} onChange={e => setExpForm({ ...expForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <button onClick={saveExpense} disabled={saving || expForm.amount <= 0} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Registrazione...' : 'Registra Spesa'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={showVarModal} onClose={() => setShowVarModal(false)} title={editingVar ? 'Modifica Spesa Variabile' : 'Nuova Spesa Variabile'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" value={varForm.name} onChange={e => setVarForm({ ...varForm, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. GPL, Benzina..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo stimato (€)</label>
              <input type="number" step="0.01" value={varForm.estimated_amount || ''} onChange={e => setVarForm({ ...varForm, estimated_amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Frequenza</label>
              <select value={varForm.frequency} onChange={e => setVarForm({ ...varForm, frequency: e.target.value as 'weekly' | 'monthly' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                <option value="weekly">Settimanale</option>
                <option value="monthly">Mensile</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <select value={varForm.category} onChange={e => setVarForm({ ...varForm, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none capitalize">
              {VARIABLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo (opzionale)</label>
            <select value={varForm.fund_id} onChange={e => setVarForm({ ...varForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Nessuno</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer">
            <input type="checkbox" checked={varForm.needs_confirmation} onChange={e => setVarForm({ ...varForm, needs_confirmation: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <div>
              <p className="text-sm font-medium text-slate-700">Da confermare in Dashboard</p>
              <p className="text-xs text-slate-400">Mostra questa spesa nella sezione "Da Confermare"</p>
            </div>
          </label>
          <button onClick={saveVar} disabled={saving} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : editingVar ? 'Salva' : 'Aggiungi'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
