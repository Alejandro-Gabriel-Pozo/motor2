"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RUTA_INICIO, type GrupoNav } from "@/core/navegacion/estructura";
import { SidebarNav } from "./sidebar-nav";

const CLAVE_STORAGE = "motor2:sidebar-colapsado";

/**
 * El sidebar no tenía ningún mecanismo de colapso, en ningún tamaño de
 * pantalla — hallazgo de la diligencia de motor2. No es solo un problema
 * de mobile (en desktop tampoco se podía achicar para ganar espacio en
 * tablas anchas como Costos o Rendimiento real de recetas), pero en
 * mobile el efecto es mucho más grave: 224px fijos sobre ~400px de
 * pantalla le comen más de la mitad al contenido.
 *
 * MOVIL (O.465): en celular (< 768 px) NADA de esto se dibuja (`max-md:hidden`): el menú es el cajón de `MenuCelular` (☰ en el encabezado), que abre desde un botón y no
 * le quita ancho al contenido. El control «Ocultar menú» y su elección guardada son de escritorio y quedan como estaban.
 *
 * Arranca siempre expandido (server y cliente coinciden, sin mismatch de
 * hidratación) y recién después de montado lee localStorage — quien tenía
 * el sidebar colapsado ve un flash breve de expandido en una recarga
 * completa, pero la navegación normal dentro de la app no remonta este
 * layout, así que en el uso real casi nunca se nota.
 */
export function SidebarColapsable({
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
  const [colapsado, setColapsado] = useState(false);

  useEffect(() => {
    // El setState va en un callback (no directo en el cuerpo del efecto) a
    // propósito, mismo criterio que exige react-hooks/set-state-in-effect.
    // `queueMicrotask`, no `Promise.resolve().then(...)`: no hay ninguna operación async de verdad acá, solo un diferimiento.
    queueMicrotask(() => {
      try {
        if (localStorage.getItem(CLAVE_STORAGE) === "1") setColapsado(true);
      } catch {
        // Sin acceso a localStorage (modo privado, etc.), se queda expandido.
      }
    });
  }, []);

  function alternar() {
    setColapsado((prev) => {
      const nuevo = !prev;
      try {
        localStorage.setItem(CLAVE_STORAGE, nuevo ? "1" : "0");
      } catch {
        // Sin persistencia disponible, el toggle igual funciona para esta sesión.
      }
      return nuevo;
    });
  }

  return (
    <>
      <aside
        className={`flex flex-shrink-0 flex-col overflow-hidden border-borde bg-superficie transition-[width] duration-150 max-md:hidden ${
          colapsado ? "w-0" : "w-56 border-r"
        }`}
      >
        <div className="flex w-56 items-center border-b border-borde px-4 py-3 font-semibold">
          <Link href={RUTA_INICIO} className="hover:underline">
            Motor2
          </Link>
        </div>
        <div className="w-56">
          <SidebarNav grupos={grupos} hrefsDelMenu={hrefsDelMenu} dosPaneles={dosPaneles} sucursalNombre={sucursalNombre} />
        </div>
      </aside>
      <button
        type="button"
        onClick={alternar}
        aria-label={colapsado ? "Mostrar menú" : "Ocultar menú"}
        title={colapsado ? "Mostrar menú" : "Ocultar menú"}
        className="flex w-5 flex-shrink-0 items-center justify-center max-md:hidden border-r border-borde bg-superficie text-tinta-suave hover:bg-superficie-suave hover:text-tinta"
      >
        {colapsado ? "›" : "‹"}
      </button>
    </>
  );
}
