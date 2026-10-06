import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { EventoHistorialProducto, HistorialProducto } from "../../src/core/reportes/historial-producto";

// S-02: la pantalla gatea las columnas de dinero con `reporte_historial_importes`, pero los props de un componente cliente viajan
// en el payload de la respuesta. Este test mira los PROPS que la página le arma a cada componente cliente, no lo que se dibuja.

const PRECIO_TOTAL = 987654.25;
const PRECIO_UNIDAD = 4321.5;

const mocks = vi.hoisted(() => ({ ver: false, historial: null as unknown }));

vi.mock("@/core/auth/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u1", sucursalId: "s1", db: {} }) }));
vi.mock("@/server/acceso/gate", () => ({
  requierePermisoVer: async () => ({ ok: true }),
  obtenerMiNivelPermiso: async () => ({ ver: mocks.ver, editar: false }),
}));
vi.mock("@/server/actions/movimientos/secciones", () => ({ listarSeccionesActivas: async () => [] }));
vi.mock("@/core/reportes/historial-producto", () => ({
  obtenerHistorialProducto: async () => mocks.historial,
  obtenerIngredientesRecetaVigente: async () => [],
}));

import HistorialProductoPage from "../../src/app/(app)/reportes/historial/page";
import { GraficoSaldoCorriente } from "../../src/app/(app)/reportes/historial/grafico-saldo";
import { ComoSeCompro } from "../../src/app/(app)/reportes/historial/como-se-compro";
import { ComoSeVendio } from "../../src/app/(app)/reportes/historial/como-se-vendio";
import { TablaHistorialEventos } from "../../src/app/(app)/reportes/historial/tabla-historial";

function evento(extra: Partial<EventoHistorialProducto>): EventoHistorialProducto {
  return { tipo: "movimiento", fecha: new Date("2026-09-20T12:00:00Z"), detalle: "x", seccionNombre: "Cocina", proveedorNombre: "Proveedor Uno", nroFactura: "F-1", idOperacion: "op1", ...extra };
}

function historial(tipo: "MP" | "PV"): HistorialProducto {
  const proceso = tipo === "MP" ? "COMPRA" : "VENTA";
  return {
    productoId: "p1",
    codigo: "P1",
    producto: "Producto",
    tipo,
    unidadStockNombre: "kg",
    saldoActual: 10,
    totalMovimientos: 2,
    totalConteos: 0,
    tieneStockPropio: true,
    eventos: [
      evento({ proceso, cantidadConSigno: tipo === "MP" ? 5 : -5, saldoCorriente: 5, precioTotal: PRECIO_TOTAL, precioPorUnidadStock: PRECIO_UNIDAD }),
      evento({ proceso, cantidadConSigno: tipo === "MP" ? 5 : -5, saldoCorriente: 10, precioTotal: PRECIO_TOTAL, precioPorUnidadStock: PRECIO_UNIDAD, fecha: new Date("2026-09-21T12:00:00Z") }),
    ],
  };
}

function propsDe(arbol: ReactNode, tipo: unknown): Record<string, unknown>[] {
  const hallados: Record<string, unknown>[] = [];
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return;
    const el = nodo as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.type === tipo) hallados.push(el.props);
    recorrer(el.props.children);
  };
  recorrer(arbol);
  return hallados;
}

async function renderPagina(): Promise<ReactNode> {
  return HistorialProductoPage({ searchParams: Promise.resolve({ productoId: "p1" }) });
}

const COMPONENTES_CLIENTE = [GraficoSaldoCorriente, ComoSeCompro, ComoSeVendio, TablaHistorialEventos];

describe("/reportes/historial: el dinero no sale del servidor sin reporte_historial_importes", () => {
  beforeEach(() => {
    mocks.ver = false;
  });

  for (const tipo of ["MP", "PV"] as const) {
    it(`sin la clave de importes ningún prop de un componente cliente lleva dinero (${tipo})`, async () => {
      mocks.historial = historial(tipo);
      const arbol = await renderPagina();
      const propsCliente = COMPONENTES_CLIENTE.flatMap((c) => propsDe(arbol, c));
      expect(propsCliente.length).toBeGreaterThanOrEqual(3);
      const serializado = JSON.stringify(propsCliente);
      expect(serializado).not.toContain(String(PRECIO_TOTAL));
      expect(serializado).not.toContain(String(PRECIO_UNIDAD));
      expect(serializado).not.toContain("precioTotal");
      expect(serializado).not.toMatch(/"precioPorUnidadStock":(?!null)/); // en las filas de compras la clave existe pero vacía
    });
  }

  it("sin la clave de importes la prosa y la tabla de compras no tienen precios ni variación", async () => {
    mocks.historial = historial("MP");
    const [props] = propsDe(await renderPagina(), ComoSeCompro) as { resumen: { precioMin: number | null; precioMax: number | null; filas: { precioPorUnidadStock: number | null; variacionPct: number | null }[] }; mostrarDinero: boolean }[];
    expect(props!.mostrarDinero).toBe(false);
    expect(props!.resumen.precioMin).toBeNull();
    expect(props!.resumen.precioMax).toBeNull();
    expect(props!.resumen.filas.every((f) => f.precioPorUnidadStock === null && f.variacionPct === null)).toBe(true);
  });

  it("el saldo corriente y las cantidades siguen llegando: el gráfico y el Kardex funcionan sin dinero", async () => {
    mocks.historial = historial("MP");
    const arbol = await renderPagina();
    const [grafico] = propsDe(arbol, GraficoSaldoCorriente) as { eventos: EventoHistorialProducto[] }[];
    expect(grafico!.eventos.map((e) => e.saldoCorriente)).toEqual([5, 10]);
    const [tabla] = propsDe(arbol, TablaHistorialEventos) as { filas: EventoHistorialProducto[] }[];
    expect(tabla!.filas.map((e) => e.cantidadConSigno)).toEqual([5, 5]);
  });

  it("con la clave de importes el dinero sigue llegando (la pantalla del administrador no cambia)", async () => {
    mocks.ver = true;
    mocks.historial = historial("MP");
    const arbol = await renderPagina();
    const [compro] = propsDe(arbol, ComoSeCompro) as { resumen: { precioMin: number | null }; mostrarDinero: boolean }[];
    expect(compro!.mostrarDinero).toBe(true);
    expect(compro!.resumen.precioMin).toBe(PRECIO_UNIDAD);
    const [tabla] = propsDe(arbol, TablaHistorialEventos) as { filas: EventoHistorialProducto[] }[];
    expect(tabla!.filas[0]!.precioTotal).toBe(PRECIO_TOTAL);
  });
});
