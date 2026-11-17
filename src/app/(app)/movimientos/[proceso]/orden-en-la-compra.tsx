"use client";

import { useState } from "react";
import { listarOrdenesParaElegir } from "@/server/actions/movimientos/ordenes-de-compra";
import type { OrdenParaMostrar } from "@/server/consultas/movimientos/ordenes-de-compra";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { formatearCantidad } from "@/core/pos/public";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";

/**
 * Compras, orden de compra (etapa OC): cargar la compra CONTRA una orden pedida (opcional). Lo que sabe la pantalla de compra por pasos sobre la orden vive acá: las órdenes pedidas del proveedor elegido, la elegida (vacío = sin orden: la compra sigue
 * como siempre) y, por renglón, a qué línea de la orden corresponde y si se confirma recibir más de lo pedido. Nada viene elegido ni tildado: cada vínculo es una decisión de quien carga.
 */
export interface VinculoDeFila {
  /** El número de la línea de la orden contra la que se recibe el renglón; vacío = ninguna. */
  lineaDeOrden: string;
  /** Confirmo recibir más de lo pedido en esa línea (nace sin tildar). */
  confirmoExceso: boolean;
}

export const sinVinculoConLaOrden = <F extends VinculoDeFila>(f: F): F => ({ ...f, lineaDeOrden: "", confirmoExceso: false });

/** Las órdenes pedidas del proveedor y la elegida. Con `habilitadas` en falso (módulo apagado o sin permiso de ver) no pide nada. */
export function useOrdenDeLaCompra(habilitadas: boolean) {
  const leer = useLeerServidor();
  const [ordenes, setOrdenes] = useState<OrdenParaMostrar[]>([]);
  const [ordenId, setOrdenId] = useState("");
  const limpiar = () => {
    setOrdenId("");
    setOrdenes([]);
  };
  const cargarDelProveedor = (proveedorId: string) => {
    limpiar();
    if (!habilitadas || !proveedorId) return;
    void leer(
      () => listarOrdenesParaElegir(proveedorId),
      () => setOrdenes([])
    ).then((lista) => {
      if (lista) setOrdenes(lista);
    });
  };
  return { ordenes, ordenId, setOrdenId, limpiar, cargarDelProveedor };
}

/** El pedazo de `registrarFacturaProveedor` que liga los renglones con la orden elegida (nada si no hay orden o ningún renglón eligió línea). */
export function vinculosDeLaCompra(habilitadas: boolean, ordenId: string, filas: readonly VinculoDeFila[]) {
  if (!habilitadas || !ordenId) return {};
  return { ordenDeCompra: { ordenId, renglones: filas.flatMap((f, i) => (f.lineaDeOrden ? [{ itemIndex: i, lineaDeOrden: Number(f.lineaDeOrden), confirmoExceso: f.confirmoExceso }] : [])) } };
}

export function SelectorDeOrden({ ordenes, ordenId, onCambio }: { ordenes: OrdenParaMostrar[]; ordenId: string; onCambio: (ordenId: string) => void }) {
  if (ordenes.length === 0) return null;
  return (
    <Selector etiqueta="Orden de compra (opcional)" value={ordenId} onChange={(e) => onCambio(e.target.value)}>
      <option value="">Sin orden de compra</option>
      {ordenes.map((o) => (
        <option key={o.id} value={o.id}>
          {`N.º ${o.numero ?? ""}${o.fechaDeEntregaPrevista ? ` · entrega ${o.fechaDeEntregaPrevista}` : ""}`}
        </option>
      ))}
    </Selector>
  );
}

export function VinculoDeLaFila({ orden, fila, onCambio }: { orden: OrdenParaMostrar | undefined; fila: VinculoDeFila; onCambio: (cambios: Partial<VinculoDeFila>) => void }) {
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <Selector etiqueta="Línea de la orden (opcional)" tamano="compacto" value={fila.lineaDeOrden} onChange={(e) => onCambio({ lineaDeOrden: e.target.value, confirmoExceso: false })}>
          <option value="">Ninguna</option>
          {(orden?.lineas ?? [])
            .filter((l) => !l.retirada)
            .map((l) => (
              <option key={l.numero} value={String(l.numero)}>
                {`${l.productoNombre}: pedida ${formatearCantidad(l.cantidadPedida)}, recibida ${formatearCantidad(l.cantidadRecibida ?? 0)}`}
              </option>
            ))}
        </Selector>
      </div>
      {fila.lineaDeOrden !== "" && <Casilla etiqueta="Confirmo recibir más de lo pedido" checked={fila.confirmoExceso} onChange={(e) => onCambio({ confirmoExceso: e.target.checked })} />}
    </div>
  );
}
