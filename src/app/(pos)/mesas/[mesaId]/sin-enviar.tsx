"use client";

import { enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "@/server/actions/pos/cuenta-pedido";
import { useState } from "react";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { agruparConAdicionales, elegidasDeLaLinea, formatearCantidad, formatearMonto } from "@/core/pos/public";
import { useImpresion } from "./imprimir";
import { OtroIgual } from "./otro-igual";
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
  /** GO-2d (ADR-030): el producto, el nombre compuesto de la línea («Café solo chico») con su detalle de lo incluido, la línea de la que cuelga un adicional y lo elegido (para «Otro igual»). Ausentes sin opciones. */
  productoId?: string;
  nombreDeLinea?: string;
  detalleDeLinea?: string;
  lineaPadreId?: string;
  elegidas?: { opcionId: string; cantidad: number }[];
}

/** Un renglón «sin enviar» a mostrar: un suelto de siempre (GO-2d: con sus adicionales debajo), o el grupo entero de los componentes de UNA promo (D4). */
type FilaSinEnviar = { tipo: "suelto"; item: ItemSinEnviar; adicionales: ItemSinEnviar[] } | { tipo: "promo"; promoCuentaId: string; titulo: string; items: ItemSinEnviar[] };

/** Agrupa por `promoCuentaId` (D4: una promo se quita entera, nunca un componente suelto), en el orden de aparición. GO-2d: cada adicional va bajo su producto. */
function agruparFilas(items: ItemSinEnviar[]): FilaSinEnviar[] {
  const filas: FilaSinEnviar[] = [];
  const indicePorPromo = new Map<string, number>();
  for (const { item, adicionales } of agruparConAdicionales(items)) {
    if (!item.promoCuentaId) {
      filas.push({ tipo: "suelto", item, adicionales });
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
 *
 * GO-2d (ADR-030): una línea con opciones muestra su nombre compuesto (y lo incluido debajo) y sus adicionales con sangría («+ 1 × Huevo frito», con su importe), sin «Quitar» propio: se quitan con su
 * producto (lo hace el servidor, `quitarItemSinEnviar`), y por eso «Quitar» en un producto con adicionales pide confirmar avisándolo. «Otro igual» abre «Elegir opciones» con
 * esa misma elección.
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
    <section aria-labelledby="sin-enviar-titulo" className="rounded-[14px] border border-borde bg-superficie p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="sin-enviar-titulo" className="text-base font-bold">
          Sin enviar · {items.filter((i) => !i.lineaPadreId).length}
        </h2>
        {items.length > 0 && (
          <Boton variante="acento" disabled={!puedeEnviar || pending} title={sinPermisoEnviar} onClick={enviar}>
            {pending ? "Enviando…" : "Enviar a cocina"}
          </Boton>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-tinta-suave">No hay nada pendiente de enviar.</p>
      ) : (
        <ul className="divide-y divide-borde">
          {filas.map((fila) =>
            fila.tipo === "suelto" ? (
              <li key={fila.item.id} data-item-sin-enviar={fila.item.productoNombre} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold tabular-nums">{formatearCantidad(fila.item.cantidad)} ×</span> {fila.item.nombreDeLinea ?? fila.item.productoNombre}
                    {fila.item.detalleDeLinea && (
                      <span data-opciones-de-linea className="block text-sm text-tinta-suave">
                        {fila.item.detalleDeLinea}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="tabular-nums">
                      {fila.item.precioListaUnitario !== null && <s data-precio-lista className="mr-1 text-tinta-suave">{formatearMonto(fila.item.cantidad * fila.item.precioListaUnitario)}</s>}
                      {formatearMonto(fila.item.cantidad * fila.item.precioUnitario)}
                    </span>
                    {fila.item.productoId && elegidasDeLaLinea(fila).length > 0 && (
                      <OtroIgual pedido={{ productoId: fila.item.productoId, elegidas: elegidasDeLaLinea(fila) }} titulo={fila.item.productoNombre} puede={puede} />
                    )}
                    <QuitarLinea
                      nombre={fila.item.productoNombre}
                      conAdicionales={fila.adicionales.length > 0}
                      deshabilitado={!puede || pending}
                      title={sinPermiso}
                      quitar={() => ejecutar(() => quitarItemSinEnviar(fila.item.id))}
                    />
                  </span>
                </div>
                {fila.adicionales.length > 0 && (
                  <ul aria-label={`Adicionales de ${fila.item.productoNombre}`} className="mt-1 space-y-0.5 pl-4 text-sm">
                    {fila.adicionales.map((a) => (
                      <li key={a.id} data-adicional-sin-enviar={a.productoNombre} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          + <span className="tabular-nums">{formatearCantidad(a.cantidad)} ×</span> {a.productoNombre}
                        </span>
                        <span className="tabular-nums">{formatearMonto(a.cantidad * a.precioUnitario)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={fila.promoCuentaId} data-promo-sin-enviar={fila.titulo} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{fila.titulo}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{formatearMonto(fila.items.reduce((suma, i) => suma + i.cantidad * i.precioUnitario, 0))}</span>
                    <Boton
                      variante="secundario"
                      tamano="compacto"
                      className="min-w-11"
                      disabled={!puede || pending}
                      title={sinPermiso}
                      aria-label={`Quitar promo ${fila.titulo}`}
                      onClick={() => ejecutar(() => quitarPromoSinEnviar(fila.promoCuentaId))}
                    >
                      Quitar promo
                    </Boton>
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 pl-4 text-sm text-tinta-suave">
                  {fila.items.map((i) => (
                    <li key={i.id} data-item-sin-enviar={i.productoNombre}>
                      <span className="tabular-nums">{formatearCantidad(i.cantidad)} ×</span> {i.nombreDeLinea ?? i.productoNombre}
                    </li>
                  ))}
                </ul>
              </li>
            )
          )}
        </ul>
      )}
      {error && (
        <Aviso variante="error" forma="en-linea" className="mt-2">
          {error}
        </Aviso>
      )}
    </section>
  );
}

/**
 * GO-2d: «Quitar» de una línea sin enviar. Si el producto tiene adicionales, el primer toque pide confirmar («se quitan también sus adicionales»): el servidor los borra juntos.
 * Sin adicionales, quita con un toque como siempre.
 */
function QuitarLinea({ nombre, conAdicionales, deshabilitado, title, quitar }: { nombre: string; conAdicionales: boolean; deshabilitado: boolean; title?: string; quitar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  if (confirmando) {
    return (
      <span role="group" aria-label={`Quitar ${nombre} con sus adicionales`} className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-tinta-suave">Se quitan también sus adicionales.</span>
        <Boton
          variante="secundario"
          tamano="compacto"
          className="min-w-11"
          disabled={deshabilitado}
          onClick={() => {
            setConfirmando(false);
            quitar();
          }}
        >
          Sí, quitar
        </Boton>
        <Boton variante="secundario" tamano="compacto" className="min-w-11" onClick={() => setConfirmando(false)}>
          No
        </Boton>
      </span>
    );
  }
  return (
    <Boton
      variante="secundario"
      tamano="compacto"
      className="min-w-11"
      disabled={deshabilitado}
      title={title}
      aria-label={`Quitar ${nombre}`}
      onClick={() => (conAdicionales ? setConfirmando(true) : quitar())}
    >
      Quitar
    </Boton>
  );
}
