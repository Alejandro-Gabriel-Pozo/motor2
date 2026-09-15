"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";

interface Props {
  secciones: { id: string; nombre: string }[];
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
  desde: string;
  hasta: string;
}

/** Antes un `<form>` GET nativo con un `<select>` poblado con `listarProductos()` sin límite — ahora navega por `router.push` para poder usar el combobox con búsqueda server-side. */
export function HistorialFiltros({ secciones, productoId: productoIdInicial, productoEtiqueta, seccionId: seccionIdInicial, desde: desdeInicial, hasta: hastaInicial }: Props) {
  const router = useRouter();
  const [productoId, setProductoId] = useState(productoIdInicial);
  const [seccionId, setSeccionId] = useState(seccionIdInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (productoId) params.set("productoId", productoId);
    if (seccionId) params.set("seccionId", seccionId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    router.push(`/reportes/historial?${params.toString()}`);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Producto
        <SelectorProducto value={productoId} onChange={setProductoId} etiquetaInicial={productoEtiqueta} required className="w-56" />
      </label>
      <label className="flex flex-col gap-1">
        Sección (opcional)
        <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} className="rounded border px-3 py-2">
          <option value="">Todas</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Desde
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        Hasta
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded border px-3 py-2" />
      </label>
      <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
        Ver historial
      </button>
    </form>
  );
}
