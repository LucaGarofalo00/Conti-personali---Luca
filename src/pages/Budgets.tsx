import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ShoppingBag, Receipt, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { addDays, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import { cur, todayString, getBillingPeriod, currentPeriodLabel, parseLocalDate, fmtDate } from '../lib/utils'
import { incrementFundBalance } from '../lib/fundBalances'
import { postTransaction } from '../lib/postTransaction'
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
  const [editingExp, setEditingExp] = useState<Transaction | null>(null)
  const [editExpForm, setEditExpForm] = useState({ description: '', amount: 0, fund_id: '', date: '' })
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

    // Insert + saldo atomici via post_transaction (con fallback al percorso storico).
    const { error } = await postTransaction(user!.id, {
      type: 'expense',
      amount: expForm.amount,
      description: expForm.description,
      fund_id: expForm.fund_id || null,
      fund_to_id: null,
      category: 'budget',
      budget_id: expBudgetId.id,
      date: expForm.date || todayString(),
    })

    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio: ' + error); return }
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

  const openEditExp = (tx: Transaction) => {
    setEditingExp(tx)
    setEditExpForm({ description: tx.description, amount: Number(tx.amount), fund_id: tx.fund_id || '', date: tx.date })
  }

  const saveEditExp = async () => {
    if (!editingExp) return
    if (!editExpForm.description.trim()) { toast.error('Inserisci una descrizione'); return }
    if (editExpForm.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    const newFund = editExpForm.fund_id || null
    const { error } = await supabase.from('transactions').update({
      description: editExpForm.description,
      amount: editExpForm.amount,
      fund_id: newFund,
      date: editExpForm.date || todayString(),
    }).eq('id', editingExp.id)
    if (error) { setSaving(false); toast.error('Errore: ' + error.message); return }
    // Riconcilia i saldi: storna il vecchio addebito e applica il nuovo (le spese di budget sono
    // sempre uscite). Gestisce anche il cambio di fondo. Cambiare la data può spostare la spesa
    // in un'altra settimana: il rollover la ri-colloca automaticamente.
    if (editingExp.fund_id) await incrementFundBalance(editingExp.fund_id, Number(editingExp.amount))
    if (newFund) await incrementFundBalance(newFund, -editExpForm.amount)
    setSaving(false)
    toast.success('Spesa aggiornata')
    setEditingExp(null)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const { start: pStart, end: pEnd } = getBillingPeriod()
  const budgetBreakdown = getPeriodBreakdown({
    startDate: parseLocalDate(pStart),
    endDate: parseLocalDate(pEnd),
    recurringExpenses: [],
    recurringIncome: [],
    weeklyBudgets: budgets.filter(b => b.is_active),
    planned: [],
    excludedFundIds: [],
    fromToday: false,
    // Riconcilia col reale: settimane concluse → speso effettivo; settimana in corso → max(quota,
    // speso) così uno sforamento si riflette subito nel totale, coerentemente con le card per-budget
    // sotto (che mostrano già lo sforamento). Settimane future → quota.
    actualTx: budgetTx,
    reconcileBudgets: true,
  })
  const totalMonthlyAll = totalsFromBreakdown(budgetBreakdown).expenses

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 shadow-sm p-4 sm:p-5">
        <p className="text-sm font-medium text-red-600/80">Totale budget del periodo ({currentPeriodLabel()})</p>
        <p className="mt-1 text-2xl font-bold text-red-700 tracking-tight tabular-nums whitespace-nowrap">{cur(totalMonthlyAll)}</p>
      </div>
      <InfoBox title="Come funzionano i budget settimanali" tone="blue">
        <p>Un <strong>budget settimanale</strong> è un limite di spesa per la settimana corrente (es. sfizi 50€, mangiare fuori 80€).</p>
        <p><strong>Reset settimanale</strong>: ogni <strong>lunedì 00:00</strong> il contatore riparte da zero, sempre dal valore <strong>base</strong>. L'avanzo della settimana precedente <strong>NON si accumula</strong> e <strong>NON viene conteggiato come entrata</strong>: i soldi non spesi restano semplicemente nel saldo del fondo.</p>
        <p><strong>Sforamento</strong>: se spendi più del budget, la barra diventa rossa e compare un alert, MA le spese sono comunque registrate normalmente nel fondo. Il "debito" <strong>NON si scala</strong> dalla settimana successiva.</p>
        <p><strong>Nei totali</strong>: per le settimane <strong>concluse</strong> conta quanto hai <strong>speso davvero</strong>; per la settimana <strong>in corso</strong> il <strong>maggiore tra quota e speso</strong> (uno sforamento si vede subito, sotto la quota resta la stima); per le settimane <strong>future</strong>, il valore base come stima. Nelle <strong>previsioni</strong> di saldo lo speso reale è già scontato dal saldo dei fondi.</p>
        <p>Lo storico "Settimane passate" qui sotto mostra avanzo/sforo di ogni settimana solo a titolo informativo.</p>
        <p>Per spese fisse mensili (affitto, abbonamenti, ecc.) usa la sezione <strong>Spese Ricorrenti</strong>.</p>
      </InfoBox>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 shrink-0" aria-hidden="true">
              <ShoppingBag className="w-5 h-5" />
            </span>
            <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Budget Settimanali</h3>
          </div>
          <button onClick={() => { setEditingBudget(null); setBudgetForm({ name: '', amount: 0, fund_id: '' }); setShowBudgetModal(true) }} className="flex items-center justify-center gap-2 px-3 min-h-[40px] sm:min-h-0 sm:py-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-[transform,background-color] active:scale-[0.98] text-[13px] font-medium shrink-0">
            <Plus className="w-4 h-4" aria-hidden="true" /> Nuovo Budget
          </button>
        </div>

        {budgets.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-slate-200/70 shadow-sm">
            <p className="text-slate-500 text-base font-medium">Nessun budget settimanale configurato</p>
          </div>
        ) : (
          <div className="space-y-5">
            {budgets.map(b => {
              const rollInfo = computeBudgetRollover(b, budgetTx)
              const limit = Number(b.amount)
              // Riusa le tx della settimana già filtrate dal rollover (niente memo, niente date
              // future), invece di ricalcolare un filtro divergente qui.
              const txsThisWeekObjs = rollInfo.txsThisWeek
              const effective = rollInfo.effectiveBudget
              const spentThisWeek = rollInfo.spentThisWeek
              const remaining = rollInfo.remaining
              const overBudget = rollInfo.overBudget
              const pct = effective > 0 ? Math.min((spentThisWeek / effective) * 100, 100) : 0
              const fundName = funds.find(f => f.id === b.fund_id)?.name

              return (
                <div key={b.id} className={`bg-white rounded-2xl border shadow-sm transition-shadow ${overBudget ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200/70'} p-4 sm:p-5 ${!b.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <button onClick={() => toggleBudget(b)} aria-label={b.is_active ? 'Disattiva budget' : 'Attiva budget'} aria-pressed={b.is_active} className="inline-flex items-center justify-center w-10 h-10 shrink-0 transition-transform active:scale-90">{b.is_active ? <ToggleRight className="w-6 h-6 text-blue-600" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}</button>
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 shrink-0" aria-hidden="true">
                        <ShoppingBag className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-slate-900 tracking-tight truncate">{b.name}</p>
                        <p className="text-xs text-slate-500 truncate">{cur(limit)}/settimana{fundName ? ` · ${fundName}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditingBudget(b); setBudgetForm({ name: b.name, amount: limit, fund_id: b.fund_id || '' }); setShowBudgetModal(true) }} aria-label="Modifica budget" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 text-slate-400 transition-[transform,background-color] active:scale-90"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => removeBudget(b.id)} aria-label="Elimina budget" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-[transform,background-color] active:scale-90"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1 sm:gap-3 mb-2">
                      <span className="text-sm text-slate-500 min-w-0">Speso questa settimana: <span className="block text-xl font-bold text-slate-900 tracking-tight tabular-nums whitespace-nowrap">{cur(spentThisWeek)}</span> <span className="text-xs text-slate-400">/ {cur(effective)}</span></span>
                      <span className={`text-base sm:text-xl font-bold tracking-tight tabular-nums sm:text-right shrink-0 ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                        {overBudget ? `Sforato di ${cur(Math.abs(remaining))}` : `Rimangono ${cur(remaining)}`}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`Budget ${b.name}: ${Math.round(pct)}% utilizzato`}>
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ease-out ${overBudget ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    {overBudget && (
                      <div role="status" className="mt-2 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Hai superato il budget. Le spese vengono registrate comunque. Il "debito" NON si scala dal budget della prossima settimana.</span>
                      </div>
                    )}
                  </div>

                  {txsThisWeekObjs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Spese questa settimana</p>
                      {txsThisWeekObjs.map(tx => (
                        <div key={tx.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-red-100 text-red-600 shrink-0" aria-hidden="true">
                              <Receipt className="w-4 h-4" />
                            </span>
                            <span className="text-slate-600 truncate">{tx.description}</span>
                            <span className="text-xs text-slate-500 shrink-0">{fmtDate(tx.date, 'd MMM')}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="font-medium text-red-500 tracking-tight tabular-nums shrink-0 whitespace-nowrap">-{cur(Number(tx.amount))}</span>
                            <button onClick={() => openEditExp(tx)} aria-label="Modifica spesa" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-[transform,background-color] active:scale-90"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => removeTx(tx)} aria-label="Elimina spesa" className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-[transform,background-color] active:scale-90"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {b.is_active && (
                    <button
                      onClick={() => { setExpBudgetId({ id: b.id, name: b.name }); setExpForm({ description: '', amount: 0, fund_id: b.fund_id || '', date: todayString() }) }}
                      className="mt-3 w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-sm font-medium text-slate-500 transition-[transform,background-color,border-color,color] active:scale-[0.98] flex items-center justify-center gap-2 hover:border-blue-300 hover:text-blue-600"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" /> Aggiungi spesa
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
                              <button onClick={() => toggleWeek(key)} aria-expanded={open} className="w-full flex items-center justify-between gap-2 px-3 min-h-[40px] py-2 text-left hover:bg-slate-50 rounded-lg transition-colors">
                                <span className="flex items-center gap-2 min-w-0">
                                  {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />}
                                  <span className="text-sm text-slate-600 truncate">{range}</span>
                                  <span className="text-xs text-slate-500 tabular-nums shrink-0">{cur(week.spent)} / {cur(limit)}</span>
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
                                      <div key={tx.id} className="flex items-center justify-between gap-2 text-sm">
                                        <span className="flex items-center gap-2.5 min-w-0">
                                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-red-100 text-red-600 shrink-0" aria-hidden="true">
                                            <Receipt className="w-3.5 h-3.5" />
                                          </span>
                                          <span className="text-slate-600 truncate">{tx.description}</span>
                                          <span className="text-xs text-slate-500 shrink-0">{fmtDate(tx.date, 'd MMM')}</span>
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <span className="font-medium text-red-500 whitespace-nowrap tracking-tight tabular-nums">-{cur(Number(tx.amount))}</span>
                                          <button onClick={() => openEditExp(tx)} aria-label="Modifica spesa" className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-[transform,background-color] active:scale-90"><Pencil className="w-3.5 h-3.5" /></button>
                                          <button onClick={() => removeTx(tx)} aria-label="Elimina spesa" className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-[transform,background-color] active:scale-90"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
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
            <label htmlFor="bud-name" className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input id="bud-name" type="text" value={budgetForm.name} onChange={e => setBudgetForm({ ...budgetForm, name: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Sfizi, Mangiare fuori..." />
          </div>
          <div>
            <label htmlFor="bud-amount" className="block text-sm font-medium text-slate-700 mb-1">Budget settimanale (€)</label>
            <DecimalInput id="bud-amount" value={budgetForm.amount} onChange={n => setBudgetForm({ ...budgetForm, amount: n })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label htmlFor="bud-fund" className="block text-sm font-medium text-slate-700 mb-1">Fondo predefinito (opzionale)</label>
            <select id="bud-fund" value={budgetForm.fund_id} onChange={e => setBudgetForm({ ...budgetForm, fund_id: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Scegli al momento della spesa</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={saveBudget} disabled={saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-[transform,background-color] active:scale-[0.98]">
            {saving ? 'Salvataggio...' : editingBudget ? 'Salva Modifiche' : 'Aggiungi Budget'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!expBudgetId} onClose={() => setExpBudgetId(null)} title={expBudgetId ? `Spesa per "${expBudgetId.name}"` : ''}>
        <div className="space-y-4">
          <div>
            <label htmlFor="bexp-desc" className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input id="bexp-desc" type="text" value={expForm.description} onChange={e => setExpForm({ ...expForm, description: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Pizza, Gelato..." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="bexp-amount" className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput id="bexp-amount" value={expForm.amount} onChange={n => setExpForm({ ...expForm, amount: n })} className="w-full min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div className="min-w-0">
              <label htmlFor="bexp-date" className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input id="bexp-date" type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} className="w-full min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label htmlFor="bexp-fund" className="block text-sm font-medium text-slate-700 mb-1">Paga con</label>
            <select id="bexp-fund" value={expForm.fund_id} onChange={e => setExpForm({ ...expForm, fund_id: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <button onClick={saveExpense} disabled={saving || expForm.amount <= 0 || !expForm.description.trim()} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-[transform,background-color] active:scale-[0.98]">
            {saving ? 'Registrazione...' : 'Registra Spesa'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!editingExp} onClose={() => setEditingExp(null)} title="Modifica spesa">
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            Modificando importo o fondo, il saldo dei fondi viene aggiornato di conseguenza. Cambiando la data, la spesa può spostarsi in un'altra settimana.
          </div>
          <div>
            <label htmlFor="bedit-desc" className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
            <input id="bedit-desc" type="text" value={editExpForm.description} onChange={e => setEditExpForm({ ...editExpForm, description: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="bedit-amount" className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput id="bedit-amount" value={editExpForm.amount} onChange={n => setEditExpForm({ ...editExpForm, amount: n })} className="w-full min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div className="min-w-0">
              <label htmlFor="bedit-date" className="block text-sm font-medium text-slate-700 mb-1">Data</label>
              <input id="bedit-date" type="date" value={editExpForm.date} onChange={e => setEditExpForm({ ...editExpForm, date: e.target.value })} className="w-full min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
          <div>
            <label htmlFor="bedit-fund" className="block text-sm font-medium text-slate-700 mb-1">Pagato con</label>
            <select id="bedit-fund" value={editExpForm.fund_id} onChange={e => setEditExpForm({ ...editExpForm, fund_id: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessun fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <button onClick={saveEditExp} disabled={saving || editExpForm.amount <= 0 || !editExpForm.description.trim()} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-[transform,background-color] active:scale-[0.98]">
            {saving ? 'Salvataggio...' : 'Salva Modifiche'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
