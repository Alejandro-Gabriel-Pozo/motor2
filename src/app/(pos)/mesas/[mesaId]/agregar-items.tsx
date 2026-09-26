"use client";

import { useMemo, useReducer, useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { agregarItems } from "@/server/actions/pos/cuenta";
import { pediblesDeEntrada, type ProductoPedible, type SelectorCartaPos } from "@/core/pos/selector-carta";
import { estadoInicialSelectorCarta, reducirSelectorCarta } from "@/core/pos/selector-carta-estado";
import { BOTON_PRIMARIO, CAMPO } from "./estilos";
import { formatearMonto } from "./formato";
import { SelectorCarta } from "./selector-carta";
import { useAccionMesa } from "./usar-accion";

/**
 * Agrega un producto a la cuenta, SIN ENVIAR todavía (queda en «Sin enviar» hasta «Enviar a cocina»). El selector solo ofrece PV
 * disponibles en la sucursal; el servidor lo vuelve a validar y congela el precio del momento. Sin `pos_tomar_pedido` todo el
 * formulario queda deshabilitado.
 *
 * Dos caminos al mismo producto elegido (docs/plan-selector-carta-pos-2026-09-25.md): el buscador por texto de siempre y, si la
 * sucursal tiene carta, la navegación por sección de carta (`SelectorCarta`), que despliega las opciones de los ítems agrupados.
 * Sin ninguna sección de carta (DP3) la pantalla queda exactamente como antes: solo el buscador. El estado compartido vive en un
 * reductor puro (`selector-carta-estado.ts`).
 */
export function AgregarItems({ cuentaId, puede, selectorCarta }: { cuentaId: string; puede: boolean; selectorCarta: SelectorCartaPos | null }) {
  const { ejecutar, pending, error } = useAccionMesa();
  const [estado, despachar] = useReducer(reducirSelectorCarta, selectorCarta, estadoInicialSelectorCarta);
  const [cantidad, setCantidad] = useState("1");
  const productoId = estado.productoId;
  const hayCarta = !!selectorCarta && selectorCarta.seccionesCarta.length > 0;

  // Para «Elegido: …»: cualquier pedible, lo haya elegido la carta o el buscador.
  const pediblePorId = useMemo(() => {
    const todos: ProductoPedible[] = [
      ...(selectorCarta?.seccionesCarta ?? []).flatMap((s) => s.entradas.flatMap(pediblesDeEntrada)),
      ...(selectorCarta?.fueraDeCarta ?? []),
    ];
    return new Map(todos.map((p) => [p.productoId, p]));
  }, [selectorCarta]);
  const elegido = productoId ? pediblePorId.get(productoId) : undefined;

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(cantidad.trim().replace(",", ".") || Number.NaN);
    ejecutar(
      () => agregarItems(cuentaId, [{ productoId, cantidad: n }]),
      () => {
        despachar({ tipo: "limpiarTrasAgregar" });
        setCantidad("1");
      }
    );
  };

  return (
    <form onSubmit={enviar} aria-label="Agregar producto" className="flex flex-col gap-2">
      <fieldset
        disabled={!puede}
        title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."}
        className={hayCarta ? "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" : "flex flex-col gap-3 sm:flex-row sm:items-end"}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="agregar-producto" className="text-[12.5px] font-semibold">
            Producto
          </label>
          <SelectorProducto
            id="agregar-producto"
            value={productoId}
            onChange={(id) => despachar({ tipo: "elegirProducto", productoId: id, origen: "buscador" })}
            filtro={{ tipo: "PV", soloDisponibles: true }}
            placeholder="Buscar por nombre o código…"
            required
            limpiarSenal={estado.limpiarBuscador}
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
        {hayCarta && (
          <div className="flex w-full flex-col gap-3 sm:basis-full">
            {/* Sin role="status": el aviso de la pantalla ya es el único `status` con aria-live (aviso-mesa.tsx). */}
            <p data-elegido className="min-h-[1.25rem] text-[13px]">
              {elegido ? (
                <>
                  Elegido: <span className="font-semibold">{elegido.nombre}</span> · <span className="tabular-nums">{formatearMonto(elegido.precio)}</span>
                </>
              ) : (
                <span className="text-[var(--ink-soft)]">Elegí un producto de la carta o buscalo por nombre o código.</span>
              )}
            </p>
            <SelectorCarta selector={selectorCarta} estado={estado} despachar={despachar} />
          </div>
        )}
      </fieldset>
      {error && (
        <p id="agregar-error" role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
