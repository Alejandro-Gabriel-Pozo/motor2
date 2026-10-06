"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaMargenPromocion } from "@/core/reportes/public";

const AYUDA_MARGEN =
  'Costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (mismo criterio que Período/Descuentos por cliente). "parcial" si algún componente de esa promo no se pudo costear así.';

function celdaMargen(valor: number | null, pct: number | null, reconstruido: boolean, completo: boolean) {
  if (valor === null) return <span className="text-neutral-500 dark:text-neutral-400">—</span>;
  return (
    <>
      ${valor.toLocaleString("es-AR")} ({pct}%)
      {reconstruido ? " · reconstruido" : ""}
      {!completo && <span className="text-amber-700 dark:text-amber-600"> · parcial</span>}
    </>
  );
}

const COLUMNAS: ColumnaReporte<FilaMargenPromocion>[] = [
  {
    clave: "titulo",
    etiqueta: "Promo",
    valor: (f) => f.titulo,
    render: (f) => (
      <>
        {f.titulo}
        {!f.activa && <span className="text-neutral-500 dark:text-neutral-400"> · dada de baja</span>}
      </>
    ),
  },
  { clave: "cantidadInstancias", etiqueta: "Vendida", alinear: "derecha", valor: (f) => f.cantidadInstancias, render: (f) => `${f.cantidadInstancias.toLocaleString("es-AR")} veces` },
  { clave: "ingresoALista", etiqueta: "A precio de carta", alinear: "derecha", valor: (f) => f.ingresoALista, render: (f) => `$${f.ingresoALista.toLocaleString("es-AR")}` },
  { clave: "ingresoCobrado", etiqueta: "Cobrado", alinear: "derecha", valor: (f) => f.ingresoCobrado, render: (f) => `$${f.ingresoCobrado.toLocaleString("es-AR")}` },
  {
    clave: "ahorroCliente",
    etiqueta: "Ahorro del cliente",
    alinear: "derecha",
    valor: (f) => f.ahorroCliente,
    ayuda: "A precio de carta menos cobrado: lo que el cliente se ahorró por llevar el combo en vez de pedir cada cosa suelta (D3) — no es un descuento aparte, es la promo misma.",
    render: (f) => `$${f.ahorroCliente.toLocaleString("es-AR")}${f.ahorroClientePct !== null ? ` (${f.ahorroClientePct}%)` : ""}`,
  },
  {
    clave: "margenReal",
    etiqueta: "Margen Real (cobrado)",
    alinear: "derecha",
    valor: (f) => f.margenReal,
    ayuda: AYUDA_MARGEN,
    render: (f) => celdaMargen(f.margenReal, f.margenRealPct, f.margenRealReconstruido, f.margenRealCompleto),
  },
  {
    clave: "margenRealSueltoEquivalente",
    etiqueta: "Margen Real (suelto equivalente)",
    alinear: "derecha",
    valor: (f) => f.margenRealSueltoEquivalente,
    ayuda: "El margen que hubiera dado la MISMA venta si cada componente se hubiera cobrado a precio de carta, con el mismo costo real de la columna anterior — para ver si el precio de la promo deja un margen sano.",
    render: (f) => celdaMargen(f.margenRealSueltoEquivalente, f.margenRealSueltoEquivalentePct, f.margenRealReconstruido, f.margenRealCompleto),
  },
];

export function TablaMargenPromociones({ filas }: { filas: FilaMargenPromocion[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.promoCartaId}
      sinFilasTexto="Ninguna promo armable se vendió en este rango."
      nombreExport="margen-promociones"
      ordenInicial="ingresoCobrado"
      direccionInicial="desc"
    />
  );
}
