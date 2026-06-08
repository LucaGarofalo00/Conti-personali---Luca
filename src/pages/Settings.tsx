import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarRange, Save, AlertTriangle, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import InfoBox from '../components/InfoBox'
import { logSupabaseError } from '../lib/logError'
import { usePeriodSettings } from '../lib/periodSettings'
import { savePeriodSettings } from '../lib/periodSettingsDb'
import { resetFromToday } from '../lib/resetData'
import { computePeriod, formatPeriodRange, todayString } from '../lib/utils'
import type { RecurringIncome } from '../types'

export default function Settings() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const settings = usePeriodSettings()

  const [incomes, setIncomes] = useState<RecurringIncome[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Form locale, inizializzato dalle impostazioni correnti e risincronizzato quando cambiano.
  const [salaryIncomeId, setSalaryIncomeId] = useState(settings.salaryIncomeId || '')
  const [anchorDay, setAnchorDay] = useState(settings.anchorDay)
  const [periodStart, setPeriodStart] = useState(settings.periodStart || '')

  useEffect(() => {
    setSalaryIncomeId(settings.salaryIncomeId || '')
    setAnchorDay(settings.anchorDay)
    setPeriodStart(settings.periodStart || '')
  }, [settings.salaryIncomeId, settings.anchorDay, settings.periodStart])

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const { data, error } = await supabase.from('recurring_income').select('*').order('created_at')
      if (error) logSupabaseError('Errore caricamento entrate:', error)
      setIncomes(data || [])
      setLoading(false)
    })()
  }, [user])

  const save = async () => {
    if (!user) return
    setSaving(true)
    const { error } = await savePeriodSettings(user.id, {
      salaryIncomeId: salaryIncomeId || null,
      anchorDay,
      periodStart: periodStart || null,
    })
    setSaving(false)
    if (error) {
      toast.error(/user_settings/i.test(error)
        ? 'Tabella impostazioni mancante: esegui supabase-user-settings.sql su Supabase'
        : 'Errore nel salvataggio: ' + error)
      return
    }
    toast.success('Impostazioni salvate')
  }

  const doReset = async () => {
    if (!user) return
    const ok = await confirm({
      title: 'Ricomincia da oggi',
      message: 'Verranno eliminati TUTTI i movimenti registrati e le pianificate già scadute. ' +
        'Restano fondi, entrate, spese ricorrenti, budget e le pianificate future. ' +
        'I saldi dei fondi NON vengono toccati: li reimposti tu nella pagina Fondi. ' +
        'L’operazione non è reversibile. Vuoi procedere?',
      confirmText: 'Sì, ricomincia da oggi',
      cancelText: 'Annulla',
      danger: true,
    })
    if (!ok) return
    setResetting(true)
    const { error, deletedPastPlanned } = await resetFromToday(user.id)
    setResetting(false)
    if (error) {
      toast.error('Errore nel reset: ' + error)
      return
    }
    toast.success(
      `Ricominciato da oggi. ${deletedPastPlanned ? `${deletedPastPlanned} pianificate passate eliminate. ` : ''}Ora imposta i saldi nella pagina Fondi.`,
    )
    navigate('/')
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Caricamento...</div>

  // Anteprima calcolata dai valori del FORM (non ancora salvati), così aggiorna mentre digiti.
  const period = computePeriod(periodStart || null, anchorDay)
  const monthlyIncomes = incomes.filter(i => i.frequency === 'monthly')

  return (
    <div className="max-w-2xl space-y-6">
      {/* PERIODO */}
      <section className="bg-white rounded-xl border border-slate-200/60 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarRange className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-800">Periodo dello stipendio</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Periodo (anteprima): <span className="font-semibold text-indigo-700">{formatPeriodRange(period.startDate, period.endDate)}</span>
        </p>

        <InfoBox title="Come funziona il periodo" tone="blue">
          <p>Il periodo va <strong>dal giorno in cui arriva lo stipendio</strong> al giorno prima dello stipendio successivo (es. stipendio il 15 → periodo 15→14; stipendio il 12 → 12→11).</p>
          <p>Siccome il giorno cambia ogni mese, scegli quale entrata è <strong>lo stipendio</strong>: quando la registri nella dashboard, l'app ti propone di far partire il nuovo periodo da quella data reale (con conferma).</p>
          <p>Il <strong>giorno tipico</strong> serve solo come stima per le previsioni finché il prossimo stipendio non arriva davvero.</p>
        </InfoBox>

        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Entrata che definisce lo stipendio</label>
            <select
              value={salaryIncomeId}
              onChange={e => setSalaryIncomeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-shadow"
            >
              <option value="">Nessuna (periodo a giorno fisso)</option>
              {monthlyIncomes.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {monthlyIncomes.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Nessuna entrata mensile configurata. Aggiungine una nella pagina Entrate.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Inizio periodo corrente</label>
              <input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-shadow"
              />
              <button onClick={() => setPeriodStart(todayString())} className="text-xs text-indigo-600 mt-1 hover:text-indigo-700">Imposta a oggi</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giorno tipico (stima)</label>
              <input
                type="number" min={1} max={28}
                value={anchorDay}
                onChange={e => setAnchorDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-shadow"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Periodo calcolato: <span className="font-medium text-slate-600">{period.start} → {period.end}</span>
          </p>

          <button
            onClick={save}
            disabled={saving}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" /> {saving ? 'Salvataggio...' : 'Salva impostazioni'}
          </button>
        </div>
      </section>

      {/* RICOMINCIA DA OGGI */}
      <section className="bg-white rounded-xl border border-red-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <RotateCcw className="w-5 h-5 text-red-600" />
          <h2 className="text-base font-semibold text-slate-800">Ricomincia da oggi</h2>
        </div>
        <p className="text-sm text-slate-500 mb-3">Azzera lo storico e riparti pulito dal periodo corrente.</p>

        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-1 mb-4">
          <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span><strong>Cosa viene eliminato</strong>: tutti i movimenti registrati (entrate, uscite, trasferimenti) e le pianificate <strong>già scadute</strong>. Operazione <strong>non reversibile</strong>.</span></p>
          <p className="ml-6"><strong>Cosa resta</strong>: fondi, entrate, spese ricorrenti, budget e le pianificate <strong>future</strong>. I saldi dei fondi restano invariati — reimpostali nella pagina <strong>Fondi</strong>.</p>
          <p className="ml-6">Le spese ricorrenti scadute <strong>prima di oggi</strong> non verranno più mostrate: il periodo riparte da oggi.</p>
        </div>

        <button
          onClick={doReset}
          disabled={resetting}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> {resetting ? 'In corso...' : 'Ricomincia da oggi'}
        </button>
      </section>
    </div>
  )
}
