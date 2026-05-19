import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, CreditCard, TrendingUp,
  PiggyBank, ArrowLeftRight, LineChart, LogOut, Menu, X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const nav = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/fondi', label: 'Fondi', icon: Wallet },
  { path: '/spese-ricorrenti', label: 'Spese Ricorrenti', icon: CreditCard },
  { path: '/entrate', label: 'Entrate', icon: TrendingUp },
  { path: '/budget', label: 'Budget', icon: PiggyBank },
  { path: '/transazioni', label: 'Transazioni', icon: ArrowLeftRight },
  { path: '/previsione', label: 'Previsione', icon: LineChart },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth')
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {open && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h1 className="text-xl font-bold text-indigo-600">FinanzApp</h1>
            <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {nav.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`
                }
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="p-3 border-t border-slate-200">
            <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors">
              <LogOut className="w-5 h-5" />
              Esci
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 bg-white/80 backdrop-blur border-b border-slate-200 z-30 lg:hidden">
          <div className="flex items-center p-4">
            <button onClick={() => setOpen(true)}>
              <Menu className="w-5 h-5 text-slate-600" />
            </button>
            <span className="ml-3 font-semibold text-slate-800">FinanzApp</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
