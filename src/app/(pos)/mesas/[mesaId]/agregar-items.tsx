"use client";

import { useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { agregarItems } from "@/server/actions/pos/cuenta";
import { BOTON_PRIMARIO, CAMPO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/**
 * Agrega un producto a la cuenta, SIN ENVIAR todavía (queda en «Sin enviar» hasta «Enviar a cocina»). El selector solo ofrece PV
 * disponibles en la sucursal; el servidor lo vuelve a validar y congela el precio del momento. Sin `pos_tomar_pedido` todo el
 * formulario queda deshabilitado.
 */
export function AgregarItems({ cuentaId, puede }: { cuentaId: string; puede: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [limpiar, setLimpiar] = useState(0);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(cantidad.trim().replace(",", ".") || Number.NaN);
    ejecutar(
      () => agregarItems(cuentaId, [{ productoId, cantidad: n }]),
      () => {
        setProductoId("");
        setCantidad("1");
        setLimpiar((x) => x + 1);
      }
    );
  };

  return (
    <form onSubmit={enviar} aria-label="Agregar producto" className="flex flex-col gap-2">
      <fieldset disabled={!puede} title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="agregar-producto" className="text-[12.5px] font-semibold">
            Producto
          </label>
          <SelectorProducto
            id="agregar-producto"
            value={productoId}
            onChange={setProductoId}
            filtro={{ tipo: "PV", soloDisponibles: true }}
            placeholder="Buscar por nombre o código…"
            required
            limpiarSenal={limpiar}
            siempreClaro
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agregar-cantidad" className="text-[12.5px] font-semibold">
            Cantidad
          </label>
          <input
            id="agregar-cantidad"
            inputMode="decimal"
            autoComplete="off"
            required
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "agregar-error" : undefined}
            className={`${CAMPO} w-24 tabular-nums`}
          />
        </div>
        <button type="submit" className={BOTON_PRIMARIO} disabled={pending || !productoId}>
          {pending ? "Agregando…" : "Agregar"}
        </button>
      </fieldset>
      {error && (
        <p id="agregar-error" role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
