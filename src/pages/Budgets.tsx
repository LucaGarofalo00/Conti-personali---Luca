import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ShoppingBag, Receipt, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { startOfWeek, addDays, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import { cur, todayString, getBillingPeriod, currentPeriodLabel } from '../lib/utils'
import { incrementFundBalance } from '../lib/fundBalances'
import { logSupabaseError } from '../lib/logError'
import { getPeriodBreakdown, totalsFromBreakdown } from '../lib/periodBreakdown'
import { computeBudgetRollover } from '../lib/budgetRollover'
import InfoBox from '../components/InfoBox'
import type { WeeklyBudget, Fund, Transaction } from '../types'

export default function Budgets() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
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
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set())

  const toggleWeek = (key: string) => setOpenWeeks(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })


  const load = async () => {
    try {
      const [{ data: b, error: e1 }, { data: f, error: e2 }, { data: btx, error: e3 }] = await Promise.all([
        supabase.from('weekly_budgets').select('*').order('created_at'),
        supabase.from('funds').select('*').order('sort_order'),
        supabase.from('transactions').select('*').not('budget_id', 'is', null),
      ])
      const firstError = e1 || e2 || e3
      if (firstError) {
        logSupabaseError('Errore Supabase:', firstError)
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
      await incrementFundBalance(fundId, -expForm.amount)
    }

    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio: ' + error.message); return }
    toast.success('Spesa registrata')
    setExpBudgetId(null)
    load()
  }

  const removeBudget = async (id: string) => {
    if (!(await confirm({ message: 'Eliminare il budget? Le transazioni collegate restano ma perdono il link al budget.', confirmText: 'Elimina', danger: true }))) return
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
    if (!(await confirm({ message: 'Eliminare questa spesa? Il saldo del fondo verrà ripristinato.', confirmText: 'Elimina', danger: true }))) return
    const { error } = await supabase.from('transactions').delete().eq('id', tx.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    if (tx.fund_id) {
      await incrementFundBalance(tx.fund_id, Number(tx.amount))
    }
    toast.success('Spesa eliminata')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const { start: pStart, end: pEnd } = getBillingPeriod()
  const budgetBreakdown = getPeriodBreakdown({
    startDate: new Date(pStart),
    endDate: new Date(pEnd),
    recurringExpenses: [],
    recurringIncome: [],
    weeklyBudgets: budgets.filter(b => b.is_active),
    planned: [],
    excludedFundIds: [],
    fromToday: false,
  })
  const totalMonthlyAll = totalsFromBreakdown(budgetBreakdown).expenses

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-slate-500">Totale budget del periodo corrente ({currentPeriodLabel()}): <span className="font-semibold text-red-500">{cur(totalMonthlyAll)}</span></p>
      </div>
      <InfoBox title="Come funzionano i budget settimanali" tone="blue">
        <p>Un <strong>budget settimanale</strong> è un limite di spesa per la settimana corrente (es. sfizi 50€, mangiare fuori 80€).</p>
        <p><strong>Reset settimanale</strong>: ogni <strong>lunedì 00:00</strong> il contatore riparte da zero, sempre dal valore <strong>base</strong>. L'avanzo della settimana precedente <strong>NON si accumula</strong> e <strong>NON viene conteggiato come entrata</strong>: i soldi non spesi restano semplicemente nel saldo del fondo.</p>
        <p><strong>Sforamento</strong>: se spendi più del budget, la barra diventa rossa e compare un alert, MA le spese sono comunque registrate normalmente nel fondo. Il "debito" <strong>NON si scala</strong> dalla settimana successiva.</p>
        <p><strong>Nei totali e nelle previsioni</strong>: per le settimane <strong>già iniziate</strong> il budget conta per quanto hai <strong>speso davvero</strong>; per le settimane <strong>future</strong> conta il valore base come stima.</p>
        <p>Lo storico "Settimane passate" qui sotto mostra avanzo/sforo di ogni settimana solo a titolo informativo.</p>
        <p>Per spese fisse mensili (affitto, abbonamenti, ecc.) usa la sezione <strong>Spese Ricorrenti</strong>.</p>
      </InfoBox>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-700">Budget Settimanali</h3>
          </div>
          <button onClick={() => { setEditingBudget(null); setBudgetForm({ name: '', amount: 0, fund_id: '' }); setShowBudgetModal(true) }} className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-[13px] font-medium">
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
              const rollInfo = computeBudgetRollover(b, budgetTx)
              const limit = Number(b.amount)
              const txsThisWeekObjs = budgetTx.filter(t => t.budget_id === b.id && new Date(t.date) >= startOfWeek(new Date(), { weekStartsOn: 1 }))
              const effective = rollInfo.effectiveBudget
              const spentThisWeek = rollInfo.spentThisWeek
              const remaining = rollInfo.remaining
              const overBudget = rollInfo.overBudget
              const pct = effective > 0 ? Math.min((spentThisWeek / effective) * 100, 100) : 0
              const fundName = funds.find(f => f.id === b.fund_id)?.name

              return (
                <div key={b.id} className={`bg-white rounded-xl border shadow-sm ${overBudget ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200/60'} p-5 ${!b.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleBudget(b)} aria-label={b.is_active ? 'Disattiva budget' : 'Attiva budget'}>{b.is_active ? <ToggleRight className="w-6 h-6 text-blue-600" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}</button>
                      <div>
                        <p className="font-semibold text-slate-800">{b.name}</p>
                        <p className="text-xs text-slate-400">{cur(limit)}/settimana{fundName ? ` · ${fundName}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditingBudget(b); setBudgetForm({ name: b.name, amount: limit, fund_id: b.fund_id || '' }); setShowBudgetModal(true) }} aria-label="Modifica budget" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => removeBudget(b.id)} aria-label="Elimina budget" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-slate-500">Speso questa settimana: <span className="font-medium text-slate-700">{cur(spentThisWeek)}</span> / {cur(effective)}</span>
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
                        <span>Hai superato il budget. Le spese vengono registrate comunque. Il "debito" NON si scala dal budget della prossima settimana.</span>
                      </div>
                    )}
                  </div>

                  {txsThisWeekObjs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Spese questa settimana</p>
                      {txsThisWeekObjs.map(tx => (
                        <div key={tx.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Receipt className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-slate-600 truncate">{tx.description}</span>
                            <span className="text-xs text-slate-400 shrink-0">{format(new Date(tx.date), 'dd MMM', { locale: it })}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-medium text-red-500">-{cur(Number(tx.amount))}</span>
                            <button onClick={() => removeTx(tx)} aria-label="Elimina spesa" className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {b.is_active && (
                    <button
                      onClick={() => { setExpBudgetId({ id: b.id, name: b.name }); setExpForm({ description: '', amount: 0, fund_id: b.fund_id || '', date: todayString() }) }}
                      className="mt-3 w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-sm font-medium text-slate-500 transition flex items-center justify-center gap-2 hover:border-blue-300 hover:text-blue-600"
                    >
                      <Plus className="w-4 h-4" /> Aggiungi spesa
                    </button>
                  )}

                  {rollInfo.pastWeeks.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Settimane passate</p>
                      <div className="space-y-1.5">
                        {[...rollInfo.pastWeeks].reverse().map(week => {
                          const key = `${b.id}|${week.weekStart.toISOString()}`
                          const open = openWeeks.has(key)
                          const range = `${format(week.weekStart, 'd')}–${format(addDays(week.weekStart, 6), 'd MMM', { locale: it })}`
                          return (
                            <div key={key} className="rounded-lg border border-slate-100">
                              <button onClick={() => toggleWeek(key)} aria-expanded={open} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50 rounded-lg">
                                <span className="flex items-center gap-2 min-w-0">
                                  {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                  <span className="text-sm text-slate-600">{range}</span>
                                  <span className="text-xs text-slate-400 tabular-nums">{cur(week.spent)} / {cur(limit)}</span>
                                </span>
                                {week.over > 0 ? (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">Sforato {cur(week.over)}</span>
                                ) : (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">{week.surplus > 0 ? `Avanzo ${cur(week.surplus)}` : 'In pari'}</span>
                                )}
                              </button>
                              {open && (
                                <div className="px-3 pb-2.5 pt-1.5 border-t border-slate-100 space-y-1.5">
                                  {week.txs.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic">Nessuna spesa in questa settimana</p>
                                  ) : (
                                    week.txs.map(tx => (
                                      <div key={tx.id} className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 min-w-0">
                                          <Receipt className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                          <span className="text-slate-600 truncate">{tx.description}</span>
                                          <span className="text-xs text-slate-400 shrink-0">{format(new Date(tx.date), 'dd MMM', { locale: it })}</span>
                                        </span>
                                        <span className="font-medium text-red-500 shrink-0">-{cur(Number(tx.amount))}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
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
            <input type="text" value={budgetForm.name} onChange={e => setBudgetForm({ ...budgetForm, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Sfizi, Mangiare fuori..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Budget settimanale (€)</label>
            <DecimalInput value={budgetForm.amount} onChange={n => setBudgetForm({ ...budgetForm, amount: n })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo predefinito (opzionale)</label>
            <select value={budgetForm.fund_id} onChange={e => setBudgetForm({ ...budgetForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Scegli al momento della spesa</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={saveBudget} disabled={saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : editingBudget ? 'Salva' : 'Aggiungi'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!expBudgetId} onClose={() => setExpBudgetId(null)} title={expBudgetId ? `Spesa per "${expBudgetId.name}"` : ''}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input type="text" value={expForm.description} onChange={e => setExpForm({ ...expForm, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Pizza, Gelato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput value={expForm.amount} onChange={n => setExpForm({ ...expForm, amount: n })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Paga con</label>
            <select value={expForm.fund_id} onChange={e => setExpForm({ ...expForm, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <button onClick={saveExpense} disabled={saving || expForm.amount <= 0 || !expForm.description.trim()} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Registrazione...' : 'Registra Spesa'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
