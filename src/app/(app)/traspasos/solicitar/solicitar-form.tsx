"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearSolicitudTransferencia } from "@/server/actions/traspasos/traspasos";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";

interface Opcion {
  id: string;
  nombre: string;
}

export function SolicitarForm({ sucursales, secciones }: { sucursales: Opcion[]; secciones: Opcion[] }) {
  const router = useRouter();
  const [origenSucursalId, setOrigenSucursalId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [seccionDestinoId, setSeccionDestinoId] = useState("");
  const [detalle, setDetalle] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const resultado = await crearSolicitudTransferencia({
        origenSucursalId,
        productoId,
        cantidad: numeroDelCampo(cantidad) ?? NaN,
        seccionDestinoId,
        detalle: detalle || undefined,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setProductoId("");
        setCantidad("");
        setDetalle("");
        setResetCount((n) => n + 1);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Sucursal a la que se lo pedís
        <select value={origenSucursalId} onChange={(e) => setOrigenSucursalId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí una sucursal</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ soloDisponibles: true }} limpiarSenal={resetCount} required />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Cantidad
        <CampoNumero value={cantidad} onChange={setCantidad} required />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Sección propia a la que tiene que entrar (cuando lo acepten)
        <select value={seccionDestinoId} onChange={(e) => setSeccionDestinoId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí una sección</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Detalle (opcional)
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Enviando..." : "Solicitar"}
      </button>
    </form>
  );
}
