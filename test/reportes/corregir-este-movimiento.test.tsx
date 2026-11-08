import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { detalleDeCorreccionDeMovimiento, enlaceParaCorregirMovimiento, type ItemOperacion } from "../../src/core/reportes/public";
import { TablaItemsOperacion } from "../../src/app/(app)/reportes/trazabilidad/tabla-trazabilidad";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { obtenerMovimientoACorregir } from "../../src/server/consultas/movimientos/movimiento-a-corregir";

/** «Corregir este movimiento» (E0 de la corrección por ajuste, g): el enlace, el detalle de referencia, quién lo ve y qué lee el servidor para prellenar el Ajuste. */
describe("detalle y enlace de «Corregir este movimiento»", () => {
  it("el detalle referencia el movimiento original (proceso, día y operación) y siempre cabe en 200 caracteres", () => {
    expect(detalleDeCorreccionDeMovimiento({ proceso: "COMPRA", dia: "2026-11-03", idOperacion: "op1" })).toBe("Corrección del movimiento de COMPRA del 2026-11-03 · operación op1");
    const largo = detalleDeCorreccionDeMovimiento({ proceso: "COMPRA", dia: "2026-11-03", idOperacion: "x".repeat(500) });
    expect(largo).toHaveLength(200);
    expect(largo.startsWith("Corrección del movimiento de COMPRA del 2026-11-03")).toBe(true);
  });

  it("el enlace lleva solo el id del movimiento, escapado, al Ajuste", () => {
    expect(enlaceParaCorregirMovimiento("abc123")).toBe("/movimientos/ajuste?corrige=abc123");
    expect(enlaceParaCorregirMovimiento("a&b=c")).toBe("/movimientos/ajuste?corrige=a%26b%3Dc");
  });
});

describe("TablaItemsOperacion: «Corregir este movimiento»", () => {
  const fila: ItemOperacion = { productoNombre: "Harina", productoCodigo: "MP_1", detalle: "Compra", cantidad: 5, loteVencimiento: null, proceso: "COMPRA", seccionNombre: "Depósito", idMovimiento: "mov-1", sustituyeANombre: null };

  it("solo quien puede cargar un Ajuste ve el enlace; sin permiso la columna no existe", () => {
    const con = renderToStaticMarkup(<TablaItemsOperacion filas={[fila]} nombreExport="x" puedeCorregir />);
    expect(con).toContain("Corregir este movimiento");
    expect(con).toContain('href="/movimientos/ajuste?corrige=mov-1"');
    const sin = renderToStaticMarkup(<TablaItemsOperacion filas={[fila]} nombreExport="x" />);
    expect(sin).not.toContain("Corregir este movimiento");
  });
});

describe("obtenerMovimientoACorregir", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadId: string;
  let insumoId: string;
  let usuarioId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  });

  async function movimiento() {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadId, insumoId }, sucursalId);
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "MERMA", fecha: new Date("2026-11-03T15:00:00Z"), usuarioId } });
    const mov = await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: mp.id, seccionId, proceso: "MERMA", cantidad: -5, detalle: "Mal cargada", precioTotal: 0, precioPorUnidadStock: 0 } });
    return { op, mov, mp };
  }

  it("devuelve el producto, la sección y la operación del original, solo de esta sucursal", async () => {
    const { op, mov, mp } = await movimiento();
    expect(await obtenerMovimientoACorregir(sucursalId, mov.id, prisma)).toEqual({ idMovimiento: mov.id, idOperacion: op.id, procesoDelMovimiento: "MERMA", fechaDeLaOperacion: op.fecha, productoId: mp.id, seccionId });
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    expect(await obtenerMovimientoACorregir(otra.id, mov.id, prisma)).toBeNull();
    expect(await obtenerMovimientoACorregir(sucursalId, "no-existe", prisma)).toBeNull();
  });
});
