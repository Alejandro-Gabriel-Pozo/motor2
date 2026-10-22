"use client";

import { useEffect, useId, useReducer } from "react";
import { type EntradaPromoSelectorCarta, cantidadElegida, claveDeCupo, eleccionParaAgregar, estadoInicialArmarPromo, puedeConfirmarArmarPromo, reducirArmarPromo, totalElegidoDelCupo, type EleccionParaAgregar, formatearMonto } from "@/core/pos/public";
import { BOTON_CHICO, BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./estilos";

/**
 * Diálogo "Armar promo" (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): por cada cupo, los productos elegibles con
 * −/+ y un contador ("Entradas 1/2"). "Agregar promo" queda deshabilitado hasta que TODOS los cupos cumplan mínimo (D1) y
 * máximo — el reductor puro (`armar-promo-estado.ts`) ya impide pasar del máximo tocando +. Mismo patrón de modal que
 * `AnularItem` (backdrop, `role="dialog"`, Escape cierra). No manda nada al servidor por sí solo: al confirmar, entrega la
 * elección al padre (`AgregarItems`), que la suma a «Por agregar» junto con los sueltos — todo se manda junto recién al
 * confirmar la lista entera (`agregarItems(cuentaId, items, promos, claveIdempotencia)`). La clave de idempotencia (P3) la maneja el padre y cambia sola con el contenido de «Por agregar»: armar,
 * confirmar o quitar una promo es un cambio de contenido y renueva la clave, así que acá no hay nada que hacer con ella.
 *
 * Escape cierra con un listener a nivel `window` (`useEffect`), NO `onKeyDown` sobre el div del diálogo (a diferencia de
 * `AnularItem`, que sí puede: su campo lleva `autoFocus`): acá NINGÚN control arranca enfocado, y encima cada botón "Sumar"
 * que llega al máximo de su cupo se deshabilita A SÍ MISMO en el click que lo enfocó — el navegador le saca el foco al
 * quedar disabled (se lo lleva a `<body>`), así que un `onKeyDown` que dependa de que el foco siga DENTRO del diálogo
 * dejaría de andar justo en ese momento (hallazgo real de `test/e2e/pos-promo-combo.spec.ts`, paso 11).
 *
 * GO-2d (ADR-030): un producto con un grupo de opciones obligatorio se ve con su aviso («Con tamaño: pedilo suelto») y sin «+»: en una promo todavía no lleva opciones y el
 * servidor lo rechazaría (`PROMO_CON_OPCIONES`).
 *
 * GO-3b (ADR-032): un cupo de ENTRADAS (LISTA o DEL_DIA) muestra sus entradas de hoy por su nombre con la configuración («Café · Mediano · Almendras») y se elige con los mismos −/+; un
 * cupo FIJO se ve como «Viene con: …», sin botones (lo completa el servidor); un lugar del día sin plato cargado lo dice y no deja confirmar. Lo de los productos con opciones (`noSeArman`) no
 * aplica a una entrada: su configuración ya viene fijada.
 */
export function ArmarPromo({
  entrada,
  onCerrar,
  onConfirmar,
  noSeArman,
}: {
  entrada: EntradaPromoSelectorCarta;
  onCerrar: () => void;
  onConfirmar: (eleccion: EleccionParaAgregar[]) => void;
  /** GO-2d: productoId → por qué no se puede elegir en la promo («Con tamaño: pedilo suelto»): tiene un grupo de opciones obligatorio. Sin esto, todos se eligen como siempre. */
  noSeArman?: ReadonlyMap<string, string>;
}) {
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
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-[14px] bg-superficie p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${base}-titulo`} className="mb-1 text-lg font-extrabold tracking-tight">
          Armar «{entrada.titulo}»
        </h2>
        <p className="mb-4 text-[13px] text-tinta-suave">{formatearMonto(entrada.precio)} en total, sea cual sea lo que elijas en cada cupo.</p>

        <div className="flex flex-col gap-4">
          {estado.cupos.map((cupo) => {
            const clave = claveDeCupo(cupo);
            const total = totalElegidoDelCupo(estado, clave);
            const llegoAlMaximo = total >= cupo.cantidadMaximaCupo;
            const nombreDelCupo = "cupoId" in cupo ? cupo.nombre : cupo.nombreSeccion;
            const elegibles =
              "cupoId" in cupo
                ? cupo.entradas.map((e) => ({ clave: e.entradaId, nombre: e.nombre, noSeArma: undefined as string | undefined }))
                : cupo.elegibles.map((p) => ({ clave: p.productoId, nombre: p.nombre, noSeArma: noSeArman?.get(p.productoId) }));
            return (
              <fieldset key={clave} data-cupo-armar-promo={clave} className="flex flex-col gap-2 rounded-[12px] border border-borde p-3">
                <legend className="px-1 text-[13px] font-semibold">
                  {nombreDelCupo} · {total}/{cupo.cantidadMaximaCupo}
                  {cupo.cantidadMinima > 0 ? ` (mínimo ${cupo.cantidadMinima})` : " (opcional)"}
                </legend>
                {"cupoId" in cupo && cupo.fijo && cupo.entradas[0] ? (
                  <p data-cupo-fijo className="text-[13.5px]">
                    Viene con: {cupo.cantidadMinima > 1 ? `${cupo.cantidadMinima} × ` : ""}
                    {cupo.entradas[0].nombre}
                  </p>
                ) : elegibles.length === 0 ? (
                  <p className="text-[13px] text-tinta-suave">{"cupoId" in cupo && cupo.tipo === "DEL_DIA" ? "Todavía no se cargó el plato de hoy." : "Nada disponible para elegir acá ahora."}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-borde">
                    {elegibles.map((p) => {
                      const cantidad = cantidadElegida(estado, clave, p.clave);
                      const noSeArma = p.noSeArma;
                      return (
                        <li key={p.clave} data-producto-armar-promo={p.clave} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0 flex-1 text-[13.5px]">
                            {p.nombre}
                            {noSeArma && (
                              <span data-no-se-arma className="block text-[12.5px] text-tinta-suave">
                                {noSeArma}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className={BOTON_CHICO}
                              aria-label={`Restar ${p.nombre} de ${nombreDelCupo}`}
                              disabled={cantidad === 0}
                              onClick={() => despachar({ tipo: "decrementar", seccionCartaId: clave, productoId: p.clave })}
                            >
                              −
                            </button>
                            <span aria-live="polite" className="w-5 text-center text-[13.5px] tabular-nums">
                              {cantidad}
                            </span>
                            <button
                              type="button"
                              className={BOTON_CHICO}
                              aria-label={`Sumar ${p.nombre} a ${nombreDelCupo}`}
                              disabled={llegoAlMaximo || noSeArma !== undefined}
                              title={noSeArma ?? (llegoAlMaximo ? `Ya elegiste el máximo de ${nombreDelCupo} (${cupo.cantidadMaximaCupo}).` : undefined)}
                              onClick={() => despachar({ tipo: "incrementar", seccionCartaId: clave, productoId: p.clave })}
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
