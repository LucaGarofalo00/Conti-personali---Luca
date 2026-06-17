import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { useCustomCategories, mergeCategories, addCustomCategory } from '../lib/categories'
import { catLabel } from '../lib/utils'

// Select delle categorie con opzione "+ Aggiungi categoria…" in coda: se manca quella adatta,
// si crea al volo senza passare dalle Impostazioni. La nuova categoria viene salvata
// (custom_categories) e selezionata, e compare ovunque grazie allo store condiviso.

const ADD = '__add_category__'
const INPUT_CLASS = 'flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-shadow capitalize'

interface Props {
  value: string
  onChange: (value: string) => void
  baseCategories: string[]
  id?: string
  className?: string
}

export default function CategorySelect({ value, onChange, baseCategories, id, className }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const customCats = useCustomCategories()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const options = mergeCategories(baseCategories, customCats)

  const confirmAdd = async () => {
    if (!user) return
    const norm = name.trim().toLowerCase()
    if (!norm) return
    // Esiste già (default o personalizzata): selezionala senza ricrearla.
    if (options.includes(norm)) { onChange(norm); setAdding(false); setName(''); return }
    setBusy(true)
    const res = await addCustomCategory(user.id, name)
    setBusy(false)
    if (!res.ok) { toast.error(res.error || 'Errore'); return }
    onChange(norm)
    toast.success('Categoria aggiunta')
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <input
          id={id}
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmAdd() }
            else if (e.key === 'Escape') { setAdding(false); setName('') }
          }}
          placeholder="Nome nuova categoria"
          maxLength={30}
          className={INPUT_CLASS}
        />
        <button type="button" onClick={confirmAdd} disabled={busy || !name.trim()} aria-label="Conferma categoria" className="inline-flex items-center justify-center w-11 shrink-0 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 active:scale-90 transition-[transform,background-color]">
          <Check className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setAdding(false); setName('') }} aria-label="Annulla" className="inline-flex items-center justify-center w-11 shrink-0 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 active:scale-90 transition-[transform,background-color]">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <select
      id={id}
      value={value}
      onChange={e => { if (e.target.value === ADD) { setAdding(true); setName('') } else onChange(e.target.value) }}
      className={className}
    >
      {options.map(c => <option key={c} value={c} className="capitalize">{catLabel(c)}</option>)}
      <option value={ADD}>+ Aggiungi categoria…</option>
    </select>
  )
}
