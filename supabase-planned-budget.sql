-- ---------------------------------------------------------------------------
-- Spese pianificate come "budget a progetto"
-- ---------------------------------------------------------------------------
-- Una spesa pianificata (transactions.is_planned = true) può fare da tetto di spesa: i movimenti
-- reali che ne fanno parte si agganciano con planned_parent_id e ne consumano il residuo.
-- Es. "Vacanza Calabria 350 €": ogni acquisto legato alla vacanza scala il residuo, e finché non
-- si sfora il totale del periodo resta 350 € (residuo + speso = tetto).
--
-- Differenza dai budget settimanali (weekly_budgets): quelli sono una quota che si RIPETE ogni
-- settimana; questo è un tetto UNA TANTUM che si consuma fino a esaurimento.
--
-- Sicuro da rieseguire più volte (idempotente). Finché non viene applicata, l'app continua a
-- funzionare: rileva l'assenza della colonna e disattiva la funzione.

alter table transactions
  add column if not exists planned_parent_id uuid references transactions(id) on delete set null;

-- Le spese di una pianificata si leggono sempre filtrando per il padre.
create index if not exists transactions_planned_parent_id_idx
  on transactions (planned_parent_id)
  where planned_parent_id is not null;

comment on column transactions.planned_parent_id is
  'Spesa pianificata (is_planned=true) di cui questo movimento fa parte. Ne consuma il residuo: vedi src/lib/plannedBudget.ts';
