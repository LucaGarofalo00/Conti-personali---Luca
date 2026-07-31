import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarRange, Save, AlertTriangle, RotateCcw, DatabaseBackup, Download, FileDown, RefreshCcw, Bell, BellOff, Tag, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import InfoBox from '../components/InfoBox'
import { logSupabaseError } from '../lib/logError'
import { usePeriodSettings, anchorFromSalaryIncome } from '../lib/periodSettings'
import { savePeriodSettings } from '../lib/periodSettingsDb'
import { resetFromToday } from '../lib/resetData'
import { fetchBackup, downloadJson, downloadTransactionsCsv } from '../lib/exportData'
import { recomputeBalances } from '../lib/reconcile'
import { getNotifState, enableNotifications, disableNotifications, type NotifState } from '../lib/push'
import { useCustomCategories, addCustomCategory, removeCustomCategory } from '../lib/categories'
import { computePeriod, formatPeriodRange, todayString } from '../lib/utils'
import type { RecurringIncome } from '../types'
import { SkeletonListPage } from '../components/Skeleton'

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
  const [exporting, setExporting] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [notifState, setNotifState] = useState<NotifState | 'loading'>('loading')
  const [notifBusy, setNotifBusy] = useState(false)
  const customCats = useCustomCategories()
  const [newCat, setNewCat] = useState('')
  const [catBusy, setCatBusy] = useState(false)
  // Categoria in corso di rimozione: disabilita il pulsante e segnala l'attesa (la ✕ non dava
  // alcun riscontro fra il tocco e la sparizione della pillola).
  const [removingCat, setRemovingCat] = useState<string | null>(null)

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

  useEffect(() => { getNotifState().then(setNotifState) }, [])

  // Il giorno atteso dello stipendio (anchor) NON si digita: lo detta l'entrata scelta come
  // stipendio. Solo senza stipendio configurato (periodo a giorno fisso) resta modificabile a mano.
  const selectedSalary = incomes.find(i => i.id === salaryIncomeId) || null
  const derivedAnchor = anchorFromSalaryIncome(selectedSalary)
  const effectiveAnchor = derivedAnchor ?? anchorDay

  const save = async () => {
    if (!user) return
    setSaving(true)
    const { error } = await savePeriodSettings(user.id, {
      salaryIncomeId: salaryIncomeId || null,
      periodStart: periodStart || null,
      // Con uno stipendio selezionato l'anchor lo ri-deriva savePeriodSettings dal suo day_of_month
      // (omettendolo qui); senza stipendio vale il valore digitato a mano.
      ...(derivedAnchor === null ? { anchorDay } : {}),
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

  const handleExport = async (kind: 'json' | 'csv') => {
    setExporting(true)
    try {
      const bundle = await fetchBackup()
      if (kind === 'json') downloadJson(bundle)
      else downloadTransactionsCsv(bundle)
      toast.success(kind === 'json' ? 'Backup esportato' : 'Transazioni esportate')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore durante l\'esportazione')
    } finally {
      setExporting(false)
    }
  }

  const handleAddCat = async () => {
    if (!user) return
    setCatBusy(true)
    const res = await addCustomCategory(user.id, newCat)
    setCatBusy(false)
    if (!res.ok) { toast.error(res.error || 'Errore'); return }
    setNewCat('')
    toast.success('Categoria aggiunta')
  }

  // Rimozione immediata al tocco della ✕: nessuna conferma e nessun modo di annullare, in una lista
  // dove le voci sono piccole e vicine. Le transazioni già classificate con quella categoria la
  // conservano, ma non la si può più scegliere finché non la si ricrea.
  const handleRemoveCat = async (name: string) => {
    if (!(await confirm({
      message: `Rimuovere la categoria «${name}»? I movimenti che la usano restano invariati, ma non potrai più selezionarla.`,
      confirmText: 'Rimuovi',
      danger: true,
    }))) return
    setRemovingCat(name)
    const res = await removeCustomCategory(name)
    setRemovingCat(null)
    if (!res.ok) { toast.error(res.error || 'Errore'); return }
    toast.success('Categoria rimossa')
  }

  const toggleNotifications = async () => {
    if (!user) return
    setNotifBusy(true)
    if (notifState === 'enabled') {
      const res = await disableNotifications()
      setNotifBusy(false)
      if (!res.ok) { toast.error(res.error || 'Errore'); return }
      setNotifState('disabled'); toast.success('Notifiche disattivate')
    } else {
      const res = await enableNotifications(user.id)
      setNotifBusy(false)
      if (!res.ok) { toast.error(res.error || 'Errore'); setNotifState(await getNotifState()); return }
      setNotifState('enabled'); toast.success('Notifiche attivate')
    }
  }

  const handleRecompute = async () => {
    if (!user) return
    const ok = await confirm({
      title: 'Ricalcolare i saldi?',
      message: 'I saldi dei fondi verranno ricostruiti dal registro delle transazioni (saldo iniziale + movimenti reali). Utile se un saldo non torna dopo un errore di rete. Operazione sicura e ripetibile.',
      confirmText: 'Ricalcola',
    })
    if (!ok) return
    setRecomputing(true)
    const res = await recomputeBalances(user.id)
    setRecomputing(false)
    if (res.ok) { toast.success('Saldi ricalcolati dal registro'); return }
    if (res.notDeployed) { toast.error('Funzione non installata: esegui supabase-reconcile.sql nell\'SQL Editor di Supabase'); return }
    toast.error('Errore nel ricalcolo: ' + (res.error || ''))
  }

  if (loading) return <SkeletonListPage rows={5} />

  // Anteprima calcolata dai valori del FORM (non ancora salvati), così aggiorna mentre digiti.
  const period = computePeriod(periodStart || null, effectiveAnchor)
  const monthlyIncomes = incomes.filter(i => i.frequency === 'monthly')

  return (
    <div className="max-w-2xl space-y-6 sm:space-y-8">
      {/* PERIODO */}
      <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarRange className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Periodo dello stipendio</h2>
        </div>
        <div className="mb-6">
          <p className="text-sm text-slate-500 mb-1">Periodo (anteprima)</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums text-blue-700 break-words">{formatPeriodRange(period.startDate, period.endDate)}</p>
        </div>

        <InfoBox title="Come funziona il periodo" tone="blue">
          <p>Il periodo <strong>inizia dal giorno in cui arriva davvero lo stipendio</strong> e <strong>finisce il giorno prima del prossimo stipendio atteso</strong>. Il giorno atteso è quello dell’entrata scelta qui sotto come stipendio: se lo stipendio è il <strong>14</strong>, il periodo va dal <strong>14 al 13</strong> del mese dopo, così contiene un solo stipendio.</p>
          <p>Siccome la data reale cambia ogni mese, scegli quale entrata è <strong>lo stipendio</strong>: quando la registri nella dashboard, l’app ti propone di far partire il nuovo periodo da quella data reale (con conferma). Un accredito in anticipo o in ritardo <strong>sposta solo l’inizio</strong>, non la fine: stipendio atteso il 14 ma arrivato il 18 → periodo <strong>18 → 13</strong>.</p>
          <p>Se al giorno atteso il prossimo stipendio non è ancora stato registrato, il periodo <strong>resta aperto fino a oggi</strong>: i soldi devono bastare finché non arriva l’accredito.</p>
        </InfoBox>

        <div className="space-y-4 mt-2">
          <div>
            <label htmlFor="set-salary" className="block text-sm font-medium text-slate-700 mb-1">Entrata che definisce lo stipendio</label>
            <select
              id="set-salary"
              value={salaryIncomeId}
              onChange={e => setSalaryIncomeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow"
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
              <label htmlFor="set-period-start" className="block text-sm font-medium text-slate-700 mb-1">Inizio periodo corrente</label>
              <input
                id="set-period-start"
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow"
              />
              <button onClick={() => setPeriodStart(todayString())} className="inline-flex items-center min-h-[40px] sm:min-h-0 px-2 -mx-2 text-xs text-blue-600 mt-1 hover:text-blue-700 active:scale-95 transition-[transform,color]">Imposta a oggi</button>
            </div>
            <div>
              <label htmlFor="set-anchor" className="block text-sm font-medium text-slate-700 mb-1">Giorno atteso dello stipendio</label>
              <input
                id="set-anchor"
                type="number" inputMode="numeric" min={1} max={28}
                value={effectiveAnchor}
                disabled={derivedAnchor !== null}
                onChange={e => setAnchorDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow disabled:bg-slate-100 disabled:text-slate-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                {derivedAnchor !== null
                  ? <>Deriva dal giorno di «{selectedSalary?.name}». Per cambiarlo, modifica quell’entrata nella pagina Entrate.</>
                  : <>Senza uno stipendio selezionato il periodo è a giorno fisso: da questo giorno al giorno prima del mese successivo.</>}
              </p>
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]"
          >
            <Save className="w-4 h-4" aria-hidden="true" /> {saving ? 'Salvataggio...' : 'Salva impostazioni'}
          </button>
        </div>
      </section>

      {/* CATEGORIE PERSONALIZZATE */}
      <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
            <Tag className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Categorie personalizzate</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Aggiungi categorie tue (oltre a quelle predefinite): compaiono nei menu di transazioni e spese ricorrenti. Richiede di aver eseguito <span className="font-mono text-[13px] text-blue-600">supabase-categories.sql</span>.</p>
        {customCats.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {customCats.map(c => (
              <span key={c} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-slate-100 text-slate-700 text-sm capitalize">
                {c}
                <button
                  onClick={() => handleRemoveCat(c)}
                  disabled={removingCat === c}
                  aria-label={`Rimuovi ${c}`}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-red-600 transition-colors disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCat() } }}
            placeholder="es. Palestra, Animali..."
            maxLength={30}
            className="flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-shadow"
          />
          <button onClick={handleAddCat} disabled={catBusy || !newCat.trim()} className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color] shrink-0">
            <Plus className="w-4 h-4" aria-hidden="true" /> Aggiungi
          </button>
        </div>
      </section>

      {/* NOTIFICHE */}
      <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Notifiche promemoria</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Ricevi un promemoria push quando una spesa o un'entrata ricorrente scade, anche ad app chiusa. Richiede di aver eseguito <span className="font-mono text-[13px] text-blue-600">supabase-notifications.sql</span> e fatto il deploy della Edge Function (vedi README).</p>
        {notifState === 'unsupported' ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">Questo browser non supporta le notifiche push.</p>
        ) : notifState === 'unconfigured' ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Notifiche non ancora configurate: imposta <span className="font-mono text-[13px]">VITE_VAPID_PUBLIC_KEY</span> nel file <span className="font-mono text-[13px]">.env</span>.</p>
        ) : notifState === 'denied' ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">Le notifiche sono bloccate per questo sito. Sbloccale dalle impostazioni del browser per poterle attivare.</p>
        ) : (
          <button
            onClick={toggleNotifications}
            disabled={notifBusy || notifState === 'loading'}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-medium disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color] ${notifState === 'enabled' ? 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
          >
            {notifState === 'enabled'
              ? <><BellOff className="w-4 h-4" aria-hidden="true" /> {notifBusy ? 'Attendere...' : 'Disattiva notifiche'}</>
              : <><Bell className="w-4 h-4" aria-hidden="true" /> {notifBusy ? 'Attendere...' : notifState === 'loading' ? 'Verifica...' : 'Attiva notifiche su questo dispositivo'}</>}
          </button>
        )}
      </section>

      {/* DATI E BACKUP */}
      <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-600 flex items-center justify-center shrink-0">
            <DatabaseBackup className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Dati e backup</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Scarica una copia dei tuoi dati. Il backup <strong>JSON</strong> contiene tutto (fondi, entrate, spese ricorrenti, budget, transazioni, impostazioni); il <strong>CSV</strong> è comodo da aprire in Excel/Fogli Google.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => handleExport('json')} disabled={exporting} className="flex items-center justify-center gap-2 flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]">
            <Download className="w-4 h-4" aria-hidden="true" /> {exporting ? 'Esporto...' : 'Backup completo (JSON)'}
          </button>
          <button onClick={() => handleExport('csv')} disabled={exporting} className="flex items-center justify-center gap-2 flex-1 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]">
            <FileDown className="w-4 h-4" aria-hidden="true" /> Transazioni (CSV)
          </button>
        </div>
      </section>

      {/* RICALCOLA SALDI */}
      <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
            <RefreshCcw className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Ricalcola saldi</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Ricostruisce i saldi dei fondi dal registro delle transazioni (saldo iniziale + movimenti reali). Usalo se un saldo non torna — ad esempio dopo un errore di rete a metà operazione. Richiede di aver eseguito una volta <span className="font-mono text-[13px] text-blue-600">supabase-reconcile.sql</span> su Supabase.</p>
        <button onClick={handleRecompute} disabled={recomputing} className="flex items-center justify-center gap-2 w-full py-2.5 bg-white text-amber-700 border border-amber-300 rounded-lg font-medium hover:bg-amber-50 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]">
          <RefreshCcw className="w-4 h-4" aria-hidden="true" /> {recomputing ? 'Ricalcolo...' : 'Ricalcola saldi dei fondi'}
        </button>
      </section>

      {/* RICOMINCIA DA OGGI */}
      <section className="rounded-2xl border border-red-200 shadow-sm p-4 sm:p-6" style={{ background: 'linear-gradient(135deg, #ef44441A 0%, #ffffff 60%)' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-600 flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold text-slate-900 tracking-tight">Ricomincia da oggi</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Azzera lo storico e riparti pulito dal periodo corrente.</p>

        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-1 mb-4">
          <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> <span><strong>Cosa viene eliminato</strong>: tutti i movimenti registrati (entrate, uscite, trasferimenti) e le pianificate <strong>già scadute</strong>. Operazione <strong>non reversibile</strong>.</span></p>
          <p className="ml-6"><strong>Cosa resta</strong>: fondi, entrate, spese ricorrenti, budget e le pianificate <strong>future</strong>. I saldi dei fondi restano invariati — reimpostali nella pagina <strong>Fondi</strong>.</p>
          <p className="ml-6">Le spese ricorrenti scadute <strong>prima di oggi</strong> non verranno più mostrate: il periodo riparte da oggi.</p>
        </div>

        <button
          onClick={doReset}
          disabled={resetting}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-[transform,background-color]"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> {resetting ? 'In corso...' : 'Ricomincia da oggi'}
        </button>
      </section>
    </div>
  )
}
