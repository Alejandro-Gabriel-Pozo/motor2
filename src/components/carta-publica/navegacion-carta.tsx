"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconFacebook, IconInstagram, IconMaps, IconWhatsApp } from "./iconos";

/**
 * ADR-006, Fase 3: mecánica de navegación de la carta pública (slider horizontal con scroll-snap, una "página" por
 * sección) — desenredado de `restaurant-menu-design/components/carta-controls/` (`index.tsx` + `carta-nav.tsx` +
 * `carta-topbar.tsx`, fusionados en un solo archivo). Cambios respecto del original (ADR-006, diagnóstico de UI ofuscada):
 *
 * - Las páginas (`paginas`) las arma el SERVIDOR a partir de los datos reales (`carta.secciones`), no se descubren con
 *   `querySelectorAll("[data-page]")` después de montar — un id de sección que empezara con "portada" ya no rompería nada.
 * - El `ResizeObserver` se desconecta de verdad en el cleanup de `useEffect` (el original decía "cleanup implícito" y
 *   nunca llamaba `.disconnect()`).
 * - Imprimir es un `window.print()` directo: el `@media print` de `.carta-shell` (`src/app/globals.css`) ya cubre el
 *   layout impreso, no hace falta el estado `printing` + doble `requestAnimationFrame` del original.
 */

export interface PaginaCarta {
  id: string;
  tipo: "portada" | "indice" | "seccion";
}

export interface RedSocial {
  id: "instagram" | "whatsapp" | "maps" | "facebook";
  href: string;
  label: string;
}

const ICONO_POR_RED: Record<RedSocial["id"], (props: { className?: string }) => React.ReactElement> = {
  instagram: IconInstagram,
  whatsapp: IconWhatsApp,
  maps: IconMaps,
  facebook: IconFacebook,
};

interface Props {
  children: ReactNode;
  paginas: PaginaCarta[];
  /** A dónde vuelve el link "← Menú" del topbar: el portal de la empresa. */
  hrefVolver: string;
  redesSociales: readonly RedSocial[];
  /** `EstiloCarta.variablesCss` (`src/core/carta/estilo.ts`): pisa los defaults de `.carta-shell` para ESTA sucursal. */
  variablesCss: Readonly<Record<string, string>>;
}

export function NavegacionCarta({ children, paginas, hrefVolver, redesSociales, variablesCss }: Props) {
  const sliderRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const actualizarAltoNav = () => nav.style.setProperty("--carta-nav-h-local", `${nav.offsetHeight}px`);
    actualizarAltoNav();
    const ro = new ResizeObserver(actualizarAltoNav);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = sliderRef.current;
    if (!el || el.clientWidth === 0) return;
    setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  const irA = useCallback((idx: number) => {
    const el = sliderRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  }, []);

  const irAId = useCallback((id: string) => {
    const idx = paginas.findIndex((p) => p.id === id);
    if (idx !== -1) irA(idx);
  }, [paginas, irA]);

  const total = paginas.length;
  const pagina = paginas[current];
  const esPortada = pagina?.tipo === "portada";
  const esSeccion = pagina?.tipo === "seccion";
  const hayRedes = redesSociales.length > 0;

  return (
    <div className="relative h-svh w-full overflow-hidden" style={variablesCss as React.CSSProperties}>
      <header
        data-carta-topbar
        className="absolute left-0 right-0 top-0 z-40 flex h-10 items-center justify-between border-b px-3 backdrop-blur-sm"
        style={{ backgroundColor: "color-mix(in oklch, var(--carta-bg) 88%, transparent)", borderColor: "var(--carta-border)" }}
      >
        <Link href={hrefVolver} className="text-xs font-light uppercase tracking-[0.3em] opacity-60 transition-opacity hover:opacity-90">
          ← Menú
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Imprimir carta"
          className="flex h-8 w-8 items-center justify-center rounded-full opacity-50 transition-opacity hover:opacity-90"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M6 9V2h12v7" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
        </button>
      </header>

      <main
        ref={sliderRef}
        onScroll={onScroll}
        className="carta-slider h-full w-full"
        onClickCapture={(e) => {
          const boton = (e.target as HTMLElement).closest<HTMLElement>("[data-ir-a]");
          if (boton?.dataset.irA) irAId(boton.dataset.irA);
        }}
      >
        {children}
      </main>

      {total > 1 && (
        <nav
          ref={navRef}
          data-carta-nav
          aria-label="Navegación de la carta"
          className="absolute bottom-0 left-0 right-0 z-40 border-t backdrop-blur-sm"
          style={{ backgroundColor: "color-mix(in oklch, var(--carta-bg) 90%, transparent)", borderColor: "var(--carta-border)" }}
        >
          <div className="flex h-14 items-center justify-between px-3">
            <button
              type="button"
              onClick={() => irA(Math.max(0, current - 1))}
              disabled={current === 0}
              aria-label="Página anterior"
              className="flex h-11 w-11 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:opacity-20"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>

            <div className="flex flex-col items-center gap-1">
              {esPortada ? (
                hayRedes && (
                  <div className="flex items-center gap-4">
                    {redesSociales.map((r) => {
                      const Icono = ICONO_POR_RED[r.id];
                      return (
                        <a key={r.id} href={r.href} target="_blank" rel="noopener noreferrer" aria-label={r.label} className="flex h-10 w-10 items-center justify-center rounded-full opacity-55 transition-opacity hover:opacity-100">
                          <Icono />
                        </a>
                      );
                    })}
                  </div>
                )
              ) : esSeccion ? (
                <button
                  type="button"
                  onClick={() => irAId("indice")}
                  className="flex h-9 min-w-[80px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-medium uppercase tracking-[0.3em]"
                  style={{ backgroundColor: "color-mix(in oklch, var(--carta-primary) 12%, transparent)", color: "var(--carta-primary)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  Índice
                </button>
              ) : (
                <p className="text-[11px] font-light opacity-60">
                  {current + 1} / {total}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => irA(Math.min(total - 1, current + 1))}
              disabled={current === total - 1}
              aria-label="Página siguiente"
              className="flex h-11 w-11 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:opacity-20"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {!esPortada && hayRedes && (
            <div className="flex items-center justify-center gap-6 border-t py-2" style={{ borderColor: "var(--carta-border)" }}>
              {redesSociales.map((r) => {
                const Icono = ICONO_POR_RED[r.id];
                return (
                  <a key={r.id} href={r.href} target="_blank" rel="noopener noreferrer" aria-label={r.label} className="flex h-8 w-8 items-center justify-center opacity-40 transition-opacity hover:opacity-100">
                    <Icono />
                  </a>
                );
              })}
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
