import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Filter } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, TRANSACTION_CATEGORIES } from '../lib/utils'
import type { Transaction, Fund } from '../types'

const PAGE_SIZE = 50

const emptyForm = {
  type: 'expense' as 'income' | 'expense' | 'transfer',
  amount: 0, description: '', fund_id: '', fund_to_id: '',
  category: 'altro', date: new Date().toISOString().split('T')[0],
}

export default function Transactions() {
  const { user } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<Transaction[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterFund, setFilterFund] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [hasMore, setHasMore] = useState(true)

  const load = async (reset = true) => {
    const offset = reset ? 0 : items.length
    let query = supabase.from('transactions').select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo) query = query.lte('date', dateTo)

    const [{ data: tx, error: e1 }, { data: fnd, error: e2 }] = await Promise.all([
      query,
      reset ? supabase.from('funds').select('*').order('sort_order') : Promise.resolve({ data: funds, error: null }),
    ])
    if (e1 || e2) toast.error('Errore nel caricamento')
    if (reset) {
      setItems(tx || [])
      setFunds(fnd || [])
    } else {
      setItems(prev => [...prev, ...(tx || [])])
    }
    setHasMore((tx?.length || 0) === PAGE_SIZE)
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user, dateFrom, dateTo])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (tx: Transaction) => {
    setEditing(tx)
    setForm({
      type: tx.type, amount: Number(tx.amount), description: tx.description,
      fund_id: tx.fund_id || '', fund_to_id: tx.fund_to_id || '',
      category: tx.category, date: tx.date,
    })
    setShowModal(true)
  }

  const save = async () => {
    if (form.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)

    if (editing) {
      // Revert old balance
      if (editing.fund_id) {
        const { data: oldFund } = await supabase.from('funds').select('balance').eq('id', editing.fund_id).single()
        if (oldFund) {
          const revert = editing.type === 'income' ? -Number(editing.amount) : Number(editing.amount)
          await supabase.from('funds').update({ balance: Number(oldFund.balance) + revert }).eq('id', editing.fund_id)
        }
      }
      if (editing.type === 'transfer' && editing.fund_to_id) {
        const { data: oldTo } = await supabase.from('funds').select('balance').eq('id', editing.fund_to_id).single()
        if (oldTo) {
          await supabase.from('funds').update({ balance: Number(oldTo.balance) - Number(editing.amount) }).eq('id', editing.fund_to_id)
        }
      }

      await supabase.from('transactions').update({
        type: form.type, amount: form.amount, description: form.description,
        fund_id: form.fund_id || null, fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
        category: form.category, date: form.date,
      }).eq('id', editing.id)
    } else {
      await supabase.from('transactions').insert({
        user_id: user!.id, type: form.type, amount: form.amount, description: form.description,
        fund_id: form.fund_id || null, fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
        category: form.category, date: form.date,
      })
    }

    // Apply new balance
    if (form.fund_id) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', form.fund_id).single()
      if (fund) {
        const delta = form.type === 'income' ? form.amount : -form.amount
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', form.fund_id)
      }
    }
    if (form.type === 'transfer' && form.fund_to_id) {
      const { data: fundTo } = await supabase.from('funds').select('balance').eq('id', form.fund_to_id).single()
      if (fundTo) {
        await supabase.from('funds').update({ balance: Number(fundTo.balance) + form.amount }).eq('id', form.fund_to_id)
      }
    }

    setSaving(false)
    toast.success(editing ? 'Transazione aggiornata' : 'Transazione registrata')
    setShowModal(false)
    setEditing(null)
    setForm(emptyForm)
    load()
  }

  const remove = async (tx: Transaction) => {
    if (!confirm('Eliminare questa transazione?')) return

    if (tx.fund_id) {
      const { data: fund } = await supabase.from('funds').select('balance').eq('id', tx.fund_id).single()
      if (fund) {
        const delta = tx.type === 'income' ? -Number(tx.amount) : Number(tx.amount)
        await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', tx.fund_id)
      }
    }
    if (tx.type === 'transfer' && tx.fund_to_id) {
      const { data: fundTo } = await supabase.from('funds').select('balance').eq('id', tx.fund_to_id).single()
      if (fundTo) {
        await supabase.from('funds').update({ balance: Number(fundTo.balance) - Number(tx.amount) }).eq('id', tx.fund_to_id)
      }
    }

    const { error } = await supabase.from('transactions').delete().eq('id', tx.id)
    if (error) { toast.error('Errore nell\'eliminazione'); return }
    toast.success('Transazione eliminata')
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
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
          <Plus className="w-4 h-4" /> Nuova
        </button>
      </div>

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
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Da" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="A" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-400">Nessuna transazione trovata</p>
        </div>
      ) : (
        <>
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
                    <button onClick={() => openEdit(tx)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(tx)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {hasMore && (
            <button onClick={() => load(false)} className="w-full mt-4 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition">
              Carica altre
            </button>
          )}
        </>
      )}

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Modifica Transazione' : 'Nuova Transazione'}>
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
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {form.type === 'transfer' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">A fondo</label>
              <select value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
                <option value="">Seleziona</option>
                {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none capitalize">
              {TRANSACTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={form.amount <= 0 || saving} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Registra Transazione'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
