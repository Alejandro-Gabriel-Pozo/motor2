/**
 * Esqueleto de carga de los reportes (pendiente #44). Va acá y no en `(app)`: un `loading.tsx` envuelve la página en un Suspense, y con eso un
 * `notFound()` posterior a un `await` deja de devolver 404; ninguna página bajo `reportes/` lo usa (lo verifica
 * `test/arquitectura/loading-sin-404.test.ts`). Sin `role="status"` a propósito: los specs buscan `getByRole("status")` en toda la página.
 */
export default function CargandoReportes() {
  return (
    <div aria-busy="true" className="animate-pulse space-y-3">
      <div className="h-6 w-56 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-4 w-80 max-w-full rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-40 w-full rounded bg-neutral-100 dark:bg-neutral-900" />
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Cargando…</p>
    </div>
  );
}
