import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Le pagine caricano i dati con un effect `useEffect(() => { if (user) load() }, [user])`.
      // `load` è async (i setState avvengono dopo l'await, non in modo sincrono) ed è
      // condivisa con gli event handler, quindi non può vivere dentro l'effect. La regola
      // segnala questo pattern legittimo come falso positivo: la disattiviamo qui.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
