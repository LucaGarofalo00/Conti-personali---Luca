import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Filter, CheckSquare, Square, X, Search } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import { cur, TRANSACTION_CATEGORIES, todayString, FUEL_CATEGORY, parseDecimal, catLabel } from '../lib/utils'
import { incrementFundBalance } from '../lib/fundBalances'
import { logSupabaseError } from '../lib/logError'
import { fuelConsumption, previousFuelFill, averageFuelConsumption, normalizeFuelType, FUEL_TYPE_LABEL, type FuelType } from '../lib/fuelConsumption'
import InfoBox from '../components/InfoBox'
import type { Transaction, Fund } from '../types'

const PAGE_SIZE = 50

const emptyForm = {
  type: 'expense' as 'income' | 'expense' | 'transfer',
  amount: 0, description: '', fund_id: '', fund_to_id: '',
  category: 'altro', date: todayString(),
  fuel_km: '', fuel_liters: '', fuel_price_per_liter: '', fuel_type: 'gpl' as FuelType,
}

function isFuelColumnError(msg?: string | null): boolean {
  if (!msg) return false
  return /fuel_(km|liters|price_per_liter|type)/.test(msg) && /column|schema|find/i.test(msg)
}

function numToInput(n: number | string | null): string {
  if (n == null) return ''
  return String(Number(n)).replace('.', ',')
}

function txBalanceDelta(tx: Transaction): { fundId: string; delta: number }[] {
  // memo e pianificate non hanno mai mosso i saldi: non devono stornarli/applicarli
  // quando vengono modificate o eliminate.
  if (tx.is_memo || tx.is_planned) return []
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
    await incrementFundBalance(fundId, delta)
  }
}

export default function Transactions() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<Transaction[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [fuelFills, setFuelFills] = useState<Transaction[]>([])
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
  const [showFilters, setShowFilters] = useState(false)
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

      const [{ data: tx, error: e1 }, { data: fnd, error: e2 }, fuelRes] = await Promise.all([
        query,
        reset ? supabase.from('funds').select('*').order('sort_order') : Promise.resolve({ data: funds, error: null }),
        reset ? supabase.from('transactions').select('*').eq('category', FUEL_CATEGORY) : Promise.resolve({ data: null, error: null }),
      ])
      const firstError = e1 || e2
      if (firstError) {
        logSupabaseError('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      if (reset) {
        setItems(tx || [])
        setFunds(fnd || [])
        if (!fuelRes.error) setFuelFills((fuelRes.data || []).filter(t => !t.is_planned))
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
      fuel_km: numToInput(tx.fuel_km),
      fuel_liters: numToInput(tx.fuel_liters),
      fuel_price_per_liter: numToInput(tx.fuel_price_per_liter),
      fuel_type: normalizeFuelType(tx.fuel_type),
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
      ...(editing || { id: '', user_id: '', created_at: '', is_memo: false, is_planned: false, budget_id: null, recurring_expense_id: null, recurring_income_id: null, fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null }),
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

    const isFuel = form.type === 'expense' && form.category === FUEL_CATEGORY
    const hadFuel = !!editing && (editing.fuel_km != null || editing.fuel_liters != null || editing.fuel_price_per_liter != null)
    const fuelFields = isFuel
      ? { fuel_km: parseDecimal(form.fuel_km) || null, fuel_liters: parseDecimal(form.fuel_liters) || null, fuel_price_per_liter: parseDecimal(form.fuel_price_per_liter) || null, fuel_type: form.fuel_type }
      : hadFuel
        ? { fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null }
        : {}

    const payload = {
      type: form.type, amount: form.amount, description: form.description,
      fund_id: form.fund_id || null, fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.category, date: form.date,
      ...fuelFields,
    }

    const { error } = editing
      ? await supabase.from('transactions').update(payload).eq('id', editing.id)
      : await supabase.from('transactions').insert({ user_id: user!.id, ...payload })

    if (error) {
      setSaving(false)
      if (isFuelColumnError(error.message)) {
        toast.error('Colonne benzina mancanti nel database: esegui la SQL indicata nel banner della Dashboard')
      } else {
        toast.error('Errore nel salvataggio')
      }
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
    if (!(await confirm({ message: 'Eliminare questa transazione? Il saldo del fondo sarà ripristinato.', confirmText: 'Elimina', danger: true }))) return

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
    if (!(await confirm({ message: msg, confirmText: 'Elimina', danger: true }))) return

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

  const avgByType = useMemo(() => ({
    benzina: averageFuelConsumption(fuelFills, 'benzina'),
    gpl: averageFuelConsumption(fuelFills, 'gpl'),
  }), [fuelFills])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const filtersActive = filterType !== 'all' || filterFund !== 'all' || filterSource !== 'all' || filterText !== '' || dateFrom !== '' || dateTo !== '' || includePlanned || includeMemo
  const resetFilters = () => {
    setFilterType('all'); setFilterFund('all'); setFilterSource('all'); setFilterText('')
    setDateFrom(''); setDateTo(''); setIncludePlanned(false); setIncludeMemo(false)
  }

  const filtered = items.filter(tx => {
    if (!includePlanned && tx.is_planned) return false
    if (!includeMemo && tx.is_memo) return false
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterFund !== 'all' && tx.fund_id !== filterFund && tx.fund_to_id !== filterFund) return false
    if (filterSource !== 'all') {
      if (filterSource === 'recurring_expense' && !tx.recurring_expense_id) return false
      if (filterSource === 'recurring_income' && !tx.recurring_income_id) return false
      if (filterSource === 'budget' && !tx.budget_id) return false
      if (filterSource === 'manual' && (tx.recurring_expense_id || tx.recurring_income_id || tx.budget_id)) return false
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
    return <ArrowLeftRight className="w-4 h-4 text-blue-500" />
  }

  return (
    <div>
      <InfoBox title="Cosa vedi qui" tone="blue">
        <p>Tutte le transazioni effettive che hanno modificato (o modificheranno) i tuoi fondi. Ogni riga ha badge che indicano da dove proviene:</p>
        <ul className="list-disc ml-4 space-y-0.5">
          <li><strong>entrata ric.</strong> / <strong>auto-uscita</strong>: generata confermando una voce ricorrente o da auto-deduct</li>
          <li><strong>budget</strong>: spesa inserita dentro un budget settimanale</li>
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
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-[13px] font-medium">
            <Plus className="w-4 h-4" /> Nuova
          </button>
        </div>
      </div>

      <button
        onClick={() => setShowFilters(s => !s)}
        className="sm:hidden flex items-center gap-2 mb-3 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 font-medium"
      >
        <Filter className="w-4 h-4" /> Filtri
        {filtersActive && <span className="w-2 h-2 rounded-full bg-blue-500" aria-label="filtri attivi" />}
      </button>
      <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex flex-wrap gap-3 mb-4 items-center`}>
        <Filter className="w-4 h-4 text-slate-400 hidden sm:block" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutti i tipi</option>
          <option value="income">Entrate</option>
          <option value="expense">Uscite</option>
          <option value="transfer">Trasferimenti</option>
        </select>
        <select value={filterFund} onChange={e => setFilterFund(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutti i fondi</option>
          {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutte le origini</option>
          <option value="recurring_income">Entrate ricorrenti</option>
          <option value="recurring_expense">Spese ricorrenti</option>
          <option value="budget">Da budget settimanali</option>
          <option value="manual">Solo manuali</option>
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Cerca..." className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Da
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">A
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={includePlanned} onChange={e => setIncludePlanned(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Pianificate
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={includeMemo} onChange={e => setIncludeMemo(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Memo
        </label>
        {filtersActive && (
          <button onClick={resetFilters} className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
            <X className="w-3.5 h-3.5" /> Azzera
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-blue-700">{selectedIds.size} selezionat{selectedIds.size === 1 ? 'a' : 'e'}</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
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
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200/60 shadow-sm">
          <p className="text-slate-400">Nessuna transazione trovata</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm px-4 py-2 mb-2 flex items-center gap-3">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800">
              {allFilteredSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className={`w-4 h-4 ${someFilteredSelected ? 'text-blue-400' : 'text-slate-400'}`} />}
              <span>{allFilteredSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}</span>
            </button>
          </div>
          <div className="space-y-2">
            {filtered.map(tx => {
              const fundName = funds.find(f => f.id === tx.fund_id)?.name
              const fundToName = funds.find(f => f.id === tx.fund_to_id)?.name
              const isSelected = selectedIds.has(tx.id)
              const isDuplicate = duplicateGroups.has(tx.id)
              const isFuelTx = tx.category === FUEL_CATEGORY
              const txFuelType = normalizeFuelType(tx.fuel_type)
              const fuelParts: string[] = []
              if (isFuelTx && (tx.fuel_km != null || tx.fuel_liters != null)) fuelParts.push(FUEL_TYPE_LABEL[txFuelType])
              if (tx.fuel_km != null) fuelParts.push(`${Number(tx.fuel_km).toLocaleString('it-IT')} km`)
              if (tx.fuel_liters != null) fuelParts.push(`${Number(tx.fuel_liters).toLocaleString('it-IT')} L`)
              if (tx.fuel_price_per_liter != null) fuelParts.push(`${Number(tx.fuel_price_per_liter).toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/L`)
              const fuelLine = fuelParts.join(' · ')
              const prevFill = isFuelTx && tx.fuel_km != null ? previousFuelFill(tx, fuelFills) : null
              const cons = prevFill && prevFill.fuel_liters != null
                ? fuelConsumption(Number(tx.fuel_km), Number(prevFill.fuel_liters), Number(prevFill.amount))
                : null
              const avg = isFuelTx && tx.fuel_km != null ? avgByType[txFuelType] : null
              return (
                <div
                  key={tx.id}
                  className={`bg-white rounded-xl border p-4 flex items-center justify-between transition ${isSelected ? 'border-blue-500 bg-blue-50/30' : isDuplicate ? 'border-amber-300' : 'border-slate-200'}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button onClick={() => toggleSelect(tx.id)} aria-label={isSelected ? 'Deseleziona transazione' : 'Seleziona transazione'} aria-pressed={isSelected} className="shrink-0">
                      {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-slate-300 hover:text-slate-500" />}
                    </button>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tx.type === 'income' ? 'bg-emerald-50' : tx.type === 'expense' ? 'bg-red-50' : 'bg-blue-50'}`}>
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
                        {tx.budget_id && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium uppercase">budget</span>}
                      </div>
                      <p className="text-xs text-slate-400">
                        {format(new Date(tx.date), 'dd MMM yyyy', { locale: it })}
                        {tx.planned_date && tx.planned_date !== tx.date && ` · previsto ${format(new Date(tx.planned_date + 'T00:00:00'), 'd MMM', { locale: it })}`}
                        {fundName && ` · ${fundName}`}
                        {fundToName && ` → ${fundToName}`}
                        {tx.category !== 'altro' && ` · ${catLabel(tx.category)}`}
                      </p>
                      {fuelLine && <p className="text-[11px] text-slate-400 mt-0.5">{fuelLine}</p>}
                      {cons && (
                        <p className="text-[11px] text-emerald-600/90">
                          Pieno prec.: {cons.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l · {cons.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                          {cons.costPerKm != null && ` · ${cur(cons.costPerKm)}/km`}
                        </p>
                      )}
                      {avg && (
                        <p className="text-[11px] text-slate-400">
                          Media {FUEL_TYPE_LABEL[txFuelType]}: {avg.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l · {avg.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                          {avg.costPerKm != null && ` · ${cur(avg.costPerKm)}/km`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <span className={`text-base sm:text-lg font-semibold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-red-500' : 'text-blue-600'}`}>
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{cur(Number(tx.amount))}
                    </span>
                    <button onClick={() => openEdit(tx)} aria-label="Modifica transazione" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(tx)} aria-label="Elimina transazione" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {hasMore && (
            <button onClick={() => load(false)} className="w-full mt-4 py-2.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
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
                <button key={t} onClick={() => setForm({ ...form, type: t })} className={`py-2 rounded-lg text-sm font-medium border transition ${form.type === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {t === 'expense' ? 'Uscita' : t === 'income' ? 'Entrata' : 'Trasferimento'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Spesa supermercato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput value={form.amount} onChange={n => setForm({ ...form, amount: n })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{form.type === 'transfer' ? 'Da fondo' : 'Fondo'}</label>
            <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          {form.type === 'transfer' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">A fondo</label>
              <select value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                <option value="">Seleziona</option>
                {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow capitalize">
              {TRANSACTION_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </div>
          {form.type === 'expense' && form.category === FUEL_CATEGORY && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Dati rifornimento (facoltativi)</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo carburante</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['gpl', 'benzina'] as const).map(ft => (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => setForm({ ...form, fuel_type: ft })}
                      className={`py-2 rounded-lg text-sm font-medium border transition ${form.fuel_type === ft ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {FUEL_TYPE_LABEL[ft]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Km percorsi</label>
                  <input
                    type="text" inputMode="decimal"
                    value={form.fuel_km}
                    onChange={e => setForm({ ...form, fuel_km: e.target.value })}
                    placeholder="es. 450"
                    className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Litri</label>
                  <input
                    type="text" inputMode="decimal"
                    value={form.fuel_liters}
                    onChange={e => setForm({ ...form, fuel_liters: e.target.value })}
                    placeholder="es. 30"
                    className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">€/litro</label>
                  <input
                    type="text" inputMode="decimal"
                    value={form.fuel_price_per_liter}
                    onChange={e => setForm({ ...form, fuel_price_per_liter: e.target.value })}
                    placeholder="es. 1,80"
                    className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-sm"
                  />
                </div>
              </div>
              {(() => {
                const avg = avgByType[form.fuel_type]
                const km = parseDecimal(form.fuel_km)
                const ref = { id: editing?.id ?? '', date: form.date, created_at: editing?.created_at ?? new Date().toISOString(), fuel_type: form.fuel_type }
                const prev = km > 0 ? previousFuelFill(ref, fuelFills) : null
                const cons = prev && prev.fuel_liters != null ? fuelConsumption(km, Number(prev.fuel_liters), Number(prev.amount)) : null
                return (
                  <div className="space-y-1">
                    {km > 0 && (cons ? (
                      <p className="text-xs text-slate-600">
                        Consumo pieno precedente ({FUEL_TYPE_LABEL[form.fuel_type]}): <span className="font-semibold text-slate-800">{cons.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span>
                        {' · '}{cons.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                        {cons.costPerKm != null && <> · <span className="font-semibold text-slate-800">{cur(cons.costPerKm)}/km</span></>}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-600">Nessun rifornimento {FUEL_TYPE_LABEL[form.fuel_type]} precedente con i litri: il consumo del pieno non è calcolabile.</p>
                    ))}
                    {avg && (
                      <p className="text-xs text-slate-600">
                        Media totale {FUEL_TYPE_LABEL[form.fuel_type]}: <span className="font-semibold text-slate-800">{avg.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span>
                        {' · '}{avg.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                        {avg.costPerKm != null && <> · <span className="font-semibold text-slate-800">{cur(avg.costPerKm)}/km</span></>}
                      </p>
                    )}
                  </div>
                )
              })()}
              <p className="text-[11px] text-slate-400">I «Km percorsi» sono quelli fatti col pieno <strong>precedente</strong> dello stesso tipo. Servono solo per i consumi: non modificano l'importo.</p>
            </div>
          )}
          <button onClick={save} disabled={form.amount <= 0 || saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Registra Transazione'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
