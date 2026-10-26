"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hrefActivoDelMenu, mostrarSelectorDePaneles, panelDeRuta, particionarMenu, type GrupoNav } from "@/core/navegacion/estructura";
import type { PanelActivo } from "@/core/navegacion/panel";
import { IconoDeModulo } from "@/components/iconos";
import { IndicadorDeEnlace } from "@/components/indicador-de-enlace";

const CLAVE_PANEL = "motor2:panel-del-menu";
const PANEL_POR_DEFECTO: PanelActivo = "sucursal";
const PANELES: { id: PanelActivo; label: string }[] = [
  { id: "empresa", label: "Empresa" },
  { id: "sucursal", label: "Sucursal" },
];

function grupoActivo(grupo: GrupoNav, hrefActivo: string | null): boolean {
  return hrefActivo !== null && grupo.items.some((i) => i.href === hrefActivo);
}

function guardarPanel(panel: PanelActivo) {
  try {
    localStorage.setItem(CLAVE_PANEL, panel);
  } catch {
    // Sin persistencia disponible, el panel igual cambia para esta sesión.
  }
}

/**
 * `hrefsDelMenu`: las rutas del menú COMPLETO (no solo las visibles), para que la pantalla de un ítem que el usuario no ve no resalte uno más corto.
 *
 * `dosPaneles` (la política de la empresa, ADR-010): si el usuario ve alguna pantalla exclusiva de Empresa, el menú se parte en dos paneles con un
 * selector arriba; si no, o con `dosPaneles` apagado, es el menú único de siempre. El panel que se muestra es el de la pantalla abierta; en una
 * pantalla de ambos paneles o en el inicio se queda el último que se eligió (guardado en el navegador; sin dato, Sucursal).
 */
export function SidebarNav({
  grupos,
  hrefsDelMenu,
  dosPaneles,
  sucursalNombre,
}: {
  grupos: GrupoNav[];
  hrefsDelMenu: readonly string[];
  dosPaneles: boolean;
  sucursalNombre: string;
}) {
  const pathname = usePathname();
  const hrefActivo = hrefActivoDelMenu(pathname, hrefsDelMenu, new Set(grupos.flatMap((g) => g.items.map((i) => i.href))));
  const conPaneles = dosPaneles && mostrarSelectorDePaneles(grupos);
  const [panel, setPanel] = useState<PanelActivo>(() => panelDeRuta(pathname) ?? PANEL_POR_DEFECTO);
  const gruposMostrados = conPaneles ? particionarMenu(grupos)[panel] : grupos;
  const [expandido, setExpandido] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(grupos.map((g) => [g.id, grupoActivo(g, hrefActivo)]))
  );

  // Al navegar a un grupo distinto, ese grupo se abre solo — sin tocar el
  // estado (abierto/cerrado) que el usuario ya haya elegido para los demás.
  // Ajustado durante el render (no en un efecto) al detectar que
  // `pathname` cambió desde el render anterior — mismo criterio que
  // CampoNumero/SelectorProducto. Lo mismo vale para el panel: una pantalla de
  // un solo panel lo fija; una de ambos paneles (o el inicio) deja el que estaba.
  const [pathnamePrevio, setPathnamePrevio] = useState(pathname);
  if (pathname !== pathnamePrevio) {
    setPathnamePrevio(pathname);
    const panelDeLaRuta = panelDeRuta(pathname);
    if (panelDeLaRuta) setPanel(panelDeLaRuta);
    const activo = grupos.find((g) => grupoActivo(g, hrefActivo));
    if (activo) setExpandido((prev) => (prev[activo.id] ? prev : { ...prev, [activo.id]: true }));
  }

  // Una pantalla de un solo panel lo recuerda para el inicio y las pantallas de ambos paneles; en estas se lee lo guardado.
  useEffect(() => {
    const deLaRuta = panelDeRuta(pathname);
    if (deLaRuta) {
      guardarPanel(deLaRuta);
      return;
    }
    // `queueMicrotask`, mismo criterio que SidebarColapsable: el setState no va directo en el cuerpo del efecto.
    queueMicrotask(() => {
      try {
        const guardado = localStorage.getItem(CLAVE_PANEL);
        if (guardado === "empresa" || guardado === "sucursal") setPanel(guardado);
      } catch {
        // Sin acceso a localStorage, se queda en el panel por defecto.
      }
    });
  }, [pathname]);

  return (
    <nav className="flex flex-col gap-0.5 overflow-y-auto px-2 py-3 text-sm">
      {conPaneles && (
        <>
        <div role="group" aria-label="Panel del menú" className="flex gap-1">
          {PANELES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={panel === p.id}
              title={p.id === "sucursal" ? `Sucursal activa: ${sucursalNombre}` : "Lo que afecta a la empresa entera"}
              onClick={() => {
                setPanel(p.id);
                guardarPanel(p.id);
              }}
              className={`flex-1 rounded border px-2 py-1 font-medium ${
                panel === p.id
                  ? "border-tinta bg-tinta text-superficie"
                  : "border-borde-control text-tinta-suave hover:bg-superficie-suave"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p data-sucursal-activa className="mb-2 truncate px-1 text-xs text-tinta-suave" title={sucursalNombre}>
          Sucursal: {sucursalNombre}
        </p>
        </>
      )}
      {gruposMostrados.map((grupo) => {
        const abierto = expandido[grupo.id] ?? false;
        return (
          <div key={grupo.id}>
            <button
              type="button"
              onClick={() => setExpandido((prev) => ({ ...prev, [grupo.id]: !abierto }))}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-medium text-tinta hover:bg-superficie-suave"
            >
              <span className="flex items-center gap-2">
                <IconoDeModulo id={grupo.id} />
                {grupo.label}
              </span>
              <span className="text-xs text-tinta-suave">{abierto ? "▾" : "▸"}</span>
            </button>
            {abierto && (
              <div className="ml-2 flex flex-col gap-0.5 border-l border-borde pl-2">
                {grupo.items.map((item) => {
                  const activo = item.href === hrefActivo;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={activo ? "page" : undefined}
                      className={`rounded px-2 py-1 ${
                        activo
                          ? "bg-tinta text-superficie"
                          : "text-tinta-suave hover:bg-superficie-suave hover:text-tinta"
                      }`}
                    >
                      {item.label}
                      <IndicadorDeEnlace />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
