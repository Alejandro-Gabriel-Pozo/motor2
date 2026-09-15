"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearEnvioDirectoTransferencia } from "@/server/actions/traspasos";

interface Opcion {
  id: string;
  nombre: string;
  codigo?: string;
}

export function EnviarForm({ sucursales, productos, secciones }: { sucursales: Opcion[]; productos: Opcion[]; secciones: Opcion[] }) {
  const router = useRouter();
  const [destinoSucursalId, setDestinoSucursalId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [seccionOrigenId, setSeccionOrigenId] = useState("");
  const [detalle, setDetalle] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const resultado = await crearEnvioDirectoTransferencia({
        destinoSucursalId,
        productoId,
        cantidad: Number(cantidad),
        seccionOrigenId,
        detalle: detalle || undefined,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setProductoId("");
        setCantidad("");
        setDetalle("");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Sucursal a la que se lo mandás
        <select value={destinoSucursalId} onChange={(e) => setDestinoSucursalId(e.target.value)} required className="rounded border px-3 py-2">
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
        <select value={productoId} onChange={(e) => setProductoId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí un producto</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} — {p.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Cantidad
        <input type="number" step="any" min={0} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required className="rounded border px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Sección propia de la que sale (se descuenta YA, al enviar)
        <select value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)} required className="rounded border px-3 py-2">
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
        {pending ? "Enviando..." : "Enviar"}
      </button>
    </form>
  );
}
