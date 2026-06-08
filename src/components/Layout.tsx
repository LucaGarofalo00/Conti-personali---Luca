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
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/40">
      {open && <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-white/90 backdrop-blur-xl shadow-[1px_0_0_0_#e8eaed] transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-5">
            <div className="flex items-center gap-2.5">
              <Logo className="w-9 h-9 drop-shadow-sm" />
              <h1 className="text-lg font-semibold tracking-tight text-slate-800">FinanzApp</h1>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Chiudi menu" className="lg:hidden p-1 rounded-md hover:bg-slate-100 text-slate-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 px-3 space-y-0.5">
            {nav.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-600/25'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'
                  }`
                }
              >
                <item.icon className="w-[18px] h-[18px]" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="px-3 py-4">
            <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">
              <LogOut className="w-[18px] h-[18px]" />
              Esci
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 bg-white/80 backdrop-blur-xl z-30 shrink-0 shadow-[0_1px_0_0_#e8eaed]">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-6">
            <button onClick={() => setOpen(true)} aria-label="Apri menu" className="lg:hidden p-1 rounded-md hover:bg-slate-100">
              <Menu className="w-5 h-5 text-slate-500" />
            </button>
            <Logo className="w-7 h-7 lg:hidden" />
            <span className="font-semibold text-slate-800 text-[15px] tracking-tight">{pageTitle}</span>
            <button
              onClick={toggleAmountsHidden}
              aria-label={amountsHidden ? 'Mostra gli importi' : 'Nascondi gli importi'}
              aria-pressed={amountsHidden}
              title={amountsHidden ? 'Mostra gli importi' : 'Nascondi gli importi'}
              className="ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              {amountsHidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
