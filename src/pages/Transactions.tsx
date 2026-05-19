import { useState, useEffect } from 'react'
import { Plus, Trash2, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Filter } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/Modal'
import type { Transaction, Fund } from '../types'

const cur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const CATEGORIES = ['casa', 'bollette', 'trasporti', 'cibo', 'salute', 'abbonamenti', 'svago', 'vestiti', 'stipendio', 'lavoro', 'trasferimento', 'altro']

const emptyForm = {
  type: 'expense' as 'income' | 'expense' | 'transfer',
  amount: 0, description: '', fund_id: '', fund_to_id: '',
  category: 'altro', date: new Date().toISOString().split('T')[0],
}

export default function Transactions() {
  const { user } = useAuth()
  const [items, setItems] = useState<Transaction[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterFund, setFilterFund] = useState<string>('all')

  const load = async () => {
    const [{ data: tx }, { data: fnd }] = await Promise.all([
      supabase.from('transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      supabase.from('funds').select('*').order('sort_order'),
    ])
    setItems(tx || [])
    setFunds(fnd || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const save = async () => {
    const tx = {
      user_id: user!.id,
      type: form.type,
      amount: form.amount,
      description: form.description,
      fund_id: form.fund_id || null,
      fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.category,
      date: form.date,
    }

    await supabase.from('transactions').insert(tx)

    if (form.fund_id) {
      const fund = funds.find(f => f.id === form.fund_id)
      if (fund) {
        const delta = form.type === 'income' ? form.amount : -form.amount
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fund.id)
      }
    }

    if (form.type === 'transfer' && form.fund_to_id) {
      const fundTo = funds.find(f => f.id === form.fund_to_id)
      if (fundTo) {
        await supabase.from('funds').update({ balance: Number(fundTo.balance) + form.amount }).eq('id', fundTo.id)
      }
    }

    setShowModal(false)
    setForm(emptyForm)
    load()
  }

  const remove = async (tx: Transaction) => {
    if (!confirm('Eliminare questa transazione?')) return

    if (tx.fund_id) {
      const fund = funds.find(f => f.id === tx.fund_id)
      if (fund) {
        const delta = tx.type === 'income' ? -Number(tx.amount) : Number(tx.amount)
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fund.id)
      }
    }
    if (tx.type === 'transfer' && tx.fund_to_id) {
      const fundTo = funds.find(f => f.id === tx.fund_to_id)
      if (fundTo) {
        await supabase.from('funds').update({ balance: Number(fundTo.balance) - Number(tx.amount) }).eq('id', fundTo.id)
      }
    }

    await supabase.from('transactions').delete().eq('id', tx.id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const filtered = items.filter(tx => {
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterFund !== 'all' && tx.fund_id !== filterFund && tx.fund_to_id !== filterFund) return false
    return true
  })

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'income') return <ArrowDownRight className="w-4 h-4 text-emerald-500" />
    if (type === 'expense') return <ArrowUpRight className="w-4 h-4 text-red-500" />
    return <ArrowLeftRight className="w-4 h-4 text-indigo-500" />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Transazioni</h2>
        <button onClick={() => { setForm(emptyForm); setShowModal(true) }} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
          <Plus className="w-4 h-4" /> Nuova
        </button>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Filter className="w-4 h-4 text-slate-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="all">Tutti i tipi</option>
          <option value="income">Entrate</option>
          <option value="expense">Uscite</option>
          <option value="transfer">Trasferimenti</option>
        </select>
        <select value={filterFund} onChange={e => setFilterFund(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="all">Tutti i fondi</option>
          {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-400">Nessuna transazione trovata</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(tx => {
            const fundName = funds.find(f => f.id === tx.fund_id)?.name
            const fundToName = funds.find(f => f.id === tx.fund_to_id)?.name
            return (
              <div key={tx.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tx.type === 'income' ? 'bg-emerald-50' : tx.type === 'expense' ? 'bg-red-50' : 'bg-indigo-50'}`}>
                    <TypeIcon type={tx.type} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{tx.description || (tx.type === 'income' ? 'Entrata' : tx.type === 'expense' ? 'Uscita' : 'Trasferimento')}</p>
                    <p className="text-xs text-slate-400">
                      {format(new Date(tx.date), 'dd MMM yyyy', { locale: it })}
                      {fundName && ` · ${fundName}`}
                      {fundToName && ` → ${fundToName}`}
                      {tx.category !== 'altro' && ` · ${tx.category}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-semibold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-red-500' : 'text-indigo-600'}`}>
                    {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{cur(Number(tx.amount))}
                  </span>
                  <button onClick={() => remove(tx)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nuova Transazione">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
            <div className="grid grid-cols-3 gap-2">
              {(['expense', 'income', 'transfer'] as const).map(t => (
                <button key={t} onClick={() => setForm({ ...form, type: t })} className={`py-2 rounded-lg text-sm font-medium border transition ${form.type === t ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {t === 'expense' ? 'Uscita' : t === 'income' ? 'Entrata' : 'Trasferimento'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="es. Spesa supermercato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{form.type === 'transfer' ? 'Da fondo' : 'Fondo'}</label>
            <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
              <option value="">Seleziona</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          {form.type === 'transfer' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">A fondo</label>
              <select value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                <option value="">Seleziona</option>
                {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none capitalize">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={form.amount <= 0} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            Registra Transazione
          </button>
        </div>
      </Modal>
    </div>
  )
}
