"use client";

import { useMemo, useReducer } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { agregarItems } from "@/server/actions/pos/cuenta";
import { pediblesDeEntrada, type ProductoPedible, type SelectorCartaPos } from "@/core/pos/selector-carta";
import { estadoInicialSelectorCarta, reducirSelectorCarta } from "@/core/pos/selector-carta-estado";
import {
  estadoInicialListaPorAgregar,
  itemsDeListaPorAgregar,
  listaPorAgregarLlena,
  puedeConfirmarListaPorAgregar,
  reducirListaPorAgregar,
} from "@/core/pos/agregar-lista-estado";
import { MAXIMO_ITEMS_POR_AGREGADO } from "@/core/pos/cantidad-pedido";
import { BOTON_CHICO, BOTON_PRIMARIO, CAMPO } from "./estilos";
import { formatearCantidad, formatearMonto } from "@/core/pos/formato";
import { SelectorCarta } from "./selector-carta";
import { useAccionMesa } from "./usar-accion";

/**
 * Suma productos a una lista «Por agregar» DEL CLIENTE (nunca guardada hasta confirmar, docs/plan-pos-agregar-varios-2026-09-26.md)
 * y los manda TODOS JUNTOS a la cuenta en un solo `agregarItems(cuentaId, líneas)` — quedan en «Sin enviar» hasta «Enviar a
 * cocina», como siempre; ese botón sigue sacando un solo KOT sin cambios ahí. Antes, cada «Agregar» era un viaje al servidor por
 * producto: elegir varias cosas para la misma mesa obligaba a esperar y re-elegir cantidad una por una antes de poder mandar algo
 * a cocina.
 *
 * Tocar un producto —en la grilla de carta (`SelectorCarta`) o elegirlo en el buscador (`SelectorProducto`)— lo suma con cantidad
 * 1; tocarlo de nuevo (o volver a elegirlo) ACUMULA en la MISMA línea, nunca abre una segunda. La cantidad de cada línea se edita
 * con los botones −/+ o tecleando (parser `interpretarNumero`, nunca `Number(...)` a secas); al salir del campo se normaliza con
 * `validarCantidadPedido` — la MISMA función que usará el servidor al confirmar — así lo que se ve es lo que se va a guardar (una
 * cantidad que redondea, ej. "1,4" en una unidad entera, queda mostrada en "1", nunca oculta).
 *
 * Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): si el producto elegido tiene `pasoVenta` (ej. "se vende
 * de a 0,5"), la ayuda bajo la línea lo dice, y `normalizarCantidad` valida contra el paso en vez de redondear — una cantidad que
 * no sea múltiplo exacto se RECHAZA (mensaje a la vista), nunca se redondea en silencio.
 *
 * Todo o nada: si al confirmar algún producto dejó de estar disponible justo en ese instante, el servidor no guarda nada (misma
 * transacción serializable de `agregarItems`) y la lista del cliente queda INTACTA (no se vacía) con el error a la vista — no hay
 * que volver a elegir todo de nuevo.
 *
 * Dos reductores puros, independientes (`selector-carta-estado.ts` para qué sección/agrupado/carpeta está a la vista;
 * `agregar-lista-estado.ts` para qué hay en la lista): coexisten, uno no reemplaza al otro. Sin `pos_tomar_pedido` todo el
 * formulario queda deshabilitado (un solo `<fieldset>`).
 */
export function AgregarItems({ cuentaId, puede, selectorCarta }: { cuentaId: string; puede: boolean; selectorCarta: SelectorCartaPos | null }) {
  const { ejecutar, pending, error } = useAccionMesa();
  const [estado, despachar] = useReducer(reducirSelectorCarta, selectorCarta, estadoInicialSelectorCarta);
  const [lista, despacharLista] = useReducer(reducirListaPorAgregar, estadoInicialListaPorAgregar());
  const hayCarta = !!selectorCarta && selectorCarta.seccionesCarta.length > 0;

  // Para mostrar nombre/precio/decimales de cada línea: cualquier pedible, lo haya sumado la carta o el buscador — la carta
  // pública no lo tiene todo (DP1/DP2: «Fuera de carta»), así que se busca en el selector completo, no en `selectorCarta.seccionesCarta` solo.
  const pediblePorId = useMemo(() => {
    const todos: ProductoPedible[] = [
      ...(selectorCarta?.seccionesCarta ?? []).flatMap((s) => s.entradas.flatMap(pediblesDeEntrada)),
      ...(selectorCarta?.fueraDeCarta ?? []),
    ];
    return new Map(todos.map((p) => [p.productoId, p]));
  }, [selectorCarta]);

  const llena = listaPorAgregarLlena(lista, MAXIMO_ITEMS_POR_AGREGADO);
  const puedeConfirmar = puedeConfirmarListaPorAgregar(lista);

  /** Tocar un producto —desde la carta o el buscador—: lo suma a la lista y limpia el buscador / cierra el agrupado suelto (G3). */
  const sumar = (productoId: string) => {
    despacharLista({ tipo: "sumarProducto", productoId, tope: MAXIMO_ITEMS_POR_AGREGADO });
    despachar({ tipo: "productoSumado" });
  };

  const confirmar = () => {
    ejecutar(
      () => agregarItems(cuentaId, itemsDeListaPorAgregar(lista)),
      () => despacharLista({ tipo: "vaciar" })
    );
  };

  return (
    // Sin `action` ni `onSubmit` real: Enter en cualquier campo (el buscador, la cantidad de una línea) NO tiene que confirmar
    // nada (precedente: test/e2e/form-con-resultado-enter.spec.ts) — y, sin este `onSubmit` que lo frena, el navegador haría un
    // submit NATIVO (recarga de la página, GET a la URL actual) que además borraría la lista «Por agregar» del cliente. El botón
    // de confirmar es `type="button"` con su propio `onClick` (`confirmar`), nunca el submit del formulario.
    <form aria-label="Agregar producto" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <fieldset disabled={!puede} title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="agregar-producto" className="text-[12.5px] font-semibold">
              Producto
            </label>
            <SelectorProducto
              id="agregar-producto"
              value=""
              onChange={(id) => {
                if (id) sumar(id);
              }}
              filtro={{ tipo: "PV", soloDisponibles: true }}
              placeholder="Buscar por nombre o código…"
              limpiarSenal={estado.limpiarBuscador}
              siempreClaro
            />
          </div>
        </div>
        {hayCarta && <SelectorCarta selector={selectorCarta} estado={estado} lista={lista} despachar={despachar} sumar={sumar} />}
        {llena && <p className="text-[13px] text-[var(--ink-soft)]">Llegaste al máximo de {MAXIMO_ITEMS_POR_AGREGADO} productos distintos: sacá alguno de la lista antes de sumar otro.</p>}

        <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--border)] bg-[#F1EFEA] p-3">
          <h2 className="text-[14px] font-bold">Por agregar · {lista.lineas.length}</h2>
          {lista.lineas.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-soft)]">Ningún producto elegido todavía: tocá uno de la carta o buscalo por nombre o código.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {lista.lineas.flatMap((l) => {
                const p = pediblePorId.get(l.productoId);
                if (!p) return []; // defensivo: nunca debería faltar (todo pedible sale del mismo selector)
                const idError = `error-linea-${l.productoId}`;
                return [
                  <li key={l.productoId} data-linea-por-agregar={p.nombre} className="flex flex-col gap-1 bg-white py-2 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                      <span className="min-w-0 flex-1 text-[14px] font-semibold">{p.nombre}</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" className={BOTON_CHICO} aria-label={`Restar uno a ${p.nombre}`} onClick={() => despacharLista({ tipo: "decrementar", productoId: l.productoId })}>
                          −
                        </button>
                        <input
                          aria-label={`Cantidad de ${p.nombre}`}
                          inputMode="decimal"
                          autoComplete="off"
                          value={l.cantidadTexto}
                          onChange={(e) => despacharLista({ tipo: "cambiarCantidadTexto", productoId: l.productoId, texto: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() =>
                            despacharLista({
                              tipo: "normalizarCantidad",
                              productoId: l.productoId,
                              decimales: p.decimales,
                              pasoVenta: p.pasoVenta,
                              tieneStockReal: p.tieneStockReal,
                            })
                          }
                          aria-invalid={l.error ? true : undefined}
                          aria-describedby={l.error ? idError : p.pasoVenta ? `${idError}-ayuda` : undefined}
                          className={`${CAMPO} w-16 text-center tabular-nums`}
                        />
                        <button type="button" className={BOTON_CHICO} aria-label={`Sumar uno a ${p.nombre}`} onClick={() => despacharLista({ tipo: "incrementar", productoId: l.productoId })}>
                          +
                        </button>
                        <span className="w-24 text-right text-[13.5px] tabular-nums">{formatearMonto(l.cantidad * p.precio)}</span>
                        <button
                          type="button"
                          className={BOTON_CHICO}
                          aria-label={`Quitar ${p.nombre} de la lista`}
                          onClick={() => despacharLista({ tipo: "quitarLinea", productoId: l.productoId })}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                    {l.error ? (
                      <p id={idError} role="alert" className="px-2 text-[12.5px] text-red-700">
                        {l.error}
                      </p>
                    ) : (
                      p.pasoVenta && (
                        <p id={`${idError}-ayuda`} className="px-2 text-[12.5px] text-[var(--ink-soft)]">
                          Se vende de a {formatearCantidad(p.pasoVenta)}.
                        </p>
                      )
                    )}
                  </li>,
                ];
              })}
            </ul>
          )}
          <button type="button" className={BOTON_PRIMARIO} disabled={pending || !puedeConfirmar} onClick={confirmar}>
            {pending ? "Agregando…" : `Agregar ${lista.lineas.length} al pedido`}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
