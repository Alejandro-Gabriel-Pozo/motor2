"use client";

import Link from "next/link";
import type { EstiloCarta } from "@/core/carta/public";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { hayMasParaVer } from "./aviso-scroll";
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
  hrefVolver?: string;
  /** Texto, color y tamaño del botón de volver (`topbar_back_*`). */
  volver: EstiloCarta["volver"];
  /** `color_nav_iconos`: si está cargado, los íconos de redes salen de ESE color, sin la opacidad decorativa. */
  colorIconos: string | null;
  redesSociales: readonly RedSocial[];
  /** `EstiloCarta.variablesCss` (`src/core/carta/estilo.ts`): pisa los defaults de `.carta-shell` para ESTA sucursal. */
  variablesCss: Readonly<Record<string, string>>;
  /**
   * Vista previa dentro de otra página (el editor del tema, ADR-006 Fase 4): alto fijo en vez de `h-svh`, sin landmarks
   * propios (`header`/`main` — la página anfitriona ya tiene los suyos), "← Menú" sin link y sin botón de imprimir.
   */
  embebida?: boolean;
}

export function NavegacionCarta({ children, paginas, hrefVolver, volver, colorIconos, redesSociales, variablesCss, embebida = false }: Props) {
  const raizRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);
  const [hayMas, setHayMas] = useState(false);

  // El alto real de la nav (cambia con la fila de redes) se publica en la RAÍZ: lo heredan las páginas (`.carta-pagina` deja ese
  // relleno abajo) y el degradé del aviso de scroll se apoya justo encima.
  useEffect(() => {
    const nav = navRef.current;
    const raiz = raizRef.current;
    if (!nav || !raiz) return;
    const actualizarAltoNav = () => raiz.style.setProperty("--carta-nav-h-local", `${nav.offsetHeight}px`);
    actualizarAltoNav();
    const ro = new ResizeObserver(actualizarAltoNav);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  // ¿La página visible tiene más contenido por debajo? Se mira la propia página y sus listas con scroll propio (`data-carta-scroll`).
  // La portada no lleva aviso: su fondo no es --carta-bg y el degradé desentonaría.
  const recalcularAviso = useCallback(() => {
    const slider = sliderRef.current;
    if (!slider || slider.clientWidth === 0) return;
    const idx = Math.round(slider.scrollLeft / slider.clientWidth);
    const pag = slider.children[idx] as HTMLElement | undefined;
    if (!pag || paginas[idx]?.tipo === "portada") return setHayMas(false);
    const candidatos = [pag, ...pag.querySelectorAll<HTMLElement>("[data-carta-scroll]")];
    setHayMas(candidatos.some((el) => hayMasParaVer(el)));
  }, [paginas]);

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const ro = new ResizeObserver(recalcularAviso);
    ro.observe(slider);
    const inicial = requestAnimationFrame(recalcularAviso);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(inicial);
    };
  }, [recalcularAviso]);

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
    <div
      ref={raizRef}
      {...(embebida ? {} : { "data-carta-libro": "" })}
      className={`relative w-full overflow-hidden ${embebida ? "h-[32rem]" : "h-dvh"}`}
      // Los tokens del tema (`--carta-bg`, `--carta-ink`…) se pisan ACÁ, en un descendiente de `.carta-shell`: el fondo y el color
      // que `.carta-shell` pinta se resolvieron con SUS tokens, no con los del tema, así que la raíz los vuelve a pintar.
      style={{ ...variablesCss, backgroundColor: "var(--carta-bg)", color: "var(--carta-ink)" } as React.CSSProperties}
    >
      <Topbar embebida={embebida} hrefVolver={hrefVolver} volver={volver} />

      <Slider
        embebida={embebida}
        sliderRef={sliderRef}
        onScroll={onScroll}
        onScrollCapture={recalcularAviso}
        onClickCapture={(e) => {
          const boton = (e.target as HTMLElement).closest<HTMLElement>("[data-ir-a]");
          if (boton?.dataset.irA) irAId(boton.dataset.irA);
        }}
      >
        {children}
      </Slider>

      {hayMas && (
        <div
          data-carta-aviso-scroll
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-30 h-10"
          style={{ bottom: "var(--carta-nav-h-local, 3.5rem)", background: "linear-gradient(to top, var(--carta-bg), transparent)" }}
        />
      )}

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
              className={CLASE_FLECHA}
              style={ESTILO_FLECHA}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
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
                        <a key={r.id} href={r.href} target="_blank" rel="noopener noreferrer" aria-label={r.label} className={`flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-100${colorIconos ? "" : " opacity-55"}`} style={colorIconos ? { color: colorIconos } : undefined}>
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
              className={`${CLASE_FLECHA}${current < 2 && current < total - 1 ? " carta-nudge" : ""}`}
              style={ESTILO_FLECHA}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {!esPortada && hayRedes && (
            <div className="flex items-center justify-center gap-6 border-t py-2" style={{ borderColor: "var(--carta-border)" }}>
              {redesSociales.map((r) => {
                const Icono = ICONO_POR_RED[r.id];
                return (
                  <a key={r.id} href={r.href} target="_blank" rel="noopener noreferrer" aria-label={r.label} className={`flex h-8 w-8 items-center justify-center transition-opacity hover:opacity-100${colorIconos ? "" : " opacity-40"}`} style={colorIconos ? { color: colorIconos } : undefined}>
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

// Flechas de página: circulares, con borde y fondo tenues del color de marca (la portada y el índice son las páginas donde más
// hace falta ver que se puede deslizar). `--carta-flechas` lo pone `CartaVista` si el tema carga `color_nav_flechas`.
const CLASE_FLECHA = "flex h-12 w-12 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:opacity-25";
const ESTILO_FLECHA = {
  color: "var(--carta-flechas, var(--carta-primary))",
  borderColor: "color-mix(in oklch, var(--carta-flechas, var(--carta-primary)) 45%, transparent)",
  backgroundColor: "color-mix(in oklch, var(--carta-flechas, var(--carta-primary)) 10%, transparent)",
} as const;

const ESTILO_TOPBAR = { backgroundColor: "color-mix(in oklch, var(--carta-bg) 88%, transparent)", borderColor: "var(--carta-border)" } as const;
const CLASE_TOPBAR = "absolute left-0 right-0 top-0 z-40 flex h-10 items-center justify-between border-b px-3 backdrop-blur-sm";
const CLASE_VOLVER = "font-light uppercase tracking-[0.3em]";

// Con `topbar_back_color` cargado el color es FINAL (sin la opacidad decorativa); sin él, el gris tenue de siempre.
function estiloVolver(volver: Props["volver"]): React.CSSProperties {
  return { fontSize: volver.tamano, color: volver.color ?? undefined, opacity: volver.color ? undefined : 0.6 };
}

function Topbar({ embebida, hrefVolver, volver }: { embebida: boolean; hrefVolver?: string; volver: Props["volver"] }) {
  if (embebida) {
    return (
      <div data-carta-topbar className={CLASE_TOPBAR} style={ESTILO_TOPBAR}>
        <span className={CLASE_VOLVER} style={estiloVolver(volver)}>
          {volver.etiqueta}
        </span>
      </div>
    );
  }
  return (
    <header data-carta-topbar className={CLASE_TOPBAR} style={ESTILO_TOPBAR}>
      {hrefVolver ? (
        <Link href={hrefVolver} className={`${CLASE_VOLVER} transition-opacity hover:opacity-90`} style={estiloVolver(volver)}>
          {volver.etiqueta}
        </Link>
      ) : (
        <span />
      )}
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
  );
}

interface PropsSlider {
  embebida: boolean;
  sliderRef: React.RefObject<HTMLElement | null>;
  onScroll: () => void;
  onScrollCapture: () => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  children: ReactNode;
}

function Slider({ embebida, sliderRef, onScroll, onScrollCapture, onClickCapture, children }: PropsSlider) {
  if (embebida) {
    return (
      <div ref={sliderRef as React.RefObject<HTMLDivElement | null>} onScroll={onScroll} onScrollCapture={onScrollCapture} onClickCapture={onClickCapture} className="carta-slider h-full w-full" data-carta-slider>
        {children}
      </div>
    );
  }
  return (
    <main ref={sliderRef} onScroll={onScroll} onScrollCapture={onScrollCapture} onClickCapture={onClickCapture} className="carta-slider h-full w-full" data-carta-slider>
      {children}
    </main>
  );
}
