"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import type { QueMostrar } from "@/core/reportes/historial-vistas";

interface Props {
  secciones: { id: string; nombre: string }[];
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
  desde: string;
  hasta: string;
  queMostrar: QueMostrar;
}

const OPCIONES_QUE_MOSTRAR: { valor: QueMostrar; etiqueta: string }[] = [
  { valor: "todo", etiqueta: "Todo" },
  { valor: "compras", etiqueta: "Solo compras" },
  { valor: "consumos-ventas", etiqueta: "Solo consumos y ventas" },
  { valor: "ajustes-conteos", etiqueta: "Solo ajustes y conteos" },
];

/** Antes un `<form>` GET nativo con un `<select>` poblado con `listarProductos()` sin límite — ahora navega por `router.push` para poder usar el combobox con búsqueda server-side. */
export function HistorialFiltros({
  secciones,
  productoId: productoIdInicial,
  productoEtiqueta,
  seccionId: seccionIdInicial,
  desde: desdeInicial,
  hasta: hastaInicial,
  queMostrar: queMostrarInicial,
}: Props) {
  const router = useRouter();
  const [productoId, setProductoId] = useState(productoIdInicial);
  const [seccionId, setSeccionId] = useState(seccionIdInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [queMostrar, setQueMostrar] = useState<QueMostrar>(queMostrarInicial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (productoId) params.set("productoId", productoId);
    if (seccionId) params.set("seccionId", seccionId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (queMostrar !== "todo") params.set("queMostrar", queMostrar);
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
      <div className="flex flex-col gap-1">
        {/* label AL LADO del <select>, no envolviéndolo — uno que lo envuelve suma el texto de la opción vigente a su nombre accesible (ver selector-rango.tsx). */}
        <label htmlFor="que-mostrar">Qué mostrar</label>
        <select id="que-mostrar" value={queMostrar} onChange={(e) => setQueMostrar(e.target.value as QueMostrar)} className="rounded border px-3 py-2">
          {OPCIONES_QUE_MOSTRAR.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
        Ver historial
      </button>
    </form>
  );
}
