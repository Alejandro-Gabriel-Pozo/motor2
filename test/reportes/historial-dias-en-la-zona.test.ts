import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { EventoHistorialProducto, ResumenCompras } from "../../src/core/reportes/public";
import { ZONA_UTC } from "../../src/core/tiempo/zona-horaria";
import { TablaHistorialEventos } from "../../src/app/(app)/reportes/historial/tabla-historial";
import { GraficoSaldoCorriente } from "../../src/app/(app)/reportes/historial/grafico-saldo";
import { ComoSeCompro } from "../../src/app/(app)/reportes/historial/como-se-compro";

/**
 * P1, paso 5 (la presentación de Historial): el día que muestran la tabla del Kardex, el gráfico del saldo y «Cómo se compró» es el día de calendario en la zona de la empresa, no el
 * día UTC. Una operación de las 22:30 argentinas del 30/9 (01:30Z del 1/10) se ve el 30/9. Los componentes se llaman como funciones y se mira lo que le arman a la tabla y al gráfico
 * (mismo método que `historial-pagina-sin-dinero.test.ts`), sin dibujar nada.
 */

const NOCHE_DEL_30 = new Date("2026-09-30T22:30:00-03:00"); // 01:30Z del 1/10
const NOCHE_DEL_29 = new Date("2026-09-29T22:30:00-03:00"); // 01:30Z del 30/9

/** Todos los elementos del árbol cuyas props cumplen `pred`. */
function hallar(nodo: ReactNode, pred: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const hallados: Record<string, unknown>[] = [];
  const recorrer = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(recorrer);
    if (!n || typeof n !== "object" || !("props" in n)) return;
    const el = n as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (pred(el.props)) hallados.push(el.props);
    recorrer(el.props.children);
  };
  recorrer(nodo);
  return hallados;
}

/** El día que pinta (y exporta) la primera columna de la tabla que arma un componente, para cada fila. */
function diasDeLaTabla<T>(arbol: ReactNode): { render: string[]; valor: string[] } {
  const [tabla] = hallar(arbol, (p) => Array.isArray(p.columnas) && Array.isArray(p.filas));
  const columna = (tabla.columnas as { clave: string; valor: (f: T) => unknown; render: (f: T) => unknown }[]).find((c) => c.clave === "fecha")!;
  const filas = tabla.filas as T[];
  return { render: filas.map((f) => String(columna.render(f))), valor: filas.map((f) => String(columna.valor(f))) };
}

const movimiento = (fecha: Date, extra: Partial<EventoHistorialProducto> = {}): EventoHistorialProducto => ({
  tipo: "movimiento",
  fecha,
  detalle: "x",
  seccionNombre: "Cocina",
  proceso: "COMPRA",
  cantidadConSigno: 1,
  saldoCorriente: 1,
  ...extra,
});

describe("el día que muestra Historial es el de la zona de la empresa (P1, paso 5)", () => {
  it("tabla del Kardex: la fila de las 22:30 del 30/9 dice 2026-09-30 (pintada y exportada); con otra zona, 2026-10-01", () => {
    const filas = [movimiento(NOCHE_DEL_30)];
    expect(diasDeLaTabla(TablaHistorialEventos({ filas, nombreExport: "h" }))).toEqual({ render: ["2026-09-30"], valor: ["2026-09-30"] });
    expect(diasDeLaTabla(TablaHistorialEventos({ filas, nombreExport: "h", zona: ZONA_UTC }))).toEqual({ render: ["2026-10-01"], valor: ["2026-10-01"] });
  });

  it("gráfico del saldo: cada punto lleva el día de la zona", () => {
    const eventos = [movimiento(NOCHE_DEL_29, { saldoCorriente: 1 }), movimiento(NOCHE_DEL_30, { saldoCorriente: 2 })];
    const dias = (zona?: string) => {
      const [grafica] = hallar(GraficoSaldoCorriente({ eventos, unidadStockNombre: "kg", zona }), (p) => Array.isArray(p.data));
      return (grafica.data as { fecha: string }[]).map((pt) => pt.fecha);
    };
    expect(dias()).toEqual(["2026-09-29", "2026-09-30"]);
    expect(dias(ZONA_UTC)).toEqual(["2026-09-30", "2026-10-01"]);
  });

  it("«Cómo se compró»: la fecha de la compra de las 22:30 del 30/9 dice 2026-09-30", () => {
    const resumen: ResumenCompras = {
      filas: [{ fecha: NOCHE_DEL_30, proveedor: null, nroFactura: null, cantidad: 1, precioPorUnidadStock: null, variacionPct: null, idOperacion: undefined }],
      cantidadCompras: 1,
      medianaCantidad: 1,
      comprasPorSemana: null,
      precioMin: null,
      precioMax: null,
      proveedores: [],
    };
    expect(diasDeLaTabla(ComoSeCompro({ resumen, unidad: "kg", mostrarDinero: false }))).toEqual({ render: ["2026-09-30"], valor: ["2026-09-30"] });
    expect(diasDeLaTabla(ComoSeCompro({ resumen, unidad: "kg", mostrarDinero: false, zona: ZONA_UTC }))).toEqual({ render: ["2026-10-01"], valor: ["2026-10-01"] });
  });
});
