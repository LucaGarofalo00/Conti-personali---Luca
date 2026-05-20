import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  missingColumns: string[]
  onDismiss?: () => void
}

export default function SchemaBanner({ missingColumns, onDismiss }: Props) {
  const [open, setOpen] = useState(true)
  if (!open || missingColumns.length === 0) return null

  return (
    <div className="mb-6 bg-amber-50 border border-amber-300 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-amber-800 mb-1">API Supabase non riconosce le colonne</p>
          <p className="text-sm text-amber-700 mb-2">
            L'API REST non trova: <span className="font-mono text-xs">{missingColumns.join(', ')}</span>.
          </p>
          <p className="text-sm text-amber-700 mb-2">
            <strong>Se le colonne esistono già</strong> nel database (verifica con la query in fondo), il problema è la <strong>cache dello schema PostgREST</strong>. Su Supabase: <strong>Settings → API → Reload schema cache</strong>. Oppure esegui questa SQL nell'SQL Editor:
          </p>
          <pre className="bg-white/60 border border-amber-200 rounded p-2 mb-2 text-xs overflow-x-auto">NOTIFY pgrst, 'reload schema';</pre>
          <details className="text-xs text-amber-700">
            <summary className="cursor-pointer font-medium">Se invece le colonne non esistono → SQL completo</summary>
            <pre className="bg-white/60 border border-amber-200 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap">{`alter table transactions add column if not exists is_planned boolean not null default false;
alter table transactions add column if not exists recurring_expense_id uuid references recurring_expenses(id) on delete set null;
alter table transactions add column if not exists recurring_income_id uuid references recurring_income(id) on delete set null;
alter table transactions add column if not exists is_memo boolean not null default false;
alter table transactions add column if not exists budget_id uuid references weekly_budgets(id) on delete set null;
alter table transactions add column if not exists fund_to_id uuid references funds(id) on delete set null;
alter table transactions add column if not exists fuel_km numeric(10,2);
alter table transactions add column if not exists fuel_liters numeric(10,2);
alter table transactions add column if not exists fuel_price_per_liter numeric(10,3);
alter table recurring_expenses add column if not exists auto_deduct boolean not null default false;
alter table recurring_expenses add column if not exists fund_to_id uuid references funds(id) on delete set null;
alter table recurring_expenses add column if not exists type text not null default 'expense';
alter table recurring_expenses add column if not exists end_date date;
NOTIFY pgrst, 'reload schema';`}</pre>
          </details>
        </div>
        <button onClick={() => { setOpen(false); onDismiss?.() }} className="p-1 rounded hover:bg-amber-100 text-amber-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
