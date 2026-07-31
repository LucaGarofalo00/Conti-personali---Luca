import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'production' ? '/conti/' : '/',
  build: {
    rollupOptions: {
      output: {
        // Le dipendenze esterne cambiano molto più di rado del codice dell'app. Separandole,
        // un rilascio invalida solo il chunk dell'app: React e Supabase restano nella cache del
        // browser fra un aggiornamento e l'altro. In più i tre file si scaricano in parallelo,
        // invece di un unico blocco da 465 KB.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (id.includes('@supabase')) return 'supabase'
        },
      },
    },
  },
}))
