"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { registrarVenta, type ItemVentaInput } from "@/server/actions/movimientos/venta";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";

interface FilaVenta {
  productoId: string;
  cantidadVendida: string;
  loteVencimiento: string;
}

const FILA_VACIA: FilaVenta = { productoId: "", cantidadVendida: "", loteVencimiento: "" };

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function VentaForm({ secciones }: { secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyISO());
  // TRANSICIONES.VENTA.exigeSeccion=false (transiciones.ts) — la UI puede
  // preseleccionar una sección por defecto en vez de forzar la elección.
  const [seccionId, setSeccionId] = useState(() => secciones[0]?.id ?? "");
  const [proveedorId] = useState<string | undefined>(undefined); // "a quién se vende" — mostrador por defecto (Movimientos.js:1769), sin picker en esta primera versión de la UI
  const [nroFactura, setNroFactura] = useState("");
  const [detalle, setDetalle] = useState("");
  const [ventas, setVentas] = useState<FilaVenta[]>([{ ...FILA_VACIA }]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3), reenviado tal cual en reintentos;
  // se renueva recién después de un éxito, cuando arranca un intento nuevo.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());

  const actualizarFila = (idx: number, cambios: Partial<FilaVenta>) => {
    setVentas((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  };
  const agregarFila = () => setVentas((prev) => [...prev, { ...FILA_VACIA }]);
  const quitarFila = (idx: number) => setVentas((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const itemsValidos: ItemVentaInput[] = ventas
      .filter((f) => f.productoId && f.cantidadVendida !== "")
      .map((f) => ({
        productoId: f.productoId,
        cantidadVendida: Number(f.cantidadVendida),
        loteVencimiento: f.loteVencimiento ? new Date(f.loteVencimiento) : null,
      }));

    if (!itemsValidos.length) {
      setMensaje("Cargá al menos un producto con cantidad.");
      setOk(false);
      return;
    }

    startTransition(async () => {
      const resultado = await registrarVenta({
        fecha: new Date(fecha),
        seccionId,
        proveedorId,
        nroFactura: nroFactura || undefined,
        detalle: detalle || undefined,
        ventas: itemsValidos,
        claveIdempotencia,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setVentas([{ ...FILA_VACIA }]);
        setResetCount((n) => n + 1);
        setClaveIdempotencia(crypto.randomUUID());
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
          Sección
          <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          N° de factura (opcional)
          <input value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} maxLength={LARGO_MAXIMO_NRO_FACTURA} className="rounded border px-3 py-2" />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos vendidos (PV)</span>
        {ventas.map((fila, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="flex flex-1 min-w-40 flex-col gap-1 text-xs text-neutral-500">
              Producto
              <SelectorProducto
                value={fila.productoId}
                onChange={(id) => actualizarFila(idx, { productoId: id })}
                filtro={{ tipo: "PV", soloDisponibles: true }}
                limpiarSenal={resetCount}
                required
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-neutral-500">
              Cantidad
              <CampoNumero value={fila.cantidadVendida} onChange={(v) => actualizarFila(idx, { cantidadVendida: v })} required tamano="compacto" />
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs text-neutral-500">
              Lote (solo si &quot;Se produce&quot;)
              <input
                type="date"
                value={fila.loteVencimiento}
                onChange={(e) => actualizarFila(idx, { loteVencimiento: e.target.value })}
                className="rounded border px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => quitarFila(idx)}
              disabled={ventas.length === 1}
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
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Confirmar venta"}
      </button>
    </form>
  );
}
