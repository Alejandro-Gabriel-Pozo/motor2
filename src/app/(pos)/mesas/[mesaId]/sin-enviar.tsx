"use client";

import { enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "@/server/actions/pos/cuenta-pedido";
import { BOTON_CHICO, BOTON_PRIMARIO } from "./estilos";
import { formatearCantidad, formatearMonto } from "@/core/pos/formato";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

export interface ItemSinEnviar {
  id: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  /** Producto con descuento: el precio de lista, antes del descuento (se muestra tachado). */
  precioListaUnitario: number | null;
  /** Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 11): la promo de la que este ítem es un componente — null en un suelto. */
  promoCuentaId: string | null;
  promoTitulo: string | null;
}

/** Un renglón «sin enviar» a mostrar: un suelto de siempre, o el grupo entero de los componentes de UNA promo (D4). */
type FilaSinEnviar = { tipo: "suelto"; item: ItemSinEnviar } | { tipo: "promo"; promoCuentaId: string; titulo: string; items: ItemSinEnviar[] };

/** Agrupa por `promoCuentaId` (D4: una promo se quita entera, nunca un componente suelto), en el orden de aparición. */
function agruparFilas(items: ItemSinEnviar[]): FilaSinEnviar[] {
  const filas: FilaSinEnviar[] = [];
  const indicePorPromo = new Map<string, number>();
  for (const item of items) {
    if (!item.promoCuentaId) {
      filas.push({ tipo: "suelto", item });
      continue;
    }
    const indice = indicePorPromo.get(item.promoCuentaId);
    if (indice === undefined) {
      indicePorPromo.set(item.promoCuentaId, filas.length);
      filas.push({ tipo: "promo", promoCuentaId: item.promoCuentaId, titulo: item.promoTitulo ?? "Promo", items: [item] });
    } else {
      (filas[indice] as { tipo: "promo"; items: ItemSinEnviar[] }).items.push(item);
    }
  }
  return filas;
}

/**
 * Los ítems que todavía no salieron a cocina (borradores): «Quitar» los borra sin pedir motivo, y «Enviar a cocina» manda los que
 * están en pantalla (sus ids: uno que otro mozo agregó recién no sale sin que se vea). Sin `pos_tomar_pedido`, solo lectura.
 *
 * Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 11, D4): los componentes de una misma promo se muestran agrupados bajo su
 * título, con un único importe (la suma) y un único «Quitar promo» — nunca un «Quitar» por componente (`quitarPromoSinEnviar`
 * ya rechaza sola una promo con algo enviado; acá ni se ofrece el botón por componente).
 *
 * Al salir bien pide imprimir la comanda del envío que el SERVIDOR dice que creó ESTA llamada (`numeroEnvio` con `envioNuevo`). Si no
 * creó ninguno (pestaña vieja: otro ya los había enviado), no imprime: esa comanda ya salió desde donde se envió.
 */
export function SinEnviar({ cuentaId, items, puede, puedeEnviar }: { cuentaId: string; items: ItemSinEnviar[]; puede: boolean; puedeEnviar: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  const { pedir } = useImpresion();
  const sinPermiso = puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos.";
  const sinPermisoEnviar = puedeEnviar ? undefined : "Tu rol puede ver la mesa pero no enviar pedidos a cocina.";
  const filas = agruparFilas(items);

  const enviar = () =>
    ejecutar(
      () => enviarACocina(cuentaId, items.map((i) => i.id)),
      (r) => {
        if (r.envioNuevo && r.numeroEnvio !== null) pedir({ tipo: "envio", numero: r.numeroEnvio });
      }
    );

  return (
    <section aria-labelledby="sin-enviar-titulo" className="rounded-[14px] border border-[var(--border)] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="sin-enviar-titulo" className="text-[15px] font-bold">
          Sin enviar · {items.length}
        </h2>
        {items.length > 0 && (
          <button type="button" className={BOTON_PRIMARIO} disabled={!puedeEnviar || pending} title={sinPermisoEnviar} onClick={enviar}>
            {pending ? "Enviando…" : "Enviar a cocina"}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-soft)]">No hay nada pendiente de enviar.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {filas.map((fila) =>
            fila.tipo === "suelto" ? (
              <li key={fila.item.id} data-item-sin-enviar={fila.item.productoNombre} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                <span>
                  <span className="font-semibold tabular-nums">{formatearCantidad(fila.item.cantidad)} ×</span> {fila.item.productoNombre}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">
                    {fila.item.precioListaUnitario !== null && <s data-precio-lista className="mr-1 text-[var(--ink-soft)]">{formatearMonto(fila.item.cantidad * fila.item.precioListaUnitario)}</s>}
                    {formatearMonto(fila.item.cantidad * fila.item.precioUnitario)}
                  </span>
                  <button
                    type="button"
                    className={BOTON_CHICO}
                    disabled={!puede || pending}
                    title={sinPermiso}
                    aria-label={`Quitar ${fila.item.productoNombre}`}
                    onClick={() => ejecutar(() => quitarItemSinEnviar(fila.item.id))}
                  >
                    Quitar
                  </button>
                </span>
              </li>
            ) : (
              <li key={fila.promoCuentaId} data-promo-sin-enviar={fila.titulo} className="py-2 text-[14px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{fila.titulo}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{formatearMonto(fila.items.reduce((suma, i) => suma + i.cantidad * i.precioUnitario, 0))}</span>
                    <button
                      type="button"
                      className={BOTON_CHICO}
                      disabled={!puede || pending}
                      title={sinPermiso}
                      aria-label={`Quitar promo ${fila.titulo}`}
                      onClick={() => ejecutar(() => quitarPromoSinEnviar(fila.promoCuentaId))}
                    >
                      Quitar promo
                    </button>
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 pl-4 text-[12.5px] text-[var(--ink-soft)]">
                  {fila.items.map((i) => (
                    <li key={i.id} data-item-sin-enviar={i.productoNombre}>
                      <span className="tabular-nums">{formatearCantidad(i.cantidad)} ×</span> {i.productoNombre}
                    </li>
                  ))}
                </ul>
              </li>
            )
          )}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
