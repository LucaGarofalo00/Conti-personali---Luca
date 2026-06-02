import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Clock, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import DecimalInput from '../components/DecimalInput'
import { cur, getBillingPeriod } from '../lib/utils'
import { logSupabaseError } from '../lib/logError'
import { generateIncomeOccurrences } from '../lib/incomeOccurrences'
import InfoBox from '../components/InfoBox'
import type { RecurringIncome, Fund, Transaction } from '../types'

const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

const emptyForm = {
  name: '', amount: 0, is_variable: false, frequency: 'monthly' as 'monthly' | 'weekly',
  day_of_month: 15, day_of_week: 6, delay_days: 0, fund_id: '' as string,
  start_date: '', end_date: '',
}

export default function Income() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<RecurringIncome[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [periodTx, setPeriodTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<RecurringIncome | null>(null)
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    try {
      const { start: pStart, end: pEnd } = getBillingPeriod()
      const [{ data: inc, error: e1 }, { data: fnd, error: e2 }, txRes] = await Promise.all([
        supabase.from('recurring_income').select('*').order('created_at'),
        supabase.from('funds').select('*').order('sort_order'),
        supabase.from('transactions').select('*').gte('date', pStart).lte('date', pEnd),
      ])
      const firstError = e1 || e2
      if (firstError) {
        logSupabaseError('Errore Supabase:', firstError)
        toast.error('Errore: ' + (firstError.message || 'caricamento dati'))
      }
      setItems(inc || [])
      setFunds(fnd || [])
      if (!txRes.error) setPeriodTx((txRes.data || []).filter(t => !t.is_planned))
    } catch (err) {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) load() }, [user])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (item: RecurringIncome) => {
    setEditing(item)
    setForm({
      name: item.name, amount: Number(item.amount), is_variable: item.is_variable,
      frequency: item.frequency, day_of_month: item.day_of_month || 15,
      day_of_week: item.day_of_week ?? 6, delay_days: item.delay_days, fund_id: item.fund_id || '',
      start_date: item.start_date || '', end_date: item.end_date || '',
    })
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Inserisci un nome'); return }
    if (form.amount <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      toast.error('La data di inizio non può essere successiva alla fine'); setSaving(false); return
    }
    const data = {
      ...form,
      fund_id: form.fund_id || null,
      day_of_month: form.frequency === 'monthly' ? form.day_of_month : null,
      day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    }
    const { error } = editing
      ? await supabase.from('recurring_income').update(data).eq('id', editing.id)
      : await supabase.from('recurring_income').insert({ user_id: user!.id, ...data })
    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editing ? 'Entrata aggiornata' : 'Entrata aggiunta')
    setShowModal(false)
    load()
  }

  const remove = async (id: string) => {
    if (!(await confirm({ message: 'Eliminare questa entrata?', confirmText: 'Elimina', danger: true }))) return
    const { error } = await supabase.from('recurring_income').delete().eq('id', id)
    if (error) { toast.error('Errore nell\'eliminazione'); return }
    toast.success('Entrata eliminata')
    load()
  }

  const toggle = async (item: RecurringIncome) => {
    const { error } = await supabase.from('recurring_income').update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) toast.error('Errore nell\'aggiornamento')
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const { start: pStart, end: pEnd } = getBillingPeriod()
  const occurrencesInPeriod = generateIncomeOccurrences(items.filter(i => i.is_active), pStart, pEnd, periodTx)
  const totalMonthly = occurrencesInPeriod.reduce((s, o) => {
    if (o.status === 'skipped') return s
    if (o.status === 'paid' && o.matchingTx) return s + Number(o.matchingTx.amount)
    return s + Number(o.income.amount)
  }, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-slate-500">Totale entrate ricorrenti del periodo (15-14): <span className="font-semibold text-emerald-600">{cur(totalMonthly)}</span></p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-[13px] font-medium">
          <Plus className="w-4 h-4" /> Aggiungi
        </button>
      </div>
      <InfoBox title="Come funzionano le entrate" tone="emerald">
        <p><strong>Mensile</strong>: arriva una volta al mese nel giorno indicato (es. stipendio il 27).</p>
        <p><strong>Settimanale + ritardo</strong>: si lavora un giorno specifico (es. sabato) ma viene pagato dopo X giorni (es. lunedì = ritardo 2). Nella dashboard vedi <strong>ogni sabato del periodo</strong> separato, da confermare individualmente. Se non confermi, si accumulano.</p>
        <p><strong>Importo variabile</strong>: la cifra è una stima — al momento della conferma puoi inserire il valore effettivo.</p>
        <p><strong>Fondo destinazione</strong>: dove finiranno i soldi una volta confermati. Puoi anche scegliere al momento della conferma.</p>
        <p><strong>Nelle previsioni e nel totale</strong>: ogni entrata conta per le occorrenze effettive nel periodo corrente (15-14). Es. un sabato settimanale conta 4-5 volte, lo stipendio mensile conta 1 volta. Niente medie, solo occorrenze reali.</p>
      </InfoBox>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200/60 shadow-sm">
          <p className="text-slate-400 mb-4">Nessuna entrata configurata</p>
          <button onClick={openAdd} className="text-blue-600 font-medium hover:text-blue-700">Aggiungi la prima entrata</button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const fundName = funds.find(f => f.id === item.fund_id)?.name
            return (
              <div key={item.id} className={`bg-white rounded-xl border border-slate-200/60 shadow-sm p-4 flex items-center justify-between transition ${!item.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <button onClick={() => toggle(item)} aria-label={item.is_active ? 'Disattiva entrata' : 'Attiva entrata'} className="text-slate-400 hover:text-blue-600 transition">
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
                      {item.start_date && <span>· Dal {new Date(item.start_date).toLocaleDateString('it-IT')}</span>}
                      {item.end_date && <span>· Fino al {new Date(item.end_date).toLocaleDateString('it-IT')}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-lg font-semibold text-emerald-600">{cur(Number(item.amount))}</span>
                    <p className="text-xs text-slate-400">{item.frequency === 'monthly' ? '/mese' : '/settimana'}</p>
                  </div>
                  <button onClick={() => openEdit(item)} aria-label="Modifica entrata" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(item.id)} aria-label="Elimina entrata" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
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
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" placeholder="es. Stipendio, Lavoro sabato..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Importo (€)</label>
              <DecimalInput value={form.amount} onChange={n => setForm({ ...form, amount: n })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Frequenza</label>
              <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value as 'monthly' | 'weekly' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                <option value="monthly">Mensile</option>
                <option value="weekly">Settimanale</option>
              </select>
            </div>
          </div>
          {form.frequency === 'monthly' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno del mese</label>
              <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Giorno della settimana</label>
                <select value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ritardo pagamento (gg)</label>
                <input type="number" min={0} value={form.delay_days} onChange={e => setForm({ ...form, delay_days: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="variable" checked={form.is_variable} onChange={e => setForm({ ...form, is_variable: e.target.checked })} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="variable" className="text-sm text-slate-700">Importo variabile (la cifra indicata è una stima)</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fondo destinazione (opzionale)</label>
            <select value={form.fund_id} onChange={e => setForm({ ...form, fund_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Nessuno</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data inizio (opzionale)</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
              {form.start_date && (
                <button onClick={() => setForm({ ...form, start_date: '' })} className="text-xs text-blue-600 mt-1 hover:text-blue-700">Rimuovi</button>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data fine (opzionale)</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
              {form.end_date && (
                <button onClick={() => setForm({ ...form, end_date: '' })} className="text-xs text-blue-600 mt-1 hover:text-blue-700">Rimuovi</button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400">La data di inizio può essere anche passata (entrata già in corso). Lascia vuoto per "sempre attiva".</p>
          <button onClick={save} disabled={saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Aggiungi Entrata'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
