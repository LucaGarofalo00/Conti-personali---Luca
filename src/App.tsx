import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { isConfigured } from './lib/supabase'
import { useAmountsHidden } from './lib/privacy'
import { usePeriodSettings } from './lib/periodSettings'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Logo from './components/Logo'
import Auth from './pages/Auth'

// Schermata di avvio: sostituisce il testo "Caricamento..." su fondo grigio. Mostra il marchio
// mentre si recupera la sessione, così l'apertura dell'app (specie installata come PWA, dove non
// c'è la chrome del browser a dare contesto) non è una pagina vuota con una scritta.
function BootScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50" role="status" aria-label="Caricamento in corso">
      <Logo className="w-14 h-14 drop-shadow-sm animate-[fadeIn_0.4s_ease-out]" />
      <div aria-hidden="true" className="h-1 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-1/2 rounded-full bg-primary-600 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
      </div>
    </div>
  )
}

// Caricate on-demand: ogni pagina è un chunk separato, così Recharts (Dashboard/Previsione)
// e le altre viste non pesano sul caricamento iniziale.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Funds = lazy(() => import('./pages/Funds'))
const RecurringExpenses = lazy(() => import('./pages/RecurringExpenses'))
const Income = lazy(() => import('./pages/Income'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Forecast = lazy(() => import('./pages/Forecast'))
const Stats = lazy(() => import('./pages/Stats'))
const Settings = lazy(() => import('./pages/Settings'))

function SetupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f7f8fa' }}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-sm border border-slate-200/60 p-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 mb-1">FinanzApp</h1>
        <p className="text-slate-500 text-sm mb-6">Configura Supabase per iniziare</p>
        <div className="space-y-3 text-sm">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="font-medium text-slate-700 mb-1.5">1. Vai su Supabase</p>
            <p className="text-slate-500 text-[13px]">Apri il tuo progetto su <span className="font-mono text-blue-600">supabase.com</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="font-medium text-slate-700 mb-1.5">2. Trova le credenziali</p>
            <p className="text-slate-500 text-[13px]">Vai in <span className="font-mono">Settings &gt; API</span> e copia <strong>Project URL</strong> e <strong>anon public key</strong></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="font-medium text-slate-700 mb-1.5">3. Esegui lo schema SQL</p>
            <p className="text-slate-500 text-[13px]">Vai in <span className="font-mono">SQL Editor</span> e incolla il contenuto di <span className="font-mono text-blue-600">supabase-schema.sql</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="font-medium text-slate-700 mb-1.5">4. Crea il file .env</p>
            <p className="text-slate-500 text-[13px] mb-2">Nella root del progetto, crea un file <span className="font-mono text-blue-600">.env</span> con:</p>
            <pre className="bg-slate-800 text-slate-100 rounded-lg p-3 text-xs overflow-x-auto">
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}
            </pre>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-amber-700 text-[13px]">Dopo aver creato il file <span className="font-mono">.env</span>, riavvia il dev server con <span className="font-mono">npm run dev</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <BootScreen />
  if (!user) return <Navigate to="/auth" replace />
  return (
    <Layout>
      {/* Il fallback è vuoto di proposito: ogni pagina mostra già il proprio scheletro appena
          montata, e uno spinner intermedio aggiungerebbe solo un lampeggio fra i due stati. */}
      <Suspense fallback={<div className="h-64" />}>
        {children}
      </Suspense>
    </Layout>
  )
}

function AuthRoute() {
  const { user, loading } = useAuth()
  if (loading) return <BootScreen />
  if (user) return <Navigate to="/" replace />
  return <Auth />
}

function AppRoutes() {
  // Sottoscrizione alla privacy importi qui in cima: al toggle, AppRoutes si ri-renderizza e
  // ricrea l'intero albero delle route, così ogni pagina rilegge cur() col nuovo stato.
  useAmountsHidden()
  // Stessa logica per le impostazioni del periodo: all'idratazione dal DB o alla conferma di un
  // nuovo stipendio, tutte le pagine rileggono getBillingPeriod() col periodo aggiornato.
  usePeriodSettings()
  // Se si arriva da un link di recupero password, mostra la schermata "Imposta nuova password"
  // a prescindere dalla route (altrimenti la sessione di recupero finirebbe dritta in Dashboard).
  const { recovery } = useAuth()
  if (recovery) return <Auth recovery />
  return (
    <Routes>
      <Route path="/auth" element={<AuthRoute />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/fondi" element={<ProtectedRoute><Funds /></ProtectedRoute>} />
      <Route path="/spese-ricorrenti" element={<ProtectedRoute><RecurringExpenses /></ProtectedRoute>} />
      <Route path="/entrate" element={<ProtectedRoute><Income /></ProtectedRoute>} />
      <Route path="/budget" element={<ProtectedRoute><Budgets /></ProtectedRoute>} />
      <Route path="/transazioni" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
      <Route path="/previsione" element={<ProtectedRoute><Forecast /></ProtectedRoute>} />
      <Route path="/statistiche" element={<ProtectedRoute><Stats /></ProtectedRoute>} />
      <Route path="/impostazioni" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      {/* Rotta catch-all: un hash sconosciuto (bookmark stale, refuso) torna alla Dashboard
          invece di lasciare una pagina bianca senza via d'uscita. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (!isConfigured) return <SetupPage />

  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  )
}
