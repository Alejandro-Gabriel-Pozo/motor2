"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";

interface Props {
  secciones: { id: string; nombre: string }[];
  seccionId: string;
  productoId: string;
  productoEtiqueta: string;
  desde: string;
  hasta: string;
}

/**
 * obtenerHistorialConteosFisicos ya soportaba seccionId (y era trivial
 * agregarle productoId/rango de fechas), pero la página nunca los
 * exponía — a diferencia de casi todos los demás reportes del módulo
 * (mismo patrón que HistorialFiltros en /reportes/historial).
 */
export function FiltrosConteos({ secciones, seccionId: seccionIdInicial, productoId: productoIdInicial, productoEtiqueta, desde: desdeInicial, hasta: hastaInicial }: Props) {
  const router = useRouter();
  const [seccionId, setSeccionId] = useState(seccionIdInicial);
  const [productoId, setProductoId] = useState(productoIdInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (seccionId) params.set("seccionId", seccionId);
    if (productoId) params.set("productoId", productoId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    router.push(`/reportes/conteos?${params.toString()}`);
  };

  const hayFiltro = Boolean(seccionIdInicial || productoIdInicial || desdeInicial || hastaInicial);

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {/* El selector de producto es un combobox que no lleva su propia etiqueta: lo nombra este <label> de afuera. */}
      <label className="flex flex-col gap-1 font-medium">
        Producto (opcional)
        <SelectorProducto value={productoId} onChange={setProductoId} etiquetaInicial={productoEtiqueta} className="w-56" />
      </label>
      <Selector etiqueta="Sección (opcional)" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
        <option value="">Todas</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </Selector>
      <CampoFecha etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
      <CampoFecha etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      <Boton type="submit">Filtrar</Boton>
      {hayFiltro && (
        <Boton variante="enlace" tamano="en-fila" onClick={() => router.push("/reportes/conteos")}>
          Limpiar
        </Boton>
      )}
    </form>
  );
}
