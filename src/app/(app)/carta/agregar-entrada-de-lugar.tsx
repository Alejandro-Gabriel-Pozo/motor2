"use client";

import { useRef, useState, useTransition } from "react";
import type { ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";

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
        <div className="flex min-w-0 max-w-full flex-col">
          <Selector
            etiqueta={`Sumar a «${lugar}»`}
            id={`${base}-producto`}
            value={productoId}
            onChange={(e) => {
              setProductoId(e.target.value);
              setElegidas({});
              setResultado(null);
            }}
            className="min-w-0 max-w-full"
          >
            <option value="">Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.productoId} value={p.productoId}>
                {p.nombre}
              </option>
            ))}
          </Selector>
        </div>
        {producto?.grupos.map((g) => (
          <div key={g.grupoId} className="flex min-w-0 max-w-full flex-col">
            <Selector
              etiqueta={`${g.nombre}${g.obligatorio ? "" : " (opcional)"}`}
              id={`${base}-${g.grupoId}`}
              value={elegidas[g.grupoId] ?? ""}
              onChange={(e) => setElegidas((antes) => ({ ...antes, [g.grupoId]: e.target.value }))}
              className="min-w-0 max-w-full"
            >
              <option value="">{g.obligatorio ? "Elegí…" : "Sin elegir"}</option>
              {g.opciones.map((o) => (
                <option key={o.opcionId} value={o.opcionId}>
                  {o.nombre}
                </option>
              ))}
            </Selector>
          </div>
        ))}
        <Boton tamano="tactil" disabled={!producto || faltan.length > 0 || pendiente} onClick={confirmar}>
          Sumar
        </Boton>
      </div>
      {producto && faltan.length > 0 && <p className="text-xs text-tinta-tenue">Falta elegir: {faltan.map((g) => g.nombre).join(", ")}.</p>}
      {resultado && (
        <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      )}
    </div>
  );
}
