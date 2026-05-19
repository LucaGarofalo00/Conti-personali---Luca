import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'https://your-project.supabase.co')

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder')
