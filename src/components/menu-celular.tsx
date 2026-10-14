"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { hrefActivoDelMenu, type GrupoNav } from "@/core/navegacion/estructura";
import { buscarPantallaEnMenu } from "@/core/navegacion/buscar-pantalla";
import { IconoDeControl, IconoDeModulo } from "@/components/iconos";
import { IndicadorDeEnlace } from "@/components/indicador-de-enlace";

/** Desde este ancho (el `md:` de Tailwind) el menú es el lateral de siempre (`SidebarColapsable`) y esto no existe. */
const CONSULTA_ESCRITORIO = "(min-width: 768px)";

/**
 * El menú en CELULAR (< 768 px). El menú lateral de 224 px, fijo, le dejaba al contenido ~130 px (texto partido letra por letra): en celular ya no se dibuja y en su lugar el
 * encabezado lleva un botón ☰ («Abrir menú», 44 × 44 px) que abre este cajón por la izquierda (≈ 86 % del ancho, con el fondo oscurecido):
 *  - arriba, el buscador «Buscar pantalla…» (44 px de alto, 16 px de letra para que iOS no haga zoom) y ✕ «Cerrar menú»;
 *  - debajo, los grupos como acordeones (uno abierto a la vez; el del ítem activo viene abierto) con filas de 46 px o más y el ítem activo resaltado;
 *  - al escribir, una lista plana de coincidencias con el grupo al costado (sin distinguir mayúsculas ni acentos; «Sin resultados» si no hay).
 *
 * Es un `<dialog>` NATIVO con `showModal()` (mismo criterio que `ui/componentes/superposiciones/dialogo.tsx`): rol de diálogo modal, resto de la página inerte (foco atrapado), Escape cierra,
 * y al cerrar el foco vuelve al ☰. Tocar el fondo, ✕ o un ítem lo cierra (el ítem además navega). Los hijos se montan solo mientras está abierto. La animación de entrada solo corre sin
 * «reducir movimiento» (`globals.css`).
 *
 * QUÉ se ofrece lo decide el SERVIDOR: recibe los MISMOS `grupos`, ya filtrados por permiso (`filtrarMenuPorPermiso`), que recibe el menú lateral; no se manda nada más al cliente ni se
 * cambia ninguna ruta. Acá no hay selector de Empresa/Sucursal: con 70 pantallas el buscador es el camino corto, y los grupos muestran todo lo que la persona puede ver.
 */
export function MenuCelular({ grupos, hrefsDelMenu }: { grupos: GrupoNav[]; hrefsDelMenu: readonly string[] }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const idBase = useId();

  const hrefActivo = useMemo(() => hrefActivoDelMenu(pathname, hrefsDelMenu, new Set(grupos.flatMap((g) => g.items.map((i) => i.href)))), [pathname, hrefsDelMenu, grupos]);
  const encontradas = useMemo(() => buscarPantallaEnMenu(grupos, consulta), [grupos, consulta]);
  const buscando = consulta.trim() !== "";

  const abrir = () => {
    setConsulta("");
    setGrupoAbierto(grupos.find((g) => g.items.some((i) => i.href === hrefActivo))?.id ?? null);
    setAbierto(true);
  };
  const cerrar = () => setAbierto(false);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) {
      d.showModal();
      buscador.current?.focus();
    }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // Si la ventana pasa a ser de escritorio con el cajón abierto (girar una tableta), se cierra: el menú es el lateral.
  useEffect(() => {
    const consultaMedia = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCambiar = (e: MediaQueryListEvent) => {
      if (e.matches) setAbierto(false);
    };
    consultaMedia.addEventListener("change", alCambiar);
    return () => consultaMedia.removeEventListener("change", alCambiar);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Abrir menú"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className="mr-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 md:hidden dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:focus-visible:outline-neutral-100"
      >
        <IconoDeControl id="menu" />
      </button>
      <dialog
        ref={dialogo}
        aria-label="Menú"
        onClose={cerrar}
        onClick={(e) => {
          // El cajón ocupa el 86 % del ancho y no tiene relleno: un clic cuyo destino es el `<dialog>` mismo es un clic en el fondo oscurecido.
          if (e.target === e.currentTarget) cerrar();
        }}
        className="menu-celular m-0 h-dvh max-h-none w-[86%] max-w-sm overflow-hidden bg-white p-0 text-neutral-900 shadow-xl backdrop:bg-black/45 md:hidden dark:bg-neutral-900 dark:text-neutral-100"
      >
        {abierto ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-200 p-2.5 dark:border-neutral-800">
              <input
                ref={buscador}
                type="search"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                aria-label="Buscar pantalla"
                placeholder="Buscar pantalla…"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-[10px] border border-neutral-300 bg-white px-3 text-base text-neutral-900 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
              />
              <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar menú"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:focus-visible:outline-neutral-100"
              >
                <IconoDeControl id="cerrar" />
              </button>
            </div>
            <nav aria-label="Pantallas" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {buscando ? (
                encontradas.length === 0 ? (
                  <p role="status" className="px-4 py-3 text-base text-neutral-600 dark:text-neutral-400">
                    Sin resultados
                  </p>
                ) : (
                  <ul>
                    {encontradas.map((p) => (
                      <li key={p.href}>
                        <Link href={p.href} onClick={cerrar} aria-current={p.href === hrefActivo ? "page" : undefined} className={filaDeItem(p.href === hrefActivo, "px-4")}>
                          <span className="min-w-0 flex-1">{p.label}</span>
                          <span className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{p.grupoLabel}</span>
                          <IndicadorDeEnlace />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                grupos.map((g) => {
                  const abiertoElGrupo = grupoAbierto === g.id;
                  const idPanel = `${idBase}-${g.id}`;
                  return (
                    <div key={g.id} className="border-b border-neutral-200 dark:border-neutral-800">
                      <button
                        type="button"
                        aria-expanded={abiertoElGrupo}
                        aria-controls={idPanel}
                        onClick={() => setGrupoAbierto(abiertoElGrupo ? null : g.id)}
                        className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-base font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <span className="flex items-center gap-2">
                          <IconoDeModulo id={g.id} />
                          {g.label}
                        </span>
                        <span aria-hidden="true" className="text-neutral-600 dark:text-neutral-400">
                          {abiertoElGrupo ? "▴" : "▾"}
                        </span>
                      </button>
                      <ul id={idPanel} hidden={!abiertoElGrupo} className="bg-neutral-50 dark:bg-neutral-950">
                        {g.items.map((i) => (
                          <li key={i.href}>
                            <Link href={i.href} onClick={cerrar} aria-current={i.href === hrefActivo ? "page" : undefined} className={filaDeItem(i.href === hrefActivo, "pl-7 pr-4")}>
                              {i.label}
                              <IndicadorDeEnlace />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </nav>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** Una fila de pantalla del cajón: 46 px de alto como mínimo; la activa, resaltada igual que en el menú lateral. */
function filaDeItem(activo: boolean, relleno: string): string {
  return `flex min-h-[46px] items-center gap-2 border-t border-neutral-200 text-[15.5px] dark:border-neutral-800 ${relleno} ${
    activo ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
  }`;
}
