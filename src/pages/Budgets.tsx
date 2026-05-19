import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ShoppingBag, Receipt, AlertTriangle } from 'lucide-react'
import { startOfWeek, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, todayString, toDateString } from '../lib/utils'
import InfoBox from '../components/InfoBox'
import type { WeeklyBudget, Fund, Transaction } from '../types'

export default function Budgets() {
  const { user } = useAuth()
  const toast = useToast()
  const [budgets, setBudgets] = useState<WeeklyBudget[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [budgetTx, setBudgetTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [editingBudget, setEditingBudget] = useState<WeeklyBudget | null>(null)
  const [budgetForm, setBudgetForm] = useState({ name: '', amount: 0, fund_id: '' })

  const [expBudgetId, setExpBudgetId] = useState<{ id: string; name: string } | null>(null)
  const [expForm, setExpForm] = useState({ description: '', amount: 0, fund_id: '', date: todayString() })

  const weekStart = toDateString(startOfWeek(new Date(), { weekStartsOn: 1 }))

  const load = async () => {
    try {
      const [{ data: b, error: e1 }, { data: f, error: e2 }, { data: btx, error: e3 }] = await Promise.all([
        supabase.from('weekly_budgets').select('*').order('created_at'),
        supabase.from('funds').select('*').order('sort_order'),
        supabase.from('transactions').select('*').gte('date', weekStart).not('budget_id', 'is', null),
      ])
      const firstError = e1 || e2 || e3
      if (firstError) {
        console.error('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      setBudgets(b || [])
      setFunds(f || [])
      setBudgetTx(btx || [])
    } catch (err) {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    } finally {
      setLoading(false)
    }
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
      budget_id: expBudgetId.id,
      date: expForm.date || todayString(),
    })

    if (!error && fundId) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
      if (fund) {
        await supabase.from('funds').update({ balance: Number(fund.balance) - expForm.amount }).eq('id', fundId)
      }
    }

    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio: ' + error.message); return }
    toast.success('Spesa registrata')
    setExpBudgetId(null)
    load()
  }

  const removeBudget = async (id: string) => {
    if (!confirm('Eliminare? Le transazioni collegate restano ma perdono il link al budget.')) return
    const { error } = await supabase.from('weekly_budgets').delete().eq('id', id)
    if (error) { toast.error('Errore'); return }
    toast.success('Eliminato')
    load()
  }

  const toggleBudget = async (b: WeeklyBudget) => {
    const { error } = await supabase.from('weekly_budgets').update({ is_active: !b.is_active }).eq('id', b.id)
    if (error) toast.error('Errore')
    load()
  }

  const removeTx = async (tx: Transaction) => {
    if (!confirm('Eliminare questa spesa? Il saldo del fondo verrà ripristinato.')) return
    const { error } = await supabase.from('transactions').delete().eq('id', tx.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    if (tx.fund_id) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', tx.fund_id).single()
      if (fund) await supabase.from('funds').update({ balance: Number(fund.balance) + Number(tx.amount) }).eq('id', tx.fund_id)
    }
    toast.success('Spesa eliminata')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const totalWeeklyBudgets = budgets.filter(b => b.is_active).reduce((s, b) => s + Number(b.amount), 0)
  const totalMonthlyAll = totalWeeklyBudgets * 4.33

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-slate-500">Stima mensile budget: <span className="font-semibold text-red-500">{cur(totalMonthlyAll)}</span></p>
      </div>
      <InfoBox title="Come funzionano i budget settimanali" tone="indigo">
        <p>Un <strong>budget settimanale</strong> è un limite di spesa per la settimana corrente (es. sfizi 50€, mangiare fuori 80€).</p>
        <p><strong>Reset</strong>: ogni <strong>lunedì 00:00</strong> il contatore riparte da zero (basato su <code>startOfWeek</code> in tempo reale).</p>
        <p><strong>Overbudget</strong>: la barra diventa <strong>rossa</strong> e compare un alert, ma le spese vengono comunque registrate e il fondo viene scalato normalmente.</p>
        <p><strong>Nelle previsioni</strong>: ogni budget attivo conta <code>importo × 4.33</code>/mese (settimane medie in un mese).</p>
        <p>Per spese fisse mensili (affitto, abbonamenti, ecc.) usa la sezione <strong>Spese Ricorrenti</strong>.</p>
      </InfoBox>

      <div>
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
              const txs = budgetTx.filter(t => t.budget_id === b.id)
              const spent = txs.reduce((s, t) => s + Number(t.amount), 0)
              const limit = Number(b.amount)
              const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0
              const remaining = limit - spent
              const overBudget = remaining < 0
              const fundName = funds.find(f => f.id === b.fund_id)?.name

              return (
                <div key={b.id} className={`bg-white rounded-xl border ${overBudget ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'} p-5 ${!b.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleBudget(b)}>{b.is_active ? <ToggleRight className="w-6 h-6 text-indigo-600" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}</button>
                      <div>
                        <p className="font-semibold text-slate-800">{b.name}</p>
                        <p className="text-xs text-slate-400">{cur(limit)}/settimana{fundName ? ` · ${fundName}` : ''}</p>
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
                      <span className={`font-medium ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                        {overBudget ? `Sforato di ${cur(Math.abs(remaining))}` : `Rimangono ${cur(remaining)}`}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    {overBudget && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Hai superato il budget. Le spese vengono registrate comunque.</span>
                      </div>
                    )}
                  </div>

                  {txs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      {txs.map(tx => (
                        <div key={tx.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Receipt className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-slate-600 truncate">{tx.description}</span>
                            <span className="text-xs text-slate-400 shrink-0">{format(new Date(tx.date), 'dd MMM', { locale: it })}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-medium text-red-500">-{cur(Number(tx.amount))}</span>
                            <button onClick={() => removeTx(tx)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {b.is_active && (
                    <button
                      onClick={() => { setExpBudgetId({ id: b.id, name: b.name }); setExpForm({ description: '', amount: 0, fund_id: b.fund_id || '', date: todayString() }) }}
                      className="mt-3 w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-sm font-medium text-slate-500 transition flex items-center justify-center gap-2 hover:border-indigo-300 hover:text-indigo-600"
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

      <Modal isOpen={!!expBudgetId} onClose={() => setExpBudgetId(null)} title={expBudgetId ? `Spesa per "${expBudgetId.name}"` : ''}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={expForm.description} onChange={e => setExpForm({ ...expForm, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Pizza, Gelato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={expForm.amount || ''} onChange={e => setExpForm({ ...expForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Paga con</label>
            <select value={expForm.fund_id} onChange={e => setExpForm({ ...expForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <button onClick={saveExpense} disabled={saving || expForm.amount <= 0 || !expForm.description.trim()} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Registrazione...' : 'Registra Spesa'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
