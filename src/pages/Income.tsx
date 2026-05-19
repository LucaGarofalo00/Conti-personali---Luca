import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Clock, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/Modal'
import type { RecurringIncome, Fund } from '../types'

const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
const cur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

const emptyForm = {
  name: '', amount: 0, is_variable: false, frequency: 'monthly' as 'monthly' | 'weekly',
  day_of_month: 15, day_of_week: 6, delay_days: 0, fund_id: '' as string,
}

export default function Income() {
  const { user } = useAuth()
  const [items, setItems] = useState<RecurringIncome[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<RecurringIncome | null>(null)
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    const [{ data: inc }, { data: fnd }] = await Promise.all([
      supabase.from('recurring_income').select('*').order('created_at'),
      supabase.from('funds').select('*').order('sort_order'),
    ])
    setItems(inc || [])
    setFunds(fnd || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (item: RecurringIncome) => {
    setEditing(item)
    setForm({
      name: item.name, amount: Number(item.amount), is_variable: item.is_variable,
      frequency: item.frequency, day_of_month: item.day_of_month || 15,
      day_of_week: item.day_of_week ?? 6, delay_days: item.delay_days, fund_id: item.fund_id || '',
    })
    setShowModal(true)
  }

  const save = async () => {
    const data = {
      ...form,
      fund_id: form.fund_id || null,
      day_of_month: form.frequency === 'monthly' ? form.day_of_month : null,
      day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
    }
    if (editing) {
      await supabase.from('recurring_income').update(data).eq('id', editing.id)
    } else {
      await supabase.from('recurring_income').insert({ user_id: user!.id, ...data })
    }
    setShowModal(false)
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminare questa entrata?')) return
    await supabase.from('recurring_income').delete().eq('id', id)
    load()
  }

  const toggle = async (item: RecurringIncome) => {
    await supabase.from('recurring_income').update({ is_active: !item.is_active }).eq('id', item.id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const totalMonthly = items.filter(i => i.is_active).reduce((s, i) => {
    return s + (i.frequency === 'monthly' ? Number(i.amount) : Number(i.amount) * 4.33)
  }, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Entrate</h2>
          <p className="text-sm text-slate-500 mt-1">Stima mensile: <span className="font-semibold text-emerald-600">{cur(totalMonthly)}</span></p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
          <Plus className="w-4 h-4" /> Aggiungi
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-400 mb-4">Nessuna entrata configurata</p>
          <button onClick={openAdd} className="text-indigo-600 font-medium hover:text-indigo-700">Aggiungi la prima entrata</button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const fundName = funds.find(f => f.id === item.fund_id)?.name
            return (
              <div key={item.id} className={`bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between transition ${!item.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <button onClick={() => toggle(item)} className="text-slate-400 hover:text-indigo-600 transition">
                    {item.is_active ? <ToggleRight className="w-6 h-6 text-emerald-600" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                  <div>
                    <p className="font-medium text-slate-800">{item.name} {item.is_variable && <span className="text-xs text-amber-500 font-normal">(variabile)</span>}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-2">
                      {item.frequency === 'monthly' ? (
                        <><Calendar className="w-3 h-3" /> Giorno {item.day_of_month}</>
                      ) : (
                        <><Clock className="w-3 h-3" /> Ogni {DAYS[item.day_of_week ?? 0]}</>
                      )}
                      {item.delay_days > 0 && <span>· Ritardo {item.delay_days}gg</span>}
                      {fundName && <span>· {fundName}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-lg font-semibold text-emerald-600">{cur(Number(item.amount))}</span>
                    <p className="text-xs text-slate-400">{item.frequency === 'monthly' ? '/mese' : '/settimana'}</p>
                  </div>
                  <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Modifica Entrata' : 'Nuova Entrata'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Stipendio, Lavoro sabato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Frequenza</label>
              <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value as 'monthly' | 'weekly' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                <option value="monthly">Mensile</option>
                <option value="weekly">Settimanale</option>
              </select>
            </div>
          </div>
          {form.frequency === 'monthly' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno del mese</label>
              <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Giorno della settimana</label>
                <select value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ritardo pagamento (gg)</label>
                <input type="number" min={0} value={form.delay_days} onChange={e => setForm({ ...form, delay_days: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="variable" checked={form.is_variable} onChange={e => setForm({ ...form, is_variable: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <label htmlFor="variable" className="text-sm text-slate-700">Importo variabile (la cifra indicata è una stima)</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo destinazione (opzionale)</label>
            <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Nessuno</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={save} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition">
            {editing ? 'Salva Modifiche' : 'Aggiungi Entrata'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
