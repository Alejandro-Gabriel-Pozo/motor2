/**
 * Esqueleto de carga de la pantalla de una mesa (pendiente #44). Va en el segmento `[mesaId]` y no en `mesas/`: así los filtros del mapa (mismo segmento,
 * otros `searchParams`) no hacen parpadear el esqueleto. Usa los tokens del sistema visual (contraste medido; el salón no tiene modo oscuro) y no lleva
 * `role="status"`: los specs del salón buscan `[role="status"][aria-live="polite"]` en toda la página.
 */
export default function CargandoMesa() {
  return (
    <div aria-busy="true" className="animate-pulse space-y-3">
      <div className="h-5 w-24 rounded bg-borde" />
      <div className="h-8 w-64 max-w-full rounded bg-borde" />
      <div className="h-48 w-full rounded bg-borde" />
      <p className="text-[13px] text-tinta-suave">Cargando…</p>
    </div>
  );
}
