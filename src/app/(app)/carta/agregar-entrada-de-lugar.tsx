"use client";

import { useRef, useState, useTransition } from "react";
import type { ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * GO-3b (U1): sumar una ENTRADA a un lugar LISTA de un combo: el producto y, si admite grupos de una sola elección (el tamaño, la leche), su configuración FIJA («Café · Mediano · Almendras»).
 * Un grupo obligatorio hay que elegirlo; uno opcional puede quedar sin elegir. Lo valida el servidor (que el producto pueda ser componente: con receta y precio; la configuración, como la venta) y
 * responde con el motivo si no; un doble toque no manda dos veces.
 */
export function AgregarEntradaDeLugar({
  lugar,
  productos,
  agregar,
}: {
  lugar: string;
  productos: ProductoParaEntrada[];
  agregar: (productoId: string, opciones: { opcionId: string; cantidad: number }[]) => Promise<ResultadoAccion>;
}) {
  const [productoId, setProductoId] = useState("");
  const [elegidas, setElegidas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const producto = productos.find((p) => p.productoId === productoId);
  const faltan = (producto?.grupos ?? []).filter((g) => g.obligatorio && !elegidas[g.grupoId]);
  const base = `entrada-${lugar.replace(/\W+/g, "-")}`;

  const confirmar = () => {
    if (!producto || faltan.length || enviando.current) return;
    enviando.current = true;
    const opciones = producto.grupos.flatMap((g) => (elegidas[g.grupoId] ? [{ opcionId: elegidas[g.grupoId]!, cantidad: 1 }] : []));
    startTransition(async () => {
      try {
        const r = await agregar(producto.productoId, opciones);
        setResultado(r);
        if (r.ok) {
          setProductoId("");
          setElegidas({});
        }
      } finally {
        enviando.current = false;
      }
    });
  };

  return (
    <div className="mt-1 flex flex-col gap-2 text-sm" data-agregar-entrada={lugar}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" htmlFor={`${base}-producto`}>
          Sumar a «{lugar}»
          <select
            id={`${base}-producto`}
            value={productoId}
            onChange={(e) => {
              setProductoId(e.target.value);
              setElegidas({});
              setResultado(null);
            }}
            className="min-h-[44px] rounded border px-2 py-1"
          >
            <option value="">Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.productoId} value={p.productoId}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        {producto?.grupos.map((g) => (
          <label key={g.grupoId} className="flex flex-col gap-1" htmlFor={`${base}-${g.grupoId}`}>
            {g.nombre}
            {g.obligatorio ? "" : " (opcional)"}
            <select id={`${base}-${g.grupoId}`} value={elegidas[g.grupoId] ?? ""} onChange={(e) => setElegidas((antes) => ({ ...antes, [g.grupoId]: e.target.value }))} className="min-h-[44px] rounded border px-2 py-1">
              <option value="">{g.obligatorio ? "Elegí…" : "Sin elegir"}</option>
              {g.opciones.map((o) => (
                <option key={o.opcionId} value={o.opcionId}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" disabled={!producto || faltan.length > 0 || pendiente} onClick={confirmar} className="min-h-[44px] rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60">
          Sumar
        </button>
      </div>
      {producto && faltan.length > 0 && <p className="text-xs text-neutral-500">Falta elegir: {faltan.map((g) => g.nombre).join(", ")}.</p>}
      {resultado && (
        <p role={resultado.ok ? "status" : "alert"} className={resultado.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
          {resultado.mensaje}
        </p>
      )}
    </div>
  );
}
