import { useState, useEffect } from 'react'
import { Wallet, Plus, Pencil, Trash2, ArrowLeftRight, PiggyBank } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import Modal from '../components/Modal'
import { cur, iconMap, ICONS, COLORS, todayString } from '../lib/utils'
import { incrementFundBalance } from '../lib/fundBalances'
import InfoBox from '../components/InfoBox'
import type { Fund } from '../types'

const emptyForm = { name: '', type: 'main' as 'main' | 'sub', parent_id: null as string | null, balance: 0, icon: 'wallet', color: '#3B82F6', sort_order: 0 }
const emptyTransfer = { from_id: '', to_id: '', amount: 0 }

export default function Funds() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [editing, setEditing] = useState<Fund | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [transfer, setTransfer] = useState(emptyTransfer)

  const load = async () => {
    try {
      const { data, error } = await supabase.from('funds').select('*').order('sort_order')
      if (error) {
        console.error('Errore Supabase:', error)
        toast.error('Errore: ' + (error.message || 'caricamento fondi'))
      }
      setFunds(data || [])
    } catch (err) {
      console.error('Errore fatale:', err)
      toast.error('Errore imprevisto (F12 per dettagli)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) load() }, [user])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (f: Fund) => {
    setEditing(f)
    setForm({ name: f.name, type: f.type as 'main' | 'sub', parent_id: f.parent_id, balance: Number(f.balance), icon: f.icon, color: f.color, sort_order: f.sort_order })
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Inserisci un nome'); return }
    setSaving(true)
    const { error } = editing
      ? await supabase.from('funds').update(form).eq('id', editing.id)
      : await supabase.from('funds').insert({ user_id: user!.id, ...form })
    setSaving(false)
    if (error) { toast.error('Errore nel salvataggio'); return }
    toast.success(editing ? 'Fondo aggiornato' : 'Fondo creato')
    setShowModal(false)
    load()
  }

  const remove = async (id: string) => {
    if (!(await confirm({ message: 'Eliminare questo fondo?', confirmText: 'Elimina', danger: true }))) return
    const { error } = await supabase.from('funds').delete().eq('id', id)
    if (error) { toast.error('Errore nell\'eliminazione'); return }
    toast.success('Fondo eliminato')
    load()
  }

  const doTransfer = async () => {
    if (!transfer.from_id || !transfer.to_id || transfer.amount <= 0) return
    const from = funds.find(f => f.id === transfer.from_id)!
    const to = funds.find(f => f.id === transfer.to_id)!
    if (transfer.amount > Number(from.balance)) {
      toast.error('Saldo insufficiente')
      return
    }
    setSaving(true)
    await incrementFundBalance(from.id, -transfer.amount)
    await incrementFundBalance(to.id, transfer.amount)
    await supabase.from('transactions').insert({
      user_id: user!.id, type: 'transfer', amount: transfer.amount,
      description: `Trasferimento: ${from.name} → ${to.name}`,
      fund_id: from.id, fund_to_id: to.id, category: 'trasferimento', date: todayString(),
    })
    setSaving(false)
    toast.success('Trasferimento completato')
    setShowTransfer(false)
    setTransfer(emptyTransfer)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  const mainFunds = funds.filter(f => f.type === 'main')
  const subFunds = funds.filter(f => f.type === 'sub')

  return (
    <div>
      <InfoBox title="Come funzionano i fondi" tone="blue">
        <p>Un <strong>fondo</strong> è un contenitore di denaro: conto in banca, contanti, carta, salvadanaio, ecc.</p>
        <p>Il saldo dei fondi si aggiorna automaticamente quando: confermi una transazione dalla dashboard, registri una spesa in un budget/variable, scatti un'auto-deduct, o aggiungi/elimini una transazione.</p>
        <p><strong>Salvadanaio (sub)</strong>: fondo "figlio" di un fondo principale, utile per organizzare (es. "Risparmio Vacanze" sotto "Carta").</p>
        <p><strong>Trasferisci</strong>: sposta denaro da un fondo a un altro. Crea una transazione di tipo "transfer".</p>
        <p>Nel filtro globale puoi <strong>escludere</strong> fondi dalle previsioni e dalle stime mensili (utile per simulare scenari "se non avessi accesso ai risparmi").</p>
      </InfoBox>
      <div className="flex items-center justify-between mb-4">
        <span />
        <div className="flex gap-2">
          <button onClick={() => { setTransfer(emptyTransfer); setShowTransfer(true) }} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all text-[13px] font-medium">
            <ArrowLeftRight className="w-4 h-4" /> Trasferisci
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-[13px] font-medium">
            <Plus className="w-4 h-4" /> Aggiungi
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {mainFunds.map(fund => {
          const Icon = iconMap[fund.icon] || Wallet
          const subs = subFunds.filter(s => s.parent_id === fund.id)
          return (
            <div key={fund.id} className="bg-white rounded-xl border border-slate-200/60 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ backgroundColor: fund.color + '20' }}>
                    <Icon className="w-5 h-5" style={{ color: fund.color }} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{fund.name}</p>
                    <p className="text-xs text-slate-400">Fondo principale</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(fund)} aria-label="Modifica fondo" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(fund.id)} aria-label="Elimina fondo" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-800 mb-1">{cur(Number(fund.balance))}</p>

              {subs.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  {subs.map(sub => (
                    <div key={sub.id} className="flex items-center justify-between">
                      <span className="text-sm text-slate-500 flex items-center gap-1.5">
                        <PiggyBank className="w-3.5 h-3.5" /> {sub.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{cur(Number(sub.balance))}</span>
                        <button onClick={() => openEdit(sub)} aria-label="Modifica salvadanaio" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => remove(sub.id)} aria-label="Elimina salvadanaio" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => { setEditing(null); setForm({ ...emptyForm, type: 'sub', parent_id: fund.id, color: fund.color, icon: 'piggy-bank' }); setShowModal(true) }}
                className="mt-3 w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium py-1.5 rounded-lg hover:bg-blue-50 transition"
              >
                + Aggiungi salvadanaio
              </button>
            </div>
          )
        })}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Modifica Fondo' : 'Nuovo Fondo'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Saldo</label>
            <input type="number" step="0.01" value={form.balance} onChange={e => setForm({ ...form, balance: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          {form.type === 'main' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Icona</label>
                <div className="flex gap-2 flex-wrap">
                  {ICONS.map(ic => {
                    const Ic = iconMap[ic.value]
                    return (
                      <button key={ic.value} onClick={() => setForm({ ...form, icon: ic.value })} className={`p-2.5 rounded-lg border transition ${form.icon === ic.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`} title={ic.label}>
                        <Ic className="w-5 h-5 text-slate-600" />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Colore</label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setForm({ ...form, color: c })} className={`w-8 h-8 rounded-full border-2 transition ${form.color === c ? 'border-slate-800 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </>
          )}
          <button onClick={save} disabled={saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : editing ? 'Salva Modifiche' : 'Aggiungi Fondo'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Trasferisci Fondi">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Da</label>
            <select value={transfer.from_id} onChange={e => setTransfer({ ...transfer, from_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Seleziona fondo</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">A</label>
            <select value={transfer.to_id} onChange={e => setTransfer({ ...transfer, to_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow">
              <option value="">Seleziona fondo</option>
              {funds.filter(f => f.id !== transfer.from_id).map(f => <option key={f.id} value={f.id}>{f.name} ({cur(Number(f.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Importo</label>
            <input type="number" step="0.01" value={transfer.amount || ''} onChange={e => setTransfer({ ...transfer, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <button onClick={doTransfer} disabled={!transfer.from_id || !transfer.to_id || transfer.amount <= 0 || saving} className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving ? 'Trasferimento...' : 'Trasferisci'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
