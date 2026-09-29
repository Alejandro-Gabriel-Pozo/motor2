import Link from "next/link";
import type { EntradaPortalCarta } from "@/core/carta/public-servidor";

/**
 * ADR-006, Fase 3: portal de sucursales de una empresa — reemplaza `restaurant-menu-design/app/page.tsx`. Sin el "modo
 * mapa" del original (`bgImage`): en la práctica esa rama nunca se activaba (la config raíz que la habilitaba no existía
 * en el contrato), así que no se porta código muerto — queda un listado en grilla, siempre.
 */
export function PortalVista({ sucursales, empresaSlug }: { sucursales: readonly EntradaPortalCarta[]; empresaSlug: string }) {
  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-10">
      <h1 className="sr-only">Sucursales</h1>
      {sucursales.length === 0 ? (
        <p className="text-center text-sm opacity-60">Todavía no hay cartas publicadas.</p>
      ) : (
        <ul className="grid gap-3" role="list">
          {sucursales.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/carta-publica/${empresaSlug}/${s.slug}`}
                className="flex items-center justify-between rounded-xl border p-4 shadow-sm transition-transform active:scale-[0.98]"
                style={{ borderColor: "var(--carta-border)" }}
              >
                <div>
                  <p className="font-serif text-lg font-medium">{s.etiqueta}</p>
                  {s.subtitulo && <p className="mt-0.5 text-xs opacity-60">{s.subtitulo}</p>}
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
