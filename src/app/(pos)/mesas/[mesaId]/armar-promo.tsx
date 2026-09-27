"use client";

import { useEffect, useId, useReducer } from "react";
import type { EntradaPromoSelectorCarta } from "@/core/pos/selector-carta";
import {
  cantidadElegida,
  eleccionParaAgregar,
  estadoInicialArmarPromo,
  puedeConfirmarArmarPromo,
  reducirArmarPromo,
  totalElegidoDelCupo,
  type EleccionParaAgregar,
} from "@/core/pos/armar-promo-estado";
import { formatearMonto } from "@/core/pos/formato";
import { BOTON_CHICO, BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./estilos";

/**
 * Diálogo "Armar promo" (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): por cada cupo, los productos elegibles con
 * −/+ y un contador ("Entradas 1/2"). "Agregar promo" queda deshabilitado hasta que TODOS los cupos cumplan mínimo (D1) y
 * máximo — el reductor puro (`armar-promo-estado.ts`) ya impide pasar del máximo tocando +. Mismo patrón de modal que
 * `AnularItem` (backdrop, `role="dialog"`, Escape cierra). No manda nada al servidor por sí solo: al confirmar, entrega la
 * elección al padre (`AgregarItems`), que la suma a «Por agregar» junto con los sueltos — todo se manda junto recién al
 * confirmar la lista entera (`agregarItems(cuentaId, items, promos)`).
 *
 * Escape cierra con un listener a nivel `window` (`useEffect`), NO `onKeyDown` sobre el div del diálogo (a diferencia de
 * `AnularItem`, que sí puede: su campo lleva `autoFocus`): acá NINGÚN control arranca enfocado, y encima cada botón "Sumar"
 * que llega al máximo de su cupo se deshabilita A SÍ MISMO en el click que lo enfocó — el navegador le saca el foco al
 * quedar disabled (se lo lleva a `<body>`), así que un `onKeyDown` que dependa de que el foco siga DENTRO del diálogo
 * dejaría de andar justo en ese momento (hallazgo real de `test/e2e/pos-promo-combo.spec.ts`, paso 11).
 */
export function ArmarPromo({ entrada, onCerrar, onConfirmar }: { entrada: EntradaPromoSelectorCarta; onCerrar: () => void; onConfirmar: (eleccion: EleccionParaAgregar[]) => void }) {
  const [estado, despachar] = useReducer(reducirArmarPromo, entrada, estadoInicialArmarPromo);
  const puedeConfirmar = puedeConfirmarArmarPromo(estado);
  const base = useId();

  useEffect(() => {
    const escuchar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", escuchar);
    return () => window.removeEventListener("keydown", escuchar);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${base}-titulo`}
        data-armar-promo={entrada.promoCartaId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-[14px] bg-white p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${base}-titulo`} className="mb-1 text-lg font-extrabold tracking-tight">
          Armar «{entrada.titulo}»
        </h2>
        <p className="mb-4 text-[13px] text-[var(--ink-soft)]">{formatearMonto(entrada.precio)} en total, sea cual sea lo que elijas en cada cupo.</p>

        <div className="flex flex-col gap-4">
          {estado.cupos.map((cupo) => {
            const total = totalElegidoDelCupo(estado, cupo.seccionCartaId);
            const llegoAlMaximo = total >= cupo.cantidadMaximaCupo;
            return (
              <fieldset key={cupo.seccionCartaId} data-cupo-armar-promo={cupo.seccionCartaId} className="flex flex-col gap-2 rounded-[12px] border border-[var(--border)] p-3">
                <legend className="px-1 text-[13px] font-semibold">
                  {cupo.nombreSeccion} · {total}/{cupo.cantidadMaximaCupo}
                  {cupo.cantidadMinima > 0 ? ` (mínimo ${cupo.cantidadMinima})` : " (opcional)"}
                </legend>
                {cupo.elegibles.length === 0 ? (
                  <p className="text-[13px] text-[var(--ink-soft)]">Nada disponible para elegir acá ahora.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border)]">
                    {cupo.elegibles.map((p) => {
                      const cantidad = cantidadElegida(estado, cupo.seccionCartaId, p.productoId);
                      return (
                        <li key={p.productoId} data-producto-armar-promo={p.productoId} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0 flex-1 text-[13.5px]">{p.nombre}</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className={BOTON_CHICO}
                              aria-label={`Restar ${p.nombre} de ${cupo.nombreSeccion}`}
                              disabled={cantidad === 0}
                              onClick={() => despachar({ tipo: "decrementar", seccionCartaId: cupo.seccionCartaId, productoId: p.productoId })}
                            >
                              −
                            </button>
                            <span aria-live="polite" className="w-5 text-center text-[13.5px] tabular-nums">
                              {cantidad}
                            </span>
                            <button
                              type="button"
                              className={BOTON_CHICO}
                              aria-label={`Sumar ${p.nombre} a ${cupo.nombreSeccion}`}
                              disabled={llegoAlMaximo}
                              title={llegoAlMaximo ? `Ya elegiste el máximo de ${cupo.nombreSeccion} (${cupo.cantidadMaximaCupo}).` : undefined}
                              onClick={() => despachar({ tipo: "incrementar", seccionCartaId: cupo.seccionCartaId, productoId: p.productoId })}
                            >
                              +
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="button" disabled={!puedeConfirmar} onClick={() => onConfirmar(eleccionParaAgregar(estado))} className={BOTON_PRIMARIO}>
            Agregar promo
          </button>
        </div>
      </div>
    </div>
  );
}
