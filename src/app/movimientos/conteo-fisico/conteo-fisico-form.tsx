"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AccionConteo } from "@prisma/client";
import { registrarConteoFisico } from "@/server/actions/conteo-fisico";
import { SelectorProducto } from "@/components/selector-producto";

const ACCIONES: { value: AccionConteo; label: string }[] = [
  { value: "AJUSTAR", label: "Ajustar el stock — la diferencia es real" },
  { value: "FALTA_MOVIMIENTO", label: "Falta cargar un movimiento — no ajustar todavía" },
  { value: "DESCARTAR", label: "Conté mal — descartar este conteo" },
];

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function ConteoFisicoForm({ secciones }: { secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [fechaConteo, setFechaConteo] = useState(hoyISO());
  const [productoId, setProductoId] = useState("");
  const [seccionId, setSeccionId] = useState("");
  const [loteVencimiento, setLoteVencimiento] = useState("");
  const [conteoReal, setConteoReal] = useState("");
  const [accion, setAccion] = useState<AccionConteo>("AJUSTAR");
  const [detalle, setDetalle] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const resultado = await registrarConteoFisico({
        productoId,
        seccionId,
        loteVencimiento: loteVencimiento ? new Date(loteVencimiento) : null,
        conteoReal: Number(conteoReal),
        fechaConteo: new Date(fechaConteo),
        accion,
        detalle: detalle || undefined,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setProductoId("");
        setConteoReal("");
        setLoteVencimiento("");
        setDetalle("");
        setResetCount((n) => n + 1);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Fecha del conteo
          <input type="date" value={fechaConteo} onChange={(e) => setFechaConteo(e.target.value)} required className="rounded border px-3 py-2" />
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
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto
          value={productoId}
          onChange={setProductoId}
          filtro={{ soloActivos: true, soloConStockReal: true }}
          limpiarSenal={resetCount}
          required
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Lote contado (opcional — vacío = total de todos los lotes de la sección)
          <input type="date" value={loteVencimiento} onChange={(e) => setLoteVencimiento(e.target.value)} className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Conteo real
          <input type="number" step="any" min={0} value={conteoReal} onChange={(e) => setConteoReal(e.target.value)} required className="rounded border px-3 py-2" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        ¿Qué hacer con la diferencia?
        <select value={accion} onChange={(e) => setAccion(e.target.value as AccionConteo)} className="rounded border px-3 py-2">
          {ACCIONES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Detalle / causa (opcional)
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Registrar conteo"}
      </button>
    </form>
  );
}
