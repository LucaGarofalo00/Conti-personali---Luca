import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ArrowRightLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, EXPENSE_CATEGORIES, formatDayMonth } from '../lib/utils'
import type { RecurringExpense, Fund } from '../types'

const emptyForm = { name: '', amount: 0, day_of_month: 1, fund_id: '' as string, fund_to_id: '' as string, category: 'altro', type: 'expense' as 'expense' | 'transfer', end_date: '' }

export default function RecurringExpenses() {
  const { user } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<RecurringExpense[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<RecurringExpense | null>(null)
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    const [{ data: exp, error: e1 }, { data: fnd, error: e2 }] = await Promise.all([
      supabase.from('recurring_expenses').select('*').order('day_of_month'),
      supabase.from('funds').select('*').order('sort_order'),
    ])
    if (e1 || e2) toast.error('Errore nel caricamento')
    setItems(exp || [])
    setFunds(fnd || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (item: RecurringExpense) => {
    setEditing(item)
    setForm({
      name: item.name,
      amount: Number(item.amount),
      day_of_month: item.day_of_month,
      fund_id: item.fund_id || '',
      fund_to_id: item.fund_to_id || '',
      category: item.category,
      type: item.type || 'expense',
      end_date: item.end_date || '',
    })
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Inserisci un nome'); return }
    if (form.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    if (form.type === 'transfer' && (!form.fund_id || !form.fund_to_id)) {
      toast.error('Seleziona fondo di origine e destinazione'); return
    }
    if (form.type === 'transfer' && form.fund_id === form.fund_to_id) {
      toast.error('I fondi di origine e destinazione devono essere diversi'); return
    }
    setSaving(true)
    const data = {
      name: form.name,
      amount: form.amount,
      day_of_month: form.day_of_month,
      fund_id: form.fund_id || null,
      fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.type === 'transfer' ? 'trasferimento' : form.category,
      type: form.type,
      end_date: form.end_date || null,
    }
    const { error } = editing
      ? await supabase.from('recurring_expenses').update(data).eq('id', editing.id)
      : await supabase.from('recurring_expenses').insert({ user_id: user!.id, ...data })
    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editing ? 'Voce aggiornata' : 'Voce aggiunta')
    setShowModal(false)
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminare questa voce?')) return
    const { error } = await supabase.from('recurring_expenses').delete().eq('id', id)
    if (error) { toast.error('Errore nell\'eliminazione'); return }
    toast.success('Eliminata')
    load()
  }

  const toggle = async (item: RecurringExpense) => {
    const { error } = await supabase.from('recurring_expenses').update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) toast.error('Errore nell\'aggiornamento')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const today = new Date().toISOString().split('T')[0]
  const activeItems = items.filter(i => i.is_active && (!i.end_date || i.end_date >= today))
  const expiredItems = items.filter(i => i.end_date && i.end_date < today)
  const totalExpenses = activeItems.filter(i => (i.type || 'expense') === 'expense').reduce((s, i) => s + Number(i.amount), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Spese Ricorrenti</h2>
          <p className="text-sm text-slate-500 mt-1">Totale spese mensili: <span className="font-semibold text-red-500">{cur(totalExpenses)}</span></p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
          <Plus className="w-4 h-4" /> Aggiungi
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-400 mb-4">Nessuna spesa ricorrente configurata</p>
          <button onClick={openAdd} className="text-indigo-600 font-medium hover:text-indigo-700">Aggiungi la prima voce</button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.filter(i => !i.end_date || i.end_date >= today).map(item => {
            const isTransfer = (item.type || 'expense') === 'transfer'
            const fromFund = funds.find(f => f.id === item.fund_id)?.name
            const toFund = funds.find(f => f.id === item.fund_to_id)?.name
            return (
              <div key={item.id} className={`bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between transition ${!item.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <button onClick={() => toggle(item)} className="text-slate-400 hover:text-indigo-600 transition">
                    {item.is_active ? <ToggleRight className="w-6 h-6 text-indigo-600" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-800">{item.name}</p>
                      {isTransfer && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">Trasferimento</span>}
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatDayMonth(item.day_of_month)} &middot; {isTransfer
                        ? `${fromFund || '?'} → ${toFund || '?'}`
                        : item.category}
                      {!isTransfer && fromFund && ` · ${fromFund}`}
                      {item.end_date && ` · Ultimo accredito: ${new Date(item.end_date).toLocaleDateString('it-IT')}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-semibold ${isTransfer ? 'text-blue-500' : 'text-red-500'}`}>{cur(Number(item.amount))}</span>
                  <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )
          })}

          {expiredItems.length > 0 && (
            <>
              <p className="text-sm font-medium text-slate-400 mt-6 mb-2">Terminate</p>
              {expiredItems.map(item => (
                <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between opacity-40">
                  <div className="flex items-center gap-4">
                    <div className="w-6" />
                    <div>
                      <p className="font-medium text-slate-800 line-through">{item.name}</p>
                      <p className="text-xs text-slate-400">Ultimo accredito: {new Date(item.end_date!).toLocaleDateString('it-IT')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-slate-400">{cur(Number(item.amount))}</span>
                    <button onClick={() => remove(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Modifica Voce' : 'Nuova Voce Ricorrente'}>
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setForm({ ...form, type: 'expense', fund_to_id: '' })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${form.type === 'expense' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              Spesa
            </button>
            <button
              onClick={() => setForm({ ...form, type: 'transfer', category: 'trasferimento' })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 ${form.type === 'transfer' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Trasferimento
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder={form.type === 'transfer' ? 'es. Risparmio mensile...' : 'es. Affitto, Netflix...'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno del mese</label>
              <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          </div>

          {form.type === 'expense' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none capitalize">
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fondo predefinito (opzionale)</label>
                <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                  <option value="">Scegli al momento del pagamento</option>
                  {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </>
          )}

          {form.type === 'transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Da</label>
                <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                  <option value="">Seleziona...</option>
                  {funds.filter(f => f.id !== form.fund_to_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">A</label>
                <select value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                  <option value="">Seleziona...</option>
                  {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data ultimo accredito (opzionale)</label>
            <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            {form.end_date && (
              <button onClick={() => setForm({ ...form, end_date: '' })} className="text-xs text-indigo-600 mt-1 hover:text-indigo-700">Rimuovi data</button>
            )}
          </div>
          <button onClick={save} disabled={saving} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Aggiungi'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
