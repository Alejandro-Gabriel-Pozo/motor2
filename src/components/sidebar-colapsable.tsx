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
 * Arranca siempre expandido (server y cliente coinciden, sin mismatch de
 * hidratación) y recién después de montado lee localStorage — quien tenía
 * el sidebar colapsado ve un flash breve de expandido en una recarga
 * completa, pero la navegación normal dentro de la app no remonta este
 * layout, así que en el uso real casi nunca se nota.
 */
export function SidebarColapsable({ grupos, hrefsDelMenu }: { grupos: GrupoNav[]; hrefsDelMenu: readonly string[] }) {
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
        className={`flex flex-shrink-0 flex-col overflow-hidden border-neutral-200 transition-[width] duration-150 dark:border-neutral-800 ${
          colapsado ? "w-0" : "w-56 border-r"
        }`}
      >
        <div className="flex w-56 items-center border-b border-neutral-200 px-4 py-3 font-semibold dark:border-neutral-800">
          <Link href={RUTA_INICIO} className="hover:underline">
            Motor2
          </Link>
        </div>
        <div className="w-56">
          <SidebarNav grupos={grupos} hrefsDelMenu={hrefsDelMenu} />
        </div>
      </aside>
      <button
        type="button"
        onClick={alternar}
        aria-label={colapsado ? "Mostrar menú" : "Ocultar menú"}
        title={colapsado ? "Mostrar menú" : "Ocultar menú"}
        className="flex w-5 flex-shrink-0 items-center justify-center border-r border-neutral-200 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        {colapsado ? "›" : "‹"}
      </button>
    </>
  );
}
