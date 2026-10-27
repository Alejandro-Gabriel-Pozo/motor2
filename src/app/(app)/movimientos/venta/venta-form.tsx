"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { registrarVenta, type ItemVentaInput } from "@/server/actions/movimientos/venta";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";

interface FilaVenta {
  productoId: string;
  cantidadVendida: string;
}

const FILA_VACIA: FilaVenta = { productoId: "", cantidadVendida: "" };

// El día de hoy en Argentina (no en UTC: desde las 21:00 locales UTC ya es mañana). Esta pantalla no recibe la zona de la empresa, así que usa la constante.
function hoyISO() {
  return diaDeCalendario(new Date(), ZONA_ARGENTINA);
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
      }));

    if (!itemsValidos.length) {
      setMensaje("Cargá al menos un producto con cantidad.");
      setOk(false);
      return;
    }

    startTransition(async () => {
      const resultado = await registrarVenta({
        fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
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
      <div className="flex flex-wrap gap-3">
        <div className="min-w-36 flex-1">
          <CampoFecha etiqueta="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </div>
        <div className="min-w-36 flex-1">
          <Selector etiqueta="Depósito" value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required>
            <option value="">Elegí un depósito</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        </div>
        <div className="min-w-36 flex-1">
          <Campo etiqueta="N° de factura (opcional)" value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} maxLength={LARGO_MAXIMO_NRO_FACTURA} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos vendidos (PV)</span>
        {ventas.map((fila, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Producto</span>
              <SelectorProducto
                value={fila.productoId}
                onChange={(id) => actualizarFila(idx, { productoId: id })}
                filtro={{ tipo: "PV", soloDisponibles: true }}
                limpiarSenal={resetCount}
                required
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="font-medium">Cantidad</span>
              <CampoNumero tipo="cantidad" value={fila.cantidadVendida} onChange={(v) => actualizarFila(idx, { cantidadVendida: v })} required tamano="compacto" />
            </label>
            <Boton variante="secundario" tamano="compacto" onClick={() => quitarFila(idx)} disabled={ventas.length === 1}>
              Quitar
            </Boton>
          </div>
        ))}
        <Boton variante="enlace" tamano="en-fila" onClick={agregarFila} className="self-start">
          + Agregar producto
        </Boton>
      </div>

      <Campo etiqueta="Detalle (opcional)" value={detalle} onChange={(e) => setDetalle(e.target.value)} />

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando..." : "Confirmar venta"}
      </Boton>
    </form>
  );
}
