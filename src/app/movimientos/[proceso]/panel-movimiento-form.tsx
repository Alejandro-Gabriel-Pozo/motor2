"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DestinoConsumo, MotivoMerma } from "@prisma/client";
import { registrarMovimiento, type ItemMovimientoInput } from "@/server/actions/movimientos";
import { MOTIVOS_MERMA, DESTINOS_CONSUMO, type ProcesoUiConfig } from "@/core/movimientos/ui-config";
import { SelectorProducto } from "@/components/selector-producto";

interface Opcion {
  id: string;
  nombre: string;
}

interface FilaItem {
  productoId: string;
  cantidad: string;
  loteVencimiento: string;
  precioTotal: string;
  pesoReal: string;
}

const FILA_VACIA: FilaItem = { productoId: "", cantidad: "", loteVencimiento: "", precioTotal: "", pesoReal: "" };

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function PanelMovimientoForm({
  config,
  secciones,
  proveedores,
}: {
  config: ProcesoUiConfig;
  secciones: Opcion[];
  proveedores: Opcion[];
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyISO());
  const [seccionId, setSeccionId] = useState("");
  const [seccionDestinoId, setSeccionDestinoId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [nroFactura, setNroFactura] = useState("");
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("");
  const [detalleLibre, setDetalleLibre] = useState("");
  const [items, setItems] = useState<FilaItem[]>([{ ...FILA_VACIA }]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  const actualizarFila = (idx: number, cambios: Partial<FilaItem>) => {
    setItems((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  };

  const agregarFila = () => setItems((prev) => [...prev, { ...FILA_VACIA }]);
  const quitarFila = (idx: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const itemsValidos: ItemMovimientoInput[] = items
      .filter((f) => f.productoId && f.cantidad !== "")
      .map((f) => ({
        productoId: f.productoId,
        cantidad: Number(f.cantidad),
        loteVencimiento: f.loteVencimiento ? new Date(f.loteVencimiento) : null,
        precioTotal: f.precioTotal ? Number(f.precioTotal) : undefined,
        pesoReal: f.pesoReal ? Number(f.pesoReal) : null,
      }));

    if (!itemsValidos.length) {
      setMensaje("Cargá al menos un producto con cantidad.");
      setOk(false);
      return;
    }

    startTransition(async () => {
      const resultado = await registrarMovimiento({
        proceso: config.proceso,
        fecha: new Date(fecha),
        seccionId,
        seccionDestinoId: config.proceso === "TRANSFERENCIA" ? seccionDestinoId : undefined,
        proveedorId: proveedorId || undefined,
        nroFactura: nroFactura || undefined,
        motivo: config.pideMotivo && motivo ? (motivo as MotivoMerma) : undefined,
        destino: config.pideDestino && destino ? (destino as DestinoConsumo) : undefined,
        detalleLibre: detalleLibre || undefined,
        items: itemsValidos,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setItems([{ ...FILA_VACIA }]);
        setResetCount((n) => n + 1);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {config.proceso === "TRANSFERENCIA" ? "Sección origen" : "Sección"}
          <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        {config.proceso === "TRANSFERENCIA" && (
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Sección destino
            <select value={seccionDestinoId} onChange={(e) => setSeccionDestinoId(e.target.value)} required className="rounded border px-3 py-2">
              <option value="">Elegí una sección</option>
              {secciones.filter((s) => s.id !== seccionId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {config.requiereProveedor && (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Proveedor
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="rounded border px-3 py-2">
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            N° de factura
            <input value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} className="rounded border px-3 py-2" />
          </label>
        </div>
      )}

      {config.pideMotivo && (
        <label className="flex flex-col gap-1 text-sm">
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí un motivo</option>
            {MOTIVOS_MERMA.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {config.pideDestino && (
        <label className="flex flex-col gap-1 text-sm">
          Destino
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="rounded border px-3 py-2">
            <option value="">Sin destino específico</option>
            {DESTINOS_CONSUMO.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos</span>
        {items.map((fila, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="flex flex-1 min-w-40 flex-col gap-1 text-xs text-neutral-500">
              Producto
              <SelectorProducto
                value={fila.productoId}
                onChange={(id) => actualizarFila(idx, { productoId: id })}
                filtro={{ soloActivos: true }}
                limpiarSenal={resetCount}
                required
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-neutral-500">
              Cantidad
              <input
                type="number"
                step="any"
                min={config.cantidadConSigno ? undefined : 0}
                value={fila.cantidad}
                onChange={(e) => actualizarFila(idx, { cantidad: e.target.value })}
                required
                className="rounded border px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs text-neutral-500">
              Lote (Fecha VTO.)
              <input
                type="date"
                value={fila.loteVencimiento}
                onChange={(e) => actualizarFila(idx, { loteVencimiento: e.target.value })}
                className="rounded border px-2 py-1.5 text-sm"
              />
            </label>
            {config.esCompraLike && (
              <>
                <label className="flex w-32 flex-col gap-1 text-xs text-neutral-500">
                  Precio total
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={fila.precioTotal}
                    onChange={(e) => actualizarFila(idx, { precioTotal: e.target.value })}
                    className="rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-neutral-500">
                  Peso real
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={fila.pesoReal}
                    onChange={(e) => actualizarFila(idx, { pesoReal: e.target.value })}
                    className="rounded border px-2 py-1.5 text-sm"
                  />
                </label>
              </>
            )}
            <button
              type="button"
              onClick={() => quitarFila(idx)}
              disabled={items.length === 1}
              className="rounded border px-2 py-1.5 text-sm text-neutral-500 disabled:opacity-30"
            >
              Quitar
            </button>
          </div>
        ))}
        <button type="button" onClick={agregarFila} className="self-start text-sm underline">
          + Agregar producto
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Detalle (opcional)
        <input value={detalleLibre} onChange={(e) => setDetalleLibre(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Confirmar"}
      </button>
    </form>
  );
}
