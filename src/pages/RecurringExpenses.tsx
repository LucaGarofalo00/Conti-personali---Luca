import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ArrowRightLeft, Zap, Hand } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { cur, EXPENSE_CATEGORIES, todayString, getBillingPeriod } from '../lib/utils'
import { getPeriodBreakdown, totalsFromBreakdown } from '../lib/periodBreakdown'
import InfoBox from '../components/InfoBox'
import type { RecurringExpense, Fund } from '../types'

const DAYS_OF_WEEK = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const emptyForm = {
  name: '', amount: 0,
  frequency: 'monthly' as 'monthly' | 'weekly' | 'yearly',
  day_of_month: 1,
  day_of_week: 1,
  month_of_year: 1,
  fund_id: '' as string,
  fund_to_id: '' as string,
  category: 'altro',
  type: 'expense' as 'expense' | 'transfer',
  auto_deduct: false,
  end_date: '',
}

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
    try {
      const [{ data: exp, error: e1 }, { data: fnd, error: e2 }] = await Promise.all([
        supabase.from('recurring_expenses').select('*').order('day_of_month'),
        supabase.from('funds').select('*').order('sort_order'),
      ])
      const firstError = e1 || e2
      if (firstError) {
        console.error('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      setItems(exp || [])
      setFunds(fnd || [])
    } catch (err) {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) load() }, [user])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (item: RecurringExpense) => {
    setEditing(item)
    setForm({
      name: item.name,
      amount: Number(item.amount),
      frequency: item.frequency || 'monthly',
      day_of_month: item.day_of_month ?? 1,
      day_of_week: item.day_of_week ?? 1,
      month_of_year: item.month_of_year ?? 1,
      fund_id: item.fund_id || '',
      fund_to_id: item.fund_to_id || '',
      category: item.category,
      type: item.type || 'expense',
      auto_deduct: item.auto_deduct || false,
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
      frequency: form.frequency,
      day_of_month: form.frequency === 'monthly' || form.frequency === 'yearly' ? form.day_of_month : null,
      day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
      month_of_year: form.frequency === 'yearly' ? form.month_of_year : null,
      fund_id: form.fund_id || null,
      fund_to_id: form.type === 'transfer' ? (form.fund_to_id || null) : null,
      category: form.type === 'transfer' ? 'trasferimento' : form.category,
      type: form.type,
      auto_deduct: form.auto_deduct && !!form.fund_id,
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

  const today = todayString()
  const activeItems = items.filter(i => i.is_active && (!i.end_date || i.end_date >= today))
  const expiredItems = items.filter(i => i.end_date && i.end_date < today)
  const { start: pStart, end: pEnd } = getBillingPeriod()
  const periodBreakdown = getPeriodBreakdown({
    startDate: new Date(pStart),
    endDate: new Date(pEnd),
    recurringExpenses: activeItems,
    recurringIncome: [],
    weeklyBudgets: [],
    planned: [],
    excludedFundIds: [],
    fromToday: false,
  })
  const totalExpenses = totalsFromBreakdown(periodBreakdown).expenses

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-slate-500">Totale spese del periodo corrente (15-14): <span className="font-semibold text-red-500">{cur(totalExpenses)}</span></p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-[13px] font-medium">
          <Plus className="w-4 h-4" /> Aggiungi
        </button>
      </div>
      <InfoBox title="Come funzionano le spese ricorrenti" tone="blue">
        <p>Una spesa ricorrente si ripete con la frequenza indicata. Compare nelle previsioni e nelle stime.</p>
        <p><strong>Frequenza mensile</strong>: scatta ogni mese nel giorno indicato (es. affitto il 1, Netflix il 5).</p>
        <p><strong>Frequenza settimanale</strong>: scatta ogni settimana nel giorno indicato (es. GPL ogni venerdì).</p>
        <p><strong>Frequenza annuale</strong>: scatta una volta l'anno nel mese e giorno indicato (es. bollo auto a marzo).</p>
        <p><strong>Nei totali e previsioni</strong>: ogni spesa conta per le occorrenze effettive nel periodo (15-14). Niente medie: una spesa annuale conta 600€ solo nel mese in cui cade, e 0€ negli altri periodi. Una spesa settimanale conta 4-5 volte (quanti lunedì/venerdì/ecc. ci sono nel periodo).</p>
        <p><strong>Da confermare</strong>: nel giorno di scadenza compare nella sezione "Da Confermare" della dashboard. Clicchi "Paga" → puoi modificare l'importo prima di confermare (per esempio se questo mese hai pagato 25€ di GPL invece di 30€).</p>
        <p><strong>Automatica</strong>: nel giorno di scadenza viene scalata <strong>automaticamente</strong> dal fondo predefinito con l'importo fisso. Non compare in "Da Confermare". Richiede di aver scelto un fondo.</p>
        <p><strong>Trasferimento</strong>: sposta soldi da un fondo all'altro (es. salvadanaio Bollo, risparmio mensile). <strong>NON viene contato come spesa</strong> nelle previsioni perché è un movimento interno tra i tuoi conti. La spesa vera la registri solo quando paghi davvero (es. annuale del bollo).</p>
        <p><strong>Data ultimo accredito</strong>: dopo quella data la spesa non viene più contata (es. finanziamento che finisce a giugno).</p>
      </InfoBox>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200/60 shadow-sm">
          <p className="text-slate-400 mb-4">Nessuna spesa ricorrente configurata</p>
          <button onClick={openAdd} className="text-blue-600 font-medium hover:text-blue-700">Aggiungi la prima voce</button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.filter(i => !i.end_date || i.end_date >= today).map(item => {
            const isTransfer = (item.type || 'expense') === 'transfer'
            const fromFund = funds.find(f => f.id === item.fund_id)?.name
            const toFund = funds.find(f => f.id === item.fund_to_id)?.name
            return (
              <div key={item.id} className={`bg-white rounded-xl border border-slate-200/60 shadow-sm p-4 flex items-center justify-between transition ${!item.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <button onClick={() => toggle(item)} className="text-slate-400 hover:text-blue-600 transition">
                    {item.is_active ? <ToggleRight className="w-6 h-6 text-blue-600" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-800">{item.name}</p>
                      {isTransfer && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">Trasferimento</span>}
                      {item.auto_deduct ? (
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-1"><Zap className="w-3 h-3" /> Automatica</span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-1"><Hand className="w-3 h-3" /> Da confermare</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {(() => {
                        const f = item.frequency || 'monthly'
                        if (f === 'weekly') return `Ogni ${DAYS_OF_WEEK[item.day_of_week ?? 1]}`
                        if (f === 'yearly') return `Ogni anno il ${item.day_of_month} ${MONTHS[(item.month_of_year ?? 1) - 1]}`
                        return `Ogni mese il ${item.day_of_month}`
                      })()} &middot; {isTransfer
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
                <div key={item.id} className="bg-white rounded-xl border border-slate-200/60 shadow-sm p-4 flex items-center justify-between opacity-40">
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
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder={form.type === 'transfer' ? 'es. Risparmio mensile...' : 'es. Affitto, Netflix...'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <input type="number" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Frequenza</label>
              <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value as 'monthly' | 'weekly' | 'yearly' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                <option value="monthly">Mensile</option>
                <option value="weekly">Settimanale</option>
                <option value="yearly">Annuale</option>
              </select>
            </div>
          </div>
          {form.frequency === 'monthly' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno del mese</label>
              <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          )}
          {form.frequency === 'weekly' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno della settimana</label>
              <select value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">La spesa verrà conteggiata ogni {DAYS_OF_WEEK[form.day_of_week]} (~{form.amount > 0 ? (form.amount * 4.33).toFixed(2) : 0}€/mese stimato).</p>
            </div>
          )}
          {form.frequency === 'yearly' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mese</label>
                <select value={form.month_of_year} onChange={e => setForm({ ...form, month_of_year: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Giorno</label>
                <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
              </div>
              <p className="col-span-2 text-xs text-slate-400">La spesa verrà conteggiata ogni {form.day_of_month} {MONTHS[form.month_of_year - 1]} (~{form.amount > 0 ? (form.amount / 12).toFixed(2) : 0}€/mese stimato).</p>
            </div>
          )}

          {form.type === 'expense' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow capitalize">
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fondo predefinito (opzionale)</label>
                <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
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
                <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                  <option value="">Seleziona...</option>
                  {funds.filter(f => f.id !== form.fund_to_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">A</label>
                <select value={form.fund_to_id} onChange={e => setForm({ ...form, fund_to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                  <option value="">Seleziona...</option>
                  {funds.filter(f => f.id !== form.fund_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Modalità di addebito</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm({ ...form, auto_deduct: false })}
                className={`p-3 rounded-lg border text-left transition ${!form.auto_deduct ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Hand className={`w-4 h-4 ${!form.auto_deduct ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span className={`text-sm font-medium ${!form.auto_deduct ? 'text-amber-700' : 'text-slate-600'}`}>Da confermare</span>
                </div>
                <p className="text-xs text-slate-500">Compare nella dashboard, da confermare manualmente</p>
              </button>
              <button
                onClick={() => setForm({ ...form, auto_deduct: true })}
                disabled={!form.fund_id && form.type !== 'transfer'}
                className={`p-3 rounded-lg border text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${form.auto_deduct ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}
                title={!form.fund_id && form.type !== 'transfer' ? 'Seleziona un fondo per abilitare' : ''}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Zap className={`w-4 h-4 ${form.auto_deduct ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <span className={`text-sm font-medium ${form.auto_deduct ? 'text-emerald-700' : 'text-slate-600'}`}>Automatica</span>
                </div>
                <p className="text-xs text-slate-500">Scalata automaticamente dal fondo nel giorno previsto</p>
              </button>
            </div>
            {form.auto_deduct && !form.fund_id && form.type !== 'transfer' && (
              <p className="text-xs text-red-500 mt-2">Seleziona un fondo predefinito sopra per l'addebito automatico</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data ultimo accredito (opzionale)</label>
            <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            {form.end_date && (
              <button onClick={() => setForm({ ...form, end_date: '' })} className="text-xs text-blue-600 mt-1 hover:text-blue-700">Rimuovi data</button>
            )}
          </div>
          <button onClick={save} disabled={saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Aggiungi'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
