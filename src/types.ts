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
  day_of_month: number
  fund_id: string | null
  fund_to_id: string | null
  category: string
  type: 'expense' | 'transfer'
  is_active: boolean
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

export interface VariableExpense {
  id: string
  user_id: string
  name: string
  estimated_amount: number
  frequency: 'weekly' | 'monthly'
  fund_id: string | null
  category: string
  is_active: boolean
  needs_confirmation: boolean
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
  is_memo: boolean
  date: string
  created_at: string
}

export interface ForecastPoint {
  date: string
  balance: number
  income: number
  expenses: number
  label: string
}
