"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { coincideConLaBusqueda } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

export interface ProductoFueraDeCarta {
  id: string;
  nombre: string;
  precioAca: number;
}

/**
 * CARTA-MANT: «Fuera de carta (POS y menú del día)», plegado. Son los productos de venta disponibles en la sucursal que NO salen en la carta pública (decisión del dueño: el menú del día y lo
 * que se vende solo en el POS no se publican); no es un faltante, así que no se avisa: es un contador informativo. Para publicar uno: «Agregar a la carta» y un toque en la sección (va visible y
 * al final; lo demás se completa después en su ficha). Lo decide y lo escribe el servidor (`agregarProductoALaCarta`, solo en la sucursal activa, con el eco de la sucursal que vio la pantalla);
 * la pantalla se refresca y el producto pasa a su sección. Sin permiso de editar el contenido de carta, la lista se ve igual pero sin el botón.
 */
export function FueraDeCarta({
  productos,
  secciones,
  puedeAgregar,
  agregar,
}: {
  productos: ProductoFueraDeCarta[];
  /** Solo las secciones activas (en una apagada no saldría). */
  secciones: { id: string; nombre: string }[];
  puedeAgregar: boolean;
  agregar: (productoId: string, seccionCartaId: string) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  const elegir = (productoId: string, seccionCartaId: string) => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await agregar(productoId, seccionCartaId);
        setResultado(r);
        if (r.ok) {
          setEligiendo(null);
          router.refresh();
        }
      } finally {
        enviando.current = false;
      }
    });
  };

  const visibles = productos.filter((p) => coincideConLaBusqueda(p.nombre, buscar));

  return (
    <details className="rounded border" data-fuera-de-carta>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 font-medium">Fuera de carta (POS y menú del día): {productos.length}</summary>
      <div className="flex flex-col gap-3 border-t p-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Se venden en el POS o en el menú del día y no salen en la carta pública: no hace falta hacer nada.{" "}
          {puedeAgregar ? "Para publicar uno, tocá «Agregar a la carta» y elegí la sección." : ""}
        </p>
        {productos.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="buscar-fuera-de-carta" className="text-sm font-medium">
              Buscar producto
            </label>
            <input
              id="buscar-fuera-de-carta"
              type="search"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Ej.: milanesa"
              className="w-full max-w-sm rounded border px-3 py-2 max-md:min-h-11 max-md:text-base"
            />
          </div>
        )}
        {productos.length > 0 && visibles.length === 0 && (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
            No hay productos que coincidan.
          </p>
        )}
        <ul className="flex flex-col divide-y">
          {visibles.map((p) => {
            const abierto = eligiendo === p.id;
            return (
              <li key={p.id} className="flex flex-col gap-2 py-2" data-fuera-de-carta-producto={p.nombre}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                    {p.nombre} <span className="text-neutral-600 dark:text-neutral-400">· ${p.precioAca.toLocaleString("es-AR")}</span>
                  </span>
                  {puedeAgregar && (
                    <button
                      type="button"
                      aria-expanded={abierto}
                      disabled={secciones.length === 0}
                      onClick={() => setEligiendo(abierto ? null : p.id)}
                      className="min-h-11 rounded border border-neutral-900 px-3 py-1.5 text-sm font-medium dark:border-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="sr-only">{p.nombre}: </span>
                      {abierto ? "Cancelar" : "Agregar a la carta"}
                    </button>
                  )}
                </div>
                {abierto && (
                  <fieldset className="flex min-w-0 flex-col gap-2">
                    <legend className="mb-1 text-sm">¿En qué sección de la carta va «{p.nombre}»?</legend>
                    <div className="flex flex-wrap gap-2">
                      {secciones.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          disabled={pendiente}
                          onClick={() => elegir(p.id, s.id)}
                          className="min-h-11 rounded border px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-60 dark:hover:border-neutral-100 [overflow-wrap:anywhere]"
                        >
                          {s.nombre}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
        {puedeAgregar && secciones.length === 0 && productos.length > 0 && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Para agregar un producto a la carta hace falta al menos una sección activa.</p>
        )}
        {resultado && (
          <p
            role={resultado.ok ? "status" : "alert"}
            data-resultado-pegado
            className={`sticky bottom-3 z-10 rounded border bg-white p-3 text-sm shadow-lg dark:bg-neutral-900 [overflow-wrap:anywhere] ${resultado.ok ? "border-green-700 text-green-700 dark:border-green-500 dark:text-green-400" : "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400"}`}
          >
            {resultado.mensaje}
          </p>
        )}
      </div>
    </details>
  );
}
