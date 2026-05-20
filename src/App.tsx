import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import { isConfigured } from './lib/supabase'
import Layout from './components/Layout'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Funds from './pages/Funds'
import RecurringExpenses from './pages/RecurringExpenses'
import Income from './pages/Income'
import Budgets from './pages/Budgets'
import Transactions from './pages/Transactions'
import Forecast from './pages/Forecast'

function SetupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f7f8fa' }}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-sm border border-slate-200/60 p-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 mb-1">FinanzApp</h1>
        <p className="text-slate-400 text-sm mb-6">Configura Supabase per iniziare</p>
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
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm" style={{ backgroundColor: '#f7f8fa' }}>Caricamento...</div>
  if (!user) return <Navigate to="/auth" replace />
  return <Layout>{children}</Layout>
}

function AuthRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm" style={{ backgroundColor: '#f7f8fa' }}>Caricamento...</div>
  if (user) return <Navigate to="/" replace />
  return <Auth />
}

function AppRoutes() {
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
    </Routes>
  )
}

export default function App() {
  if (!isConfigured) return <SetupPage />

  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  )
}
