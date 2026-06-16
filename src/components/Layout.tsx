import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, CreditCard, TrendingUp,
  PiggyBank, ArrowLeftRight, LineChart, LogOut, Menu, X, Eye, EyeOff, Settings,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useAmountsHidden, toggleAmountsHidden } from '../lib/privacy'
import Logo from './Logo'

const nav = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/fondi', label: 'Fondi', icon: Wallet },
  { path: '/spese-ricorrenti', label: 'Spese Ricorrenti', icon: CreditCard },
  { path: '/entrate', label: 'Entrate', icon: TrendingUp },
  { path: '/budget', label: 'Budget', icon: PiggyBank },
  { path: '/transazioni', label: 'Transazioni', icon: ArrowLeftRight },
  { path: '/previsione', label: 'Previsione', icon: LineChart },
  { path: '/impostazioni', label: 'Impostazioni', icon: Settings },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const amountsHidden = useAmountsHidden()

  const currentPage = nav.find(n => n.path === location.pathname)
  const pageTitle = currentPage?.label || 'FinanzApp'

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth')
  }

  return (
    <div className="flex h-dvh bg-gradient-to-br from-slate-50 via-white to-violet-50/40">
      {open && <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden animate-[fadeIn_0.2s_ease-out]" onClick={() => setOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-[min(17rem,82vw)] pt-safe pb-safe pl-safe bg-gradient-to-b from-white via-white to-indigo-50/50 backdrop-blur-xl border-r border-slate-200/70 transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 pt-6 pb-5">
            <div className="flex items-center gap-3">
              <Logo className="w-10 h-10 drop-shadow-sm" />
              <div className="leading-tight">
                <h1 className="text-[17px] font-bold tracking-tight text-slate-900">FinanzApp</h1>
                <p className="text-[11px] text-slate-400 font-medium">Finanze personali</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Chiudi menu" className="lg:hidden -mr-1.5 inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors active:scale-90">
              <X aria-hidden="true" className="w-5 h-5" />
            </button>
          </div>

          <p className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Menu</p>
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {nav.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                    isActive
                      ? 'bg-brand text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white hover:shadow-sm'
                  }`
                }
              >
                <item.icon aria-hidden="true" className="w-[18px] h-[18px] shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="px-3 py-4 mt-2 border-t border-slate-200/70">
            <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors active:scale-[0.98]">
              <LogOut aria-hidden="true" className="w-[18px] h-[18px]" />
              Esci
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 bg-white/75 backdrop-blur-xl z-30 shrink-0 border-b border-slate-200/70 pt-safe pl-safe pr-safe">
          <div className="flex items-center gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3.5 lg:px-8">
            <button onClick={() => setOpen(true)} aria-label="Apri menu" className="lg:hidden -ml-1 inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg hover:bg-slate-100 transition-colors active:scale-90">
              <Menu aria-hidden="true" className="w-5 h-5 text-slate-600" />
            </button>
            <Logo className="w-7 h-7 shrink-0 lg:hidden" />
            <h2 className="min-w-0 truncate font-bold text-slate-900 text-lg sm:text-xl tracking-tight">{pageTitle}</h2>
            <button
              onClick={toggleAmountsHidden}
              aria-label={amountsHidden ? 'Mostra gli importi' : 'Nascondi gli importi'}
              aria-pressed={amountsHidden}
              title={amountsHidden ? 'Mostra gli importi' : 'Nascondi gli importi'}
              className="ml-auto shrink-0 inline-flex items-center justify-center gap-2 h-10 w-10 sm:w-auto sm:px-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 transition-colors active:scale-95 shadow-xs"
            >
              {amountsHidden ? <EyeOff aria-hidden="true" className="w-[18px] h-[18px]" /> : <Eye aria-hidden="true" className="w-[18px] h-[18px]" />}
              <span className="hidden sm:inline text-[13px] font-medium">{amountsHidden ? 'Mostra' : 'Nascondi'}</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1400px] pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
