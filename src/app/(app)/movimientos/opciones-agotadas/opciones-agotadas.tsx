"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { formatearCantidad } from "@/core/pos/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

export interface OpcionParaAgotar {
  opcionId: string;
  nombre: string;
  esNinguna: boolean;
  agotada: boolean;
  sinStockEnElSistema: { productoId: string; nombre: string; unidadNombre: string; saldo: number }[];
}

export interface GrupoParaAgotar {
  grupoId: string;
  nombre: string;
  opciones: OpcionParaAgotar[];
}

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * «Opciones agotadas» de la sucursal (GO-2d; modelo «Hoy» del prototipo de Mantenimiento): un toque en la píldora de una opción la marca agotada o disponible, sin pantalla de
 * confirmación, y aparece «Deshacer» a la vista. Lo que se hace lo decide y lo escribe el servidor (`apagarOpcionEnSucursal`, solo en la sucursal activa, con el eco de la sucursal que
 * vio la pantalla); la pantalla se refresca para mostrar lo que quedó (y los productos que se quedan sin poder venderse).
 *
 * El stock teórico AVISA, NUNCA BLOQUEA (decisión del dueño): si una opción disponible consume un insumo que el sistema registra en 0 o menos, se dice al lado, con el enlace al conteo
 * físico, y la opción sigue disponible: el sistema puede decir 0 y haber stock de verdad.
 */
export function OpcionesAgotadas({
  grupos,
  puedeCambiar,
  accion,
}: {
  grupos: GrupoParaAgotar[];
  puedeCambiar: boolean;
  accion: (opcionId: string, apagada: boolean) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [ultimo, setUltimo] = useState<{ opcionId: string; nombre: string; apagada: boolean; resultado: ResultadoAccion; deshacible: boolean } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  /** Un toque: lo cambia el servidor; «Deshacer» es el cambio inverso (y ya no se puede deshacer). */
  const cambiar = (opcionId: string, nombre: string, apagada: boolean, deshacible: boolean) => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const resultado = await accion(opcionId, apagada);
        setUltimo({ opcionId, nombre, apagada, resultado, deshacible: deshacible && resultado.ok });
        if (resultado.ok) router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  };

  const filtro = normalizar(buscar.trim());
  const visibles = grupos
    .map((g) => ({ ...g, opciones: filtro ? g.opciones.filter((o) => normalizar(o.nombre).includes(filtro) || normalizar(g.nombre).includes(filtro)) : g.opciones }))
    .filter((g) => g.opciones.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="buscar-opcion" className="text-sm font-medium">
          Buscar opción
        </label>
        <input id="buscar-opcion" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Ej.: papas" className="max-w-sm rounded border px-3 py-2" />
      </div>
      {visibles.length === 0 && <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">No hay opciones que coincidan.</p>}
      {visibles.map((g) => (
        <section key={g.grupoId} aria-labelledby={`grupo-${g.grupoId}`} className="flex flex-col gap-2 rounded border p-3">
          <h2 id={`grupo-${g.grupoId}`} className="font-medium">
            {g.nombre} <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">· {g.opciones.filter((o) => !o.agotada).length} de {g.opciones.length} disponibles</span>
          </h2>
          <ul className="flex flex-col divide-y">
            {g.opciones.map((o) => (
              <li key={o.opcionId} className="flex flex-col gap-1 py-2" data-opcion-sucursal={o.nombre}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    {o.nombre}
                    {o.esNinguna && <span className="text-neutral-600 dark:text-neutral-400"> (ninguna)</span>}
                  </span>
                  <button
                    type="button"
                    aria-pressed={!o.agotada}
                    disabled={!puedeCambiar}
                    title={puedeCambiar ? undefined : "Tu rol puede ver esta pantalla pero no cambiar el estado de las opciones."}
                    onClick={() => cambiar(o.opcionId, o.nombre, !o.agotada, true)}
                    className="min-h-[44px] min-w-[8.5rem] rounded-full border px-4 py-1.5 text-sm font-medium aria-pressed:border-green-700 aria-pressed:text-green-800 dark:aria-pressed:border-green-500 dark:aria-pressed:text-green-400 [&:not([aria-pressed=true])]:border-red-700 [&:not([aria-pressed=true])]:bg-red-50 [&:not([aria-pressed=true])]:text-red-800 dark:[&:not([aria-pressed=true])]:bg-red-950 dark:[&:not([aria-pressed=true])]:text-red-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="sr-only">{o.nombre}: </span>
                    {o.agotada ? "Agotada" : "Disponible"}
                  </button>
                </div>
                {o.sinStockEnElSistema.map((i) => (
                  <p key={i.productoId} className="text-xs text-amber-700 dark:text-amber-600" data-aviso-stock={i.nombre}>
                    {i.nombre}: el sistema dice {formatearCantidad(i.saldo)} {i.unidadNombre}. Si hay en el depósito,{" "}
                    <EnlaceInterno href="/movimientos/conteo-fisico" className="underline">
                      hacé un conteo físico
                    </EnlaceInterno>
                    . La opción sigue disponible.
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {/* MOVIL (O.462): el resultado y «Deshacer» van PEGADOS AL BORDE DE ABAJO de la pantalla (`sticky bottom-3`), no arriba de la lista: quien toca una opción lejos, en una lista larga en el
          celular, los tenía fuera de la vista y no se enteraba de que se agotó ni podía deshacer. Sigue siendo `status` (o `alert` si falló), con el mismo texto. */}
      {ultimo && (
        <div
          role={ultimo.resultado.ok ? "status" : "alert"}
          data-resultado-pegado
          className={`sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded border bg-white p-3 text-sm shadow-lg dark:bg-neutral-900 ${ultimo.resultado.ok ? "border-green-700 text-green-700 dark:border-green-500 dark:text-green-400" : "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400"}`}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{ultimo.resultado.mensaje}</span>
          {ultimo.deshacible && (
            <button type="button" disabled={pendiente} onClick={() => cambiar(ultimo.opcionId, ultimo.nombre, !ultimo.apagada, false)} className="min-h-[44px] min-w-[44px] rounded border border-current px-3 py-1 font-medium">
              Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
