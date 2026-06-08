export interface Fund {
  id: string
  user_id: string
  name: string
  type: 'main' | 'sub'
  parent_id: string | null
  balance: number
  icon: string
  color: string
  sort_order: number
  created_at: string
}

export interface RecurringExpense {
  id: string
  user_id: string
  name: string
  amount: number
  frequency: 'monthly' | 'weekly' | 'yearly'
  day_of_month: number | null
  day_of_week: number | null
  month_of_year: number | null
  fund_id: string | null
  fund_to_id: string | null
  category: string
  type: 'expense' | 'transfer'
  is_active: boolean
  auto_deduct: boolean
  start_date: string | null
  end_date: string | null
  created_at: string
}

export interface RecurringIncome {
  id: string
  user_id: string
  name: string
  amount: number
  is_variable: boolean
  frequency: 'monthly' | 'weekly'
  day_of_month: number | null
  day_of_week: number | null
  delay_days: number
  fund_id: string | null
  is_active: boolean
  start_date: string | null
  end_date: string | null
  created_at: string
}

export interface WeeklyBudget {
  id: string
  user_id: string
  name: string
  amount: number
  fund_id: string | null
  is_active: boolean
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description: string
  fund_id: string | null
  fund_to_id: string | null
  category: string
  budget_id: string | null
  recurring_expense_id: string | null
  recurring_income_id: string | null
  is_memo: boolean
  is_planned: boolean
  fuel_km: number | null
  fuel_liters: number | null
  fuel_price_per_liter: number | null
  fuel_type: 'benzina' | 'gpl' | null
  date: string
  // Data prevista dell'occorrenza che questa transazione salda (es. il giorno di scadenza
  // della spesa ricorrente). `date` resta la data EFFETTIVA in cui è stata registrata e che
  // conta nei saldi/totali; `planned_date` serve solo a riagganciare l'occorrenza giusta
  // anche se l'ho segnata giorni prima o dopo. Opzionale: assente sui movimenti manuali e sui
  // DB non ancora migrati.
  planned_date?: string | null
  created_at: string
}


export interface ForecastPoint {
  date: string
  balance: number
  income: number
  expenses: number
  label: string
}
