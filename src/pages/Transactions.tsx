import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Filter, CheckSquare, Square, X, Search } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, TRANSACTION_CATEGORIES, todayString } from '../lib/utils'
import InfoBox from '../components/InfoBox'
import type { Transaction, Fund } from '../types'

const PAGE_SIZE = 50

const emptyForm = {
  type: 'expense' as 'income' | 'expense' | 'transfer',
  amount: 0, description: '', fund_id: '', fund_to_id: '',
  category: 'altro', date: todayString(),
}

function txBalanceDelta(tx: Transaction): { fundId: string; delta: number }[] {
  if (tx.is_memo) return []
  const out: { fundId: string; delta: number }[] = []
  if (tx.fund_id) {
    const sign = tx.type === 'income' ? 1 : -1
    out.push({ fundId: tx.fund_id, delta: sign * Number(tx.amount) })
  }
  if (tx.type === 'transfer' && tx.fund_to_id) {
    out.push({ fundId: tx.fund_to_id, delta: Number(tx.amount) })
  }
  return out
}

async function applyFundDeltas(deltas: Map<string, number>) {
  for (const [fundId, delta] of deltas) {
    if (delta === 0) continue
    const { data: fund } = await supabase.from('funds').select('balance').eq('id', fundId).single()
    if (fund) {
      await supabase.from('funds').update({ balance: Number(fund.balance) + delta }).eq('id', fundId)
    }
  }
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
  const [filterSource, setFilterSource] = useState<string>('all')
  const [filterText, setFilterText] = useState('')
  const [includePlanned, setIncludePlanned] = useState(false)
  const [includeMemo, setIncludeMemo] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = async (reset = true) => {
    try {
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
      const firstError = e1 || e2
      if (firstError) {
        console.error('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      if (reset) {
        setItems(tx || [])
        setFunds(fnd || [])
        setSelectedIds(new Set())
      } else {
        setItems(prev => [...prev, ...(tx || [])])
      }
      setHasMore((tx?.length || 0) === PAGE_SIZE)
    } catch (err) {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    } finally {
      setLoading(false)
    }
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
    if (form.type === 'transfer' && (!form.fund_id || !form.fund_to_id)) {
      toast.error('Seleziona entrambi i fondi per il trasferimento'); return
    }
    setSaving(true)

    const deltas = new Map<string, number>()

    if (editing) {
      for (const { fundId, delta } of txBalanceDelta(editing)) {
        deltas.set(fundId, (deltas.get(fundId) || 0) - delta)
      }
    }

    const newTx: Transaction = {
      ...(editing || { id: '', user_id: '', created_at: '', is_memo: false, is_planned: false, budget_id: null, variable_expense_id: null, recurring_expense_id: null, recurring_income_id: null }),
      type: form.type,
      amount: form.amount,
      description: form.description,
      fund_id: form.fund_id || null,
      fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.category,
      date: form.date,
    }
    for (const { fundId, delta } of txBalanceDelta(newTx)) {
      deltas.set(fundId, (deltas.get(fundId) || 0) + delta)
    }

    const payload = {
      type: form.type, amount: form.amount, description: form.description,
      fund_id: form.fund_id || null, fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.category, date: form.date,
    }

    const { error } = editing
      ? await supabase.from('transactions').update(payload).eq('id', editing.id)
      : await supabase.from('transactions').insert({ user_id: user!.id, ...payload })

    if (error) {
      setSaving(false)
      toast.error('Errore nel salvataggio')
      return
    }

    await applyFundDeltas(deltas)

    setSaving(false)
    toast.success(editing ? 'Transazione aggiornata' : 'Transazione registrata')
    setShowModal(false)
    setEditing(null)
    setForm(emptyForm)
    load()
  }

  const remove = async (tx: Transaction) => {
    if (!confirm('Eliminare questa transazione? Il saldo del fondo sarà ripristinato.')) return

    const deltas = new Map<string, number>()
    for (const { fundId, delta } of txBalanceDelta(tx)) {
      deltas.set(fundId, (deltas.get(fundId) || 0) - delta)
    }

    const { error } = await supabase.from('transactions').delete().eq('id', tx.id)
    if (error) { toast.error('Errore nell\'eliminazione'); return }

    await applyFundDeltas(deltas)
    toast.success('Transazione eliminata')
    load()
  }

  const bulkDelete = async () => {
    const selected = items.filter(tx => selectedIds.has(tx.id))
    if (selected.length === 0) return
    const total = selected.reduce((s, tx) => s + (tx.is_memo ? 0 : Number(tx.amount)), 0)
    const msg = `Eliminare ${selected.length} transazion${selected.length === 1 ? 'e' : 'i'}? I saldi verranno ripristinati per un totale di ${cur(total)}.`
    if (!confirm(msg)) return

    setBulkDeleting(true)
    const deltas = new Map<string, number>()
    for (const tx of selected) {
      for (const { fundId, delta } of txBalanceDelta(tx)) {
        deltas.set(fundId, (deltas.get(fundId) || 0) - delta)
      }
    }

    const ids = selected.map(t => t.id)
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) {
      setBulkDeleting(false)
      toast.error('Errore nell\'eliminazione massiva')
      return
    }

    await applyFundDeltas(deltas)
    setBulkDeleting(false)
    toast.success(`${selected.length} transazion${selected.length === 1 ? 'e eliminata' : 'i eliminate'}`)
    load()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const duplicateGroups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const tx of items) {
      if (tx.is_memo) continue
      const key = `${tx.description}|${tx.type}|${tx.fund_id || ''}|${tx.fund_to_id || ''}|${tx.amount}|${tx.date}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tx)
    }
    const dups = new Set<string>()
    for (const group of map.values()) {
      if (group.length > 1) group.slice(1).forEach(tx => dups.add(tx.id))
    }
    return dups
  }, [items])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const filtered = items.filter(tx => {
    if (!includePlanned && tx.is_planned) return false
    if (!includeMemo && tx.is_memo) return false
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterFund !== 'all' && tx.fund_id !== filterFund && tx.fund_to_id !== filterFund) return false
    if (filterSource !== 'all') {
      if (filterSource === 'recurring_expense' && !tx.recurring_expense_id) return false
      if (filterSource === 'recurring_income' && !tx.recurring_income_id) return false
      if (filterSource === 'budget' && !tx.budget_id) return false
      if (filterSource === 'variable' && !tx.variable_expense_id) return false
      if (filterSource === 'manual' && (tx.recurring_expense_id || tx.recurring_income_id || tx.budget_id || tx.variable_expense_id)) return false
    }
    if (filterText && !tx.description.toLowerCase().includes(filterText.toLowerCase()) && !tx.category.toLowerCase().includes(filterText.toLowerCase())) return false
    return true
  })

  const filteredVisibleIds = filtered.map(t => t.id)
  const allFilteredSelected = filteredVisibleIds.length > 0 && filteredVisibleIds.every(id => selectedIds.has(id))
  const someFilteredSelected = filteredVisibleIds.some(id => selectedIds.has(id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredVisibleIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredVisibleIds.forEach(id => next.add(id))
        return next
      })
    }
  }

  const selectDuplicates = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      duplicateGroups.forEach(id => next.add(id))
      return next
    })
    if (duplicateGroups.size === 0) toast.error('Nessun duplicato trovato')
    else toast.success(`${duplicateGroups.size} duplicat${duplicateGroups.size === 1 ? 'o' : 'i'} selezionat${duplicateGroups.size === 1 ? 'o' : 'i'}`)
  }

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'income') return <ArrowDownRight className="w-4 h-4 text-emerald-500" />
    if (type === 'expense') return <ArrowUpRight className="w-4 h-4 text-red-500" />
    return <ArrowLeftRight className="w-4 h-4 text-indigo-500" />
  }

  return (
    <div>
      <InfoBox title="Cosa vedi qui" tone="indigo">
        <p>Tutte le transazioni effettive che hanno modificato (o modificheranno) i tuoi fondi. Ogni riga ha badge che indicano da dove proviene:</p>
        <ul className="list-disc ml-4 space-y-0.5">
          <li><strong>entrata ric.</strong> / <strong>auto-uscita</strong>: generata confermando una voce ricorrente o da auto-deduct</li>
          <li><strong>budget</strong>: spesa inserita dentro un budget settimanale</li>
          <li><strong>var.</strong>: spesa inserita dentro una variable expense (es. GPL)</li>
          <li><strong>memo</strong>: "solo pagato" o "non lavorato" — non muove i fondi</li>
          <li><strong>pianif.</strong>: futura/pianificata, non ancora avvenuta — non influisce sul saldo</li>
        </ul>
        <p>Le pianificate e i memo sono <strong>nascoste di default</strong>. Spunta le checkbox in alto per vederle.</p>
        <p>Modifica/elimina: i saldi dei fondi vengono ripristinati automaticamente. Il pulsante "Seleziona duplicati" identifica e seleziona transazioni identiche per eliminarle in blocco.</p>
      </InfoBox>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-sm text-slate-500">
            {filtered.length} di {items.length} transazion{items.length === 1 ? 'e' : 'i'}
            {duplicateGroups.size > 0 && (
              <span className="ml-2 text-amber-600 font-medium">· {duplicateGroups.size} possibili duplicat{duplicateGroups.size === 1 ? 'o' : 'i'}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {duplicateGroups.size > 0 && (
            <button onClick={selectDuplicates} className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition text-sm font-medium">
              Seleziona duplicati
            </button>
          )}
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
            <Plus className="w-4 h-4" /> Nuova
          </button>
        </div>
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
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="all">Tutte le origini</option>
          <option value="recurring_income">Entrate ricorrenti</option>
          <option value="recurring_expense">Spese ricorrenti</option>
          <option value="budget">Da budget settimanali</option>
          <option value="variable">Da spese variabili</option>
          <option value="manual">Solo manuali</option>
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Cerca..." className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Da" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="A" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={includePlanned} onChange={e => setIncludePlanned(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          Pianificate
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={includeMemo} onChange={e => setIncludeMemo(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          Memo
        </label>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-indigo-700">{selectedIds.size} selezionat{selectedIds.size === 1 ? 'a' : 'e'}</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              <X className="w-3 h-3" /> Deseleziona
            </button>
          </div>
          <button
            onClick={bulkDelete}
            disabled={bulkDeleting}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" /> {bulkDeleting ? 'Eliminazione...' : 'Elimina'}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-400">Nessuna transazione trovata</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-2 mb-2 flex items-center gap-3">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800">
              {allFilteredSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className={`w-4 h-4 ${someFilteredSelected ? 'text-indigo-400' : 'text-slate-400'}`} />}
              <span>{allFilteredSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}</span>
            </button>
          </div>
          <div className="space-y-2">
            {filtered.map(tx => {
              const fundName = funds.find(f => f.id === tx.fund_id)?.name
              const fundToName = funds.find(f => f.id === tx.fund_to_id)?.name
              const isSelected = selectedIds.has(tx.id)
              const isDuplicate = duplicateGroups.has(tx.id)
              return (
                <div
                  key={tx.id}
                  className={`bg-white rounded-xl border p-4 flex items-center justify-between transition ${isSelected ? 'border-indigo-500 bg-indigo-50/30' : isDuplicate ? 'border-amber-300' : 'border-slate-200'}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button onClick={() => toggleSelect(tx.id)} className="shrink-0">
                      {isSelected ? <CheckSquare className="w-5 h-5 text-indigo-600" /> : <Square className="w-5 h-5 text-slate-300 hover:text-slate-500" />}
                    </button>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tx.type === 'income' ? 'bg-emerald-50' : tx.type === 'expense' ? 'bg-red-50' : 'bg-indigo-50'}`}>
                      <TypeIcon type={tx.type} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-800 text-sm truncate">{tx.description || (tx.type === 'income' ? 'Entrata' : tx.type === 'expense' ? 'Uscita' : 'Trasferimento')}</p>
                        {isDuplicate && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium uppercase">duplicato</span>}
                        {tx.is_planned && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium uppercase">pianif.</span>}
                        {tx.is_memo && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium uppercase">memo</span>}
                        {tx.recurring_expense_id && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium uppercase">auto-uscita</span>}
                        {tx.recurring_income_id && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium uppercase">entrata ric.</span>}
                        {tx.budget_id && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium uppercase">budget</span>}
                        {tx.variable_expense_id && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium uppercase">var.</span>}
                      </div>
                      <p className="text-xs text-slate-400">
                        {format(new Date(tx.date), 'dd MMM yyyy', { locale: it })}
                        {fundName && ` · ${fundName}`}
                        {fundToName && ` → ${fundToName}`}
                        {tx.category !== 'altro' && ` · ${tx.category}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <span className={`text-base sm:text-lg font-semibold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-red-500' : 'text-indigo-600'}`}>
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
          {editing && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Salvando le modifiche, i saldi dei fondi verranno aggiornati di conseguenza.
            </div>
          )}
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
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
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
