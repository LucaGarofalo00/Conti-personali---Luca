# FinanzApp

App di finanze personali (React 19 + Vite + Tailwind v4 + Supabase). Pensata principalmente per l'uso da **mobile**.

## Setup

1. **Variabili d'ambiente** — crea un file `.env` nella root:
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```
2. **SQL su Supabase** (SQL Editor) — esegui i file in quest'ordine:
   - `supabase-schema.sql` — tabelle, RLS, indici (idempotente, rieseguibile).
   - `supabase-rpc-balances.sql` — aggiornamenti di saldo **atomici** (consigliato).
   - `supabase-user-settings.sql` — tabella impostazioni periodo.
   - `supabase-reconcile.sql` — **(opzionale)** abilita il pulsante "Ricalcola saldi" in Impostazioni: aggiunge `funds.opening_balance` e le RPC `recompute_fund_balances` / `set_fund_opening_balance`. Da eseguire una volta; il backfill iniziale non modifica i saldi.
   - `supabase-post-transaction.sql` — **(opzionale)** RPC `post_transaction` che inserisce un movimento e aggiorna i saldi in **un'unica transazione DB** (vedi il file per come adottarla lato client).
   - `supabase-notifications.sql` — **(opzionale)** tabella sottoscrizioni push per i promemoria scadenze (vedi sotto).
   - `supabase-categories.sql` — **(opzionale)** tabella `custom_categories` per le categorie personalizzate (Impostazioni → "Categorie personalizzate").
3. `npm install && npm run dev`

## Notifiche push (promemoria scadenze) — opzionale

Manda un promemoria quando una voce ricorrente scade, anche ad app chiusa.

1. Genera le chiavi VAPID: `npx web-push generate-vapid-keys`
2. Frontend `.env`: `VITE_VAPID_PUBLIC_KEY=<public key>`
3. Esegui `supabase-notifications.sql` (tabella `push_subscriptions`).
4. Deploy della Edge Function:
   ```
   supabase functions deploy send-reminders
   supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:tu@esempio.it
   ```
5. Pianifica l'esecuzione giornaliera (blocco `pg_cron` commentato in fondo a `supabase-notifications.sql`).
6. In app: Impostazioni → "Notifiche promemoria" → Attiva.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Dev server (Vite + HMR) |
| `npm run build` | Typecheck (`tsc -b`) + build di produzione |
| `npm run lint` | ESLint |
| `npm test` | Test unitari (Vitest) |

## Funzionalità principali

Fondi e salvadanai, spese ricorrenti (mensili/settimanali/annuali, anche automatiche e trasferimenti), entrate ricorrenti, budget settimanali, transazioni con consumi carburante, previsione del saldo, **statistiche retrospettive** (uscite per categoria + andamento mensile), **export/backup** (JSON completo + CSV transazioni) e **ricalcolo saldi** dal registro. Periodo ancorato allo stipendio. Privacy importi (toggle "occhio").

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
