import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Filter, CheckSquare, Square, X, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import { cur, TRANSACTION_CATEGORIES, todayString, FUEL_CATEGORY, parseDecimal, catLabel, fmtDate } from '../lib/utils'
import CategorySelect from '../components/CategorySelect'
import { isAmountsHidden } from '../lib/privacy'
import { incrementFundBalance } from '../lib/fundBalances'
import { postTransaction } from '../lib/postTransaction'
import { logSupabaseError } from '../lib/logError'
import { fuelConsumption, previousFuelFill, averageFuelConsumption, normalizeFuelType, FUEL_TYPE_LABEL, fuelStatsOdometer, lifetimeCostPerKmOdometer, lifetimePerFuelStima, type FuelType } from '../lib/fuelConsumption'
import InfoBox from '../components/InfoBox'
import type { Transaction, Fund } from '../types'

const PAGE_SIZE = 50

const emptyForm = {
  type: 'expense' as 'income' | 'expense' | 'transfer',
  amount: 0, description: '', fund_id: '', fund_to_id: '',
  category: 'altro', date: todayString(),
  fuel_odometer: '', fuel_liters: '', fuel_price_per_liter: '', fuel_type: 'gpl' as FuelType,
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
      fuel_odometer: numToInput(tx.fuel_odometer ?? null),
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

    const isFuel = form.type === 'expense' && form.category === FUEL_CATEGORY
    const hadFuel = !!editing && (editing.fuel_km != null || editing.fuel_liters != null || editing.fuel_price_per_liter != null || editing.fuel_odometer != null)
    const odoVal = parseDecimal(form.fuel_odometer)
    const fuelFields = isFuel
      ? {
          fuel_km: null,
          fuel_liters: parseDecimal(form.fuel_liters) || null,
          fuel_price_per_liter: parseDecimal(form.fuel_price_per_liter) || null,
          fuel_type: form.fuel_type,
          ...(odoVal > 0 ? { fuel_odometer: odoVal } : editing?.fuel_odometer != null ? { fuel_odometer: null } : {}),
        }
      : hadFuel
        ? { fuel_km: null, fuel_liters: null, fuel_price_per_liter: null, fuel_type: null, ...(editing?.fuel_odometer != null ? { fuel_odometer: null } : {}) }
        : {}

    const fundId = form.fund_id || null
    const fundToId = form.type === 'transfer' ? (form.fund_to_id || null) : null

    // Nuovo movimento: insert + saldo atomici via post_transaction (fallback al percorso storico).
    if (!editing) {
      const { error } = await postTransaction(user!.id, {
        type: form.type, amount: form.amount, description: form.description,
        fund_id: fundId, fund_to_id: fundToId, category: form.category, date: form.date,
        ...fuelFields,
      })
      setSaving(false)
      if (error) {
        if (isFuelColumnError(error)) toast.error('Colonne benzina mancanti nel database: esegui la SQL indicata nel banner della Dashboard')
        else toast.error('Errore nel salvataggio')
        return
      }
      toast.success('Transazione registrata')
      setShowModal(false)
      setEditing(null)
      setForm(emptyForm)
      load()
      return
    }

    // Modifica: serve stornare il vecchio saldo e applicare il nuovo → percorso invariato.
    const deltas = new Map<string, number>()
    for (const { fundId: fId, delta } of txBalanceDelta(editing)) {
      deltas.set(fId, (deltas.get(fId) || 0) - delta)
    }
    const newTx: Transaction = {
      ...editing,
      type: form.type, amount: form.amount, description: form.description,
      fund_id: fundId, fund_to_id: fundToId, category: form.category, date: form.date,
    }
    for (const { fundId: fId, delta } of txBalanceDelta(newTx)) {
      deltas.set(fId, (deltas.get(fId) || 0) + delta)
    }

    const payload = {
      type: form.type, amount: form.amount, description: form.description,
      fund_id: fundId, fund_to_id: fundToId, category: form.category, date: form.date,
      ...fuelFields,
    }
    const { error } = await supabase.from('transactions').update(payload).eq('id', editing.id)
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
    toast.success('Transazione aggiornata')
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
    // Memo e pianificate non muovono i fondi: non vanno conteggiate nel totale "saldi ripristinati".
    const total = selected.reduce((s, tx) => s + (tx.is_memo || tx.is_planned ? 0 : Number(tx.amount)), 0)
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

  // Medie del nuovo modello a contachilometri: €/km reale (accurato) + km/l per carburante (stima).
  const lifetimeOdo = useMemo(() => ({
    costPerKm: lifetimeCostPerKmOdometer(fuelFills),
    benzina: lifetimePerFuelStima(fuelFills, 'benzina'),
    gpl: lifetimePerFuelStima(fuelFills, 'gpl'),
  }), [fuelFills])

  // Memoizzato: senza, la lista verrebbe ri-filtrata su TUTTI gli item caricati a ogni render
  // (selezione di righe, digitazione nel modale, ecc.). Si ricalcola solo al cambio di filtri/dati.
  const filtered = useMemo(() => items.filter(tx => {
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
  }), [items, includePlanned, includeMemo, filterType, filterFund, filterSource, filterText])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const filtersActive = filterType !== 'all' || filterFund !== 'all' || filterSource !== 'all' || filterText !== '' || dateFrom !== '' || dateTo !== '' || includePlanned || includeMemo
  const resetFilters = () => {
    setFilterType('all'); setFilterFund('all'); setFilterSource('all'); setFilterText('')
    setDateFrom(''); setDateTo(''); setIncludePlanned(false); setIncludeMemo(false)
  }

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
    // Seleziona SOLO i duplicati attualmente visibili in lista: così non si selezionano (e poi
    // eliminano) pianificate/voci nascoste da un filtro che l'utente non sta vedendo.
    const visible = new Set(filteredVisibleIds)
    const toSelect = [...duplicateGroups].filter(id => visible.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      toSelect.forEach(id => next.add(id))
      return next
    })
    if (toSelect.length === 0) toast.error('Nessun duplicato visibile trovato')
    else toast.success(`${toSelect.length} duplicat${toSelect.length === 1 ? 'o' : 'i'} selezionat${toSelect.length === 1 ? 'o' : 'i'}`)
  }

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'income') return <ArrowDownLeft className="w-5 h-5" />
    if (type === 'expense') return <ArrowUpRight className="w-5 h-5" />
    return <ArrowLeftRight className="w-5 h-5" />
  }

  return (
    <div>
      <InfoBox title="Cosa vedi qui" tone="blue">
        <p>Tutte le transazioni effettive che hanno modificato (o modificheranno) i tuoi fondi. Ogni riga ha badge che indicano da dove proviene:</p>
        <ul className="list-disc ml-4 space-y-0.5">
          <li><strong>entrata ric.</strong> / <strong>spesa ric.</strong>: generata confermando una voce ricorrente o da addebito automatico</li>
          <li><strong>budget</strong>: spesa inserita dentro un budget settimanale</li>
          <li><strong>memo</strong>: "solo pagato" o "non lavorato" — non muove i fondi</li>
          <li><strong>pianif.</strong>: futura/pianificata, non ancora avvenuta — non influisce sul saldo</li>
        </ul>
        <p>Le pianificate e i memo sono <strong>nascoste di default</strong>. Spunta le checkbox in alto per vederle.</p>
        <p>Modifica/elimina: i saldi dei fondi vengono ripristinati automaticamente. Il pulsante "Seleziona duplicati" identifica e seleziona transazioni identiche per eliminarle in blocco.</p>
      </InfoBox>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Transazioni</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} di {items.length} transazion{items.length === 1 ? 'e' : 'i'}
            {duplicateGroups.size > 0 && (
              <span className="ml-2 text-amber-600 font-medium">· {duplicateGroups.size} possibili duplicat{duplicateGroups.size === 1 ? 'o' : 'i'}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 w-full sm:w-auto">
          {duplicateGroups.size > 0 && (
            <button onClick={selectDuplicates} className="inline-flex items-center gap-2 px-3 min-h-[40px] bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-[transform,background-color] active:scale-[0.98] text-sm font-medium">
              Seleziona duplicati
            </button>
          )}
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 min-h-[40px] bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-[transform,background-color] active:scale-[0.98] text-[13px] font-medium">
            <Plus className="w-4 h-4" aria-hidden="true" /> Nuova
          </button>
        </div>
      </div>

      <button
        onClick={() => setShowFilters(s => !s)}
        aria-expanded={showFilters}
        aria-controls="tx-filters-panel"
        className="sm:hidden inline-flex items-center gap-2 mb-3 px-3 min-h-[40px] border border-slate-200 rounded-lg text-sm text-slate-600 font-medium transition-[transform,background-color] active:scale-[0.98]"
      >
        <Filter className="w-4 h-4" aria-hidden="true" /> Filtri
        {filtersActive && <span className="w-2 h-2 rounded-full bg-blue-500" aria-label="filtri attivi" />}
      </button>
      <div id="tx-filters-panel" className={`${showFilters ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row flex-wrap gap-3 mb-6 sm:items-center bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4`}>
        <Filter className="w-4 h-4 text-slate-400 hidden sm:block" aria-hidden="true" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full sm:w-auto min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutti i tipi</option>
          <option value="income">Entrate</option>
          <option value="expense">Uscite</option>
          <option value="transfer">Trasferimenti</option>
        </select>
        <select value={filterFund} onChange={e => setFilterFund(e.target.value)} className="w-full sm:w-auto min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutti i fondi</option>
          {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="w-full sm:w-auto min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          <option value="all">Tutte le origini</option>
          <option value="recurring_income">Entrate ricorrenti</option>
          <option value="recurring_expense">Spese ricorrenti</option>
          <option value="budget">Da budget settimanali</option>
          <option value="manual">Solo manuali</option>
        </select>
        <div className="relative w-full sm:w-auto">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Cerca..." className="w-full sm:w-auto min-w-0 pl-8 pr-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex flex-1 sm:flex-none items-center gap-1.5 text-xs text-slate-500">Da
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full sm:w-auto min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
          </label>
          <label className="flex flex-1 sm:flex-none items-center gap-1.5 text-xs text-slate-500">A
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full sm:w-auto min-w-0 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 min-h-[40px] text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includePlanned} onChange={e => setIncludePlanned(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
            Pianificate
          </label>
          <label className="flex items-center gap-1.5 min-h-[40px] text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includeMemo} onChange={e => setIncludeMemo(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
            Memo
          </label>
          {filtersActive && (
            <button onClick={resetFilters} className="inline-flex items-center gap-1 px-2 min-h-[40px] text-xs font-medium text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-[transform,background-color] active:scale-[0.98]">
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Azzera
            </button>
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-2 sm:top-4 z-20 mb-3 bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="text-sm font-medium text-blue-700 truncate">{selectedIds.size} selezionat{selectedIds.size === 1 ? 'a' : 'e'}</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center justify-center gap-1 min-h-[40px] px-2 shrink-0 transition-colors">
              <X className="w-3 h-3" aria-hidden="true" /> Deseleziona
            </button>
          </div>
          <button
            onClick={bulkDelete}
            disabled={bulkDeleting}
            className="flex items-center justify-center gap-2 px-3 min-h-[40px] shrink-0 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-[transform,background-color] active:scale-[0.98] text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" /> {bulkDeleting ? 'Eliminazione...' : 'Elimina'}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200/70 shadow-sm">
          <p className="text-slate-400">Nessuna transazione trovata</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-4 py-1 mb-2 flex items-center gap-3">
            <button onClick={toggleSelectAll} className="inline-flex items-center gap-2 min-h-[40px] text-sm text-slate-600 hover:text-slate-800 transition-colors">
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
              const hasOdo = tx.fuel_odometer != null
              const fuelParts: string[] = []
              if (isFuelTx && (tx.fuel_km != null || tx.fuel_liters != null || hasOdo)) fuelParts.push(FUEL_TYPE_LABEL[txFuelType])
              if (hasOdo) fuelParts.push(`${Number(tx.fuel_odometer).toLocaleString('it-IT')} km`)
              else if (tx.fuel_km != null) fuelParts.push(`${Number(tx.fuel_km).toLocaleString('it-IT')} km`)
              if (tx.fuel_liters != null) fuelParts.push(`${Number(tx.fuel_liters).toLocaleString('it-IT')} L`)
              if (tx.fuel_price_per_liter != null) fuelParts.push(isAmountsHidden() ? '••••• €/L' : `${Number(tx.fuel_price_per_liter).toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/L`)
              const fuelLine = fuelParts.join(' · ')
              // Nuovo modello a contachilometri (€/km reale + km/l stima); fallback al vecchio sui dati storici.
              const odoStats = isFuelTx && hasOdo ? fuelStatsOdometer(tx, fuelFills) : null
              const oldPrev = isFuelTx && !hasOdo && tx.fuel_km != null ? previousFuelFill(tx, fuelFills) : null
              const cons = oldPrev && oldPrev.fuel_liters != null
                ? fuelConsumption(Number(tx.fuel_km), Number(oldPrev.fuel_liters), Number(oldPrev.amount))
                : null
              const avg = isFuelTx && !hasOdo && tx.fuel_km != null ? avgByType[txFuelType] : null
              return (
                <div
                  key={tx.id}
                  className={`bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 flex items-center justify-between transition-colors ${isSelected ? 'border-blue-500 bg-blue-50/30' : isDuplicate ? 'border-amber-300' : 'hover:border-slate-300'}`}
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    <button onClick={() => toggleSelect(tx.id)} aria-label={isSelected ? 'Deseleziona transazione' : 'Seleziona transazione'} aria-pressed={isSelected} className="inline-flex items-center justify-center w-10 h-10 -m-1 shrink-0">
                      {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-slate-300 hover:text-slate-500" />}
                    </button>
                    <div className={`hidden sm:flex w-10 h-10 rounded-xl items-center justify-center shrink-0 ${tx.type === 'income' ? 'bg-emerald-100 text-emerald-600' : tx.type === 'expense' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                      <TypeIcon type={tx.type} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-800 text-sm truncate">{tx.description || (tx.type === 'income' ? 'Entrata' : tx.type === 'expense' ? 'Uscita' : 'Trasferimento')}</p>
                        {isDuplicate && <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-medium uppercase">duplicato</span>}
                        {tx.is_planned && <span className="text-[11px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-md font-medium uppercase">pianif.</span>}
                        {tx.is_memo && <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-medium uppercase">memo</span>}
                        {tx.recurring_expense_id && <span className="text-[11px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium uppercase">spesa ric.</span>}
                        {tx.recurring_income_id && <span className="text-[11px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium uppercase">entrata ric.</span>}
                        {tx.budget_id && <span className="text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md font-medium uppercase">budget</span>}
                      </div>
                      <p className="text-xs text-slate-500">
                        {fmtDate(tx.date)}
                        {tx.planned_date && tx.planned_date !== tx.date && ` · previsto ${fmtDate(tx.planned_date, 'd MMM')}`}
                        {fundName && ` · ${fundName}`}
                        {fundToName && ` → ${fundToName}`}
                        {tx.category !== 'altro' && ` · ${catLabel(tx.category)}`}
                      </p>
                      {fuelLine && <p className="text-[11px] text-slate-500 mt-0.5">{fuelLine}</p>}
                      {odoStats && (odoStats.costPerKm != null || odoStats.kmPerLiter != null) && (
                        <p className="text-[11px] text-emerald-600/90">
                          {odoStats.costPerKm != null && `${cur(odoStats.costPerKm)}/km reale`}
                          {odoStats.costPerKm != null && odoStats.kmPerLiter != null && ' · '}
                          {odoStats.kmPerLiter != null && `${FUEL_TYPE_LABEL[txFuelType]} ~${odoStats.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l (stima)`}
                        </p>
                      )}
                      {cons && (
                        <p className="text-[11px] text-emerald-600/90">
                          Pieno prec.: {cons.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l · {cons.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                          {cons.costPerKm != null && ` · ${cur(cons.costPerKm)}/km`}
                        </p>
                      )}
                      {avg && (
                        <p className="text-[11px] text-slate-500">
                          Media {FUEL_TYPE_LABEL[txFuelType]}: {avg.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l · {avg.litersPer100Km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} l/100km
                          {avg.costPerKm != null && ` · ${cur(avg.costPerKm)}/km`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <span className={`text-sm sm:text-lg font-semibold tracking-tight tabular-nums whitespace-nowrap ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-red-500' : 'text-blue-600'}`}>
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{cur(Number(tx.amount))}
                    </span>
                    <button onClick={() => openEdit(tx)} aria-label="Modifica transazione" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-[transform,background-color,color] active:scale-90">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(tx)} aria-label="Elimina transazione" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-[transform,background-color,color] active:scale-90">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {hasMore && (
            <button onClick={() => load(false)} className="w-full mt-4 py-2.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-[transform,background-color] active:scale-[0.98]">
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
            <div role="group" aria-label="Tipo di transazione" className="grid grid-cols-3 gap-2">
              {(['expense', 'income', 'transfer'] as const).map(t => (
                <button key={t} onClick={() => setForm({ ...form, type: t })} aria-pressed={form.type === t} className={`min-h-[44px] px-1 rounded-lg text-xs sm:text-sm font-medium border transition-[transform,background-color,border-color,color] active:scale-[0.98] ${form.type === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {t === 'expense' ? 'Uscita' : t === 'income' ? 'Entrata' : 'Trasferimento'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="tx-desc" className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input id="tx-desc" type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Spesa supermercato..." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="tx-amount" className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput id="tx-amount" value={form.amount} onChange={n => setForm({ ...form, amount: n })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div className="min-w-0">
              <label htmlFor="tx-date" className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input id="tx-date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label htmlFor="tx-fund" className="block text-sm font-medium text-slate-700 mb-1">{form.type === 'transfer' ? 'Da fondo' : 'Fondo'}</label>
            <select id="tx-fund" value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          {form.type === 'transfer' && (
            <div>
              <label htmlFor="tx-fund-to" className="block text-sm font-medium text-slate-700 mb-1">A fondo</label>
              <select id="tx-fund-to" value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                <option value="">Seleziona</option>
                {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="tx-category" className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
            <CategorySelect id="tx-category" value={form.category} onChange={c => setForm({ ...form, category: c })} baseCategories={TRANSACTION_CATEGORIES} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow capitalize" />
          </div>
          {form.type === 'expense' && form.category === FUEL_CATEGORY && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Dati rifornimento (facoltativi)</p>
              <div>
                <label id="tx-fuel-type-label" className="block text-xs font-medium text-slate-600 mb-1">Tipo carburante</label>
                <div role="group" aria-labelledby="tx-fuel-type-label" className="grid grid-cols-2 gap-2">
                  {(['gpl', 'benzina'] as const).map(ft => (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => setForm({ ...form, fuel_type: ft })}
                      aria-pressed={form.fuel_type === ft}
                      className={`min-h-[44px] rounded-lg text-sm font-medium border transition-[transform,background-color,border-color,color] active:scale-[0.98] ${form.fuel_type === ft ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {FUEL_TYPE_LABEL[ft]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="tx-fuel-odo" className="block text-xs font-medium text-slate-600 mb-1">Contachilometri (km totali)</label>
                <input
                  id="tx-fuel-odo"
                  type="text" inputMode="decimal"
                  value={form.fuel_odometer}
                  onChange={e => setForm({ ...form, fuel_odometer: e.target.value })}
                  placeholder="es. 124500"
                  className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-base sm:text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="tx-fuel-liters" className="block text-xs font-medium text-slate-600 mb-1">Litri</label>
                  <input
                    id="tx-fuel-liters"
                    type="text" inputMode="decimal"
                    value={form.fuel_liters}
                    onChange={e => setForm({ ...form, fuel_liters: e.target.value })}
                    placeholder="es. 30"
                    className="w-full min-w-0 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-base sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="tx-fuel-ppl" className="block text-xs font-medium text-slate-600 mb-1">€/litro</label>
                  <input
                    id="tx-fuel-ppl"
                    type="text" inputMode="decimal"
                    value={form.fuel_price_per_liter}
                    onChange={e => setForm({ ...form, fuel_price_per_liter: e.target.value })}
                    placeholder="es. 1,80"
                    className="w-full min-w-0 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow text-base sm:text-sm"
                  />
                </div>
              </div>
              {(() => {
                const odo = parseDecimal(form.fuel_odometer)
                const ref = { id: editing?.id ?? '', date: form.date, created_at: editing?.created_at ?? new Date().toISOString(), fuel_type: form.fuel_type, fuel_odometer: odo > 0 ? odo : null }
                const stats = odo > 0 ? fuelStatsOdometer(ref, fuelFills) : null
                const stima = lifetimeOdo[form.fuel_type]
                return (
                  <div className="space-y-1">
                    {odo > 0 && (
                      stats && (stats.costPerKm != null || stats.kmPerLiter != null) ? (
                        <p className="text-xs text-slate-600">
                          {stats.costPerKm != null && <><span className="font-semibold text-slate-800">{cur(stats.costPerKm)}/km</span> reale</>}
                          {stats.costPerKm != null && stats.kmPerLiter != null && ' · '}
                          {stats.kmPerLiter != null && <>{FUEL_TYPE_LABEL[form.fuel_type]} <span className="font-semibold text-slate-800">~{stats.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span> (stima)</>}
                        </p>
                      ) : (
                        <p className="text-[11px] text-amber-600">Serve almeno un rifornimento precedente col contachilometri per calcolare €/km e la stima.</p>
                      )
                    )}
                    {(lifetimeOdo.costPerKm != null || stima) && (
                      <p className="text-xs text-slate-600">
                        Media:
                        {lifetimeOdo.costPerKm != null && <> <span className="font-semibold text-slate-800">{cur(lifetimeOdo.costPerKm)}/km</span> reale</>}
                        {lifetimeOdo.costPerKm != null && stima && ' ·'}
                        {stima && <> {FUEL_TYPE_LABEL[form.fuel_type]} <span className="font-semibold text-slate-800">~{stima.kmPerLiter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/l</span> (stima)</>}
                      </p>
                    )}
                  </div>
                )
              })()}
              <p className="text-[11px] text-slate-500">Inserisci la lettura del <strong>contachilometri</strong> (km totali dell'auto). Per le auto bifuel il <strong>€/km è reale</strong>; il <strong>km/l per carburante è una stima</strong> (i km includono l'altro carburante). Dati solo per i consumi: non modificano l'importo.</p>
            </div>
          )}
          <button onClick={save} disabled={form.amount <= 0 || saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-[transform,background-color] active:scale-[0.98]">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Registra Transazione'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
