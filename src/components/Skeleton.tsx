// Segnaposto di caricamento. Sostituiscono il testo "Caricamento..." centrato: mostrando fin da
// subito la forma della pagina, l'attesa sembra più breve e il contenuto non "salta" all'arrivo dei
// dati (nessun cambio di layout). aria-hidden perché sono decorativi: l'annuncio per gli screen
// reader lo fa il contenitore con aria-busy.

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />
}

/** Involucro standard: annuncia lo stato di caricamento a chi usa uno screen reader. */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Caricamento in corso">
      {children}
    </div>
  )
}

/** Riquadro card generico (titolo + due righe). */
export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ${className}`}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  )
}

/** Elenco di righe (transazioni, fondi, ricorrenti…). */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <Skeleton className="h-4 w-36" />
      <div className="mt-4 space-y-3.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Scheletro della Dashboard: hero + griglia fondi + grafico + elenco. */
export function SkeletonDashboard() {
  return (
    <SkeletonPage>
      <div className="mb-4 rounded-3xl bg-slate-200/70 p-5 sm:p-8 animate-pulse" style={{ minHeight: 196 }} aria-hidden="true" />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-[250px] w-full" />
        </div>
        <SkeletonList rows={4} />
      </div>
    </SkeletonPage>
  )
}

/** Scheletro generico per le pagine a elenco (Fondi, Ricorrenti, Entrate, Budget, Transazioni). */
export function SkeletonListPage({ cards = 0, rows = 6 }: { cards?: number; rows?: number }) {
  return (
    <SkeletonPage>
      {cards > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
      <SkeletonList rows={rows} />
    </SkeletonPage>
  )
}
