"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";
import type { QueMostrar, RangoHistorial } from "@/core/reportes/public";

interface Props {
  secciones: { id: string; nombre: string }[];
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
  desde: string;
  hasta: string;
  queMostrar: QueMostrar;
  rango: RangoHistorial;
}

const OPCIONES_QUE_MOSTRAR: { valor: QueMostrar; etiqueta: string }[] = [
  { valor: "todo", etiqueta: "Todo" },
  { valor: "compras", etiqueta: "Solo compras" },
  { valor: "consumos-ventas", etiqueta: "Solo consumos y ventas" },
  { valor: "ajustes-conteos", etiqueta: "Solo ajustes y conteos" },
];

const OPCIONES_RANGO: { valor: RangoHistorial; etiqueta: string }[] = [
  { valor: "10d", etiqueta: "Últimos 10 días" },
  { valor: "90d", etiqueta: "Últimos 90 días" },
  { valor: "todo", etiqueta: "Todo el historial" },
  { valor: "personalizado", etiqueta: "Fechas personalizadas" },
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
  rango: rangoInicial,
}: Props) {
  const router = useRouter();
  const [productoId, setProductoId] = useState(productoIdInicial);
  const [seccionId, setSeccionId] = useState(seccionIdInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [queMostrar, setQueMostrar] = useState<QueMostrar>(queMostrarInicial);
  const [rango, setRango] = useState<RangoHistorial>(rangoInicial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (productoId) params.set("productoId", productoId);
    if (seccionId) params.set("seccionId", seccionId);
    if (rango === "personalizado") {
      params.set("rango", "personalizado"); // así un submit sin tocar los inputs (que recién se muestran acá) sigue siendo "personalizado", no cae al default.
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
    } else if (rango === "todo" || rango === "90d") {
      params.set("rango", rango);
    }
    // rango === "10d": es el default, no se escribe nada (URL limpia — mismo criterio que SelectorRango).
    if (queMostrar !== "todo") params.set("queMostrar", queMostrar);
    router.push(`/reportes/historial?${params.toString()}`);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {/* El selector de producto es un combobox que no lleva su propia etiqueta: lo nombra este <label> de afuera. */}
      <label className="flex flex-col gap-1 font-medium">
        Producto
        <SelectorProducto value={productoId} onChange={setProductoId} etiquetaInicial={productoEtiqueta} required className="w-56" />
      </label>
      <Selector etiqueta="Sección (opcional)" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
        <option value="">Todas</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </Selector>
      {/* La etiqueta de Selector va AL LADO del <select> (htmlFor), no envolviéndolo: una que lo envuelve suma el texto de la opción vigente a su nombre accesible (ver selector-rango.tsx). */}
      <Selector id="rango-historial" etiqueta="Rango" value={rango} onChange={(e) => setRango(e.target.value as RangoHistorial)}>
        {OPCIONES_RANGO.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      {rango === "personalizado" && (
        <>
          <CampoFecha etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <CampoFecha etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </>
      )}
      <Selector id="que-mostrar" etiqueta="Qué mostrar" value={queMostrar} onChange={(e) => setQueMostrar(e.target.value as QueMostrar)}>
        {OPCIONES_QUE_MOSTRAR.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      <Boton type="submit">Ver historial</Boton>
    </form>
  );
}
