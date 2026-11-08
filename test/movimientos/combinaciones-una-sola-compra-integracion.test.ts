import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { datosDeNota } from "../setup/nota-credito";
import { cargarCompraDeUnaParte } from "../setup/compra-de-prueba";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo } from "../setup/oraculo-una-sola-compra";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { corregirFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-factura-proveedor";
import { declararPagoDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/declarar-pago-de-factura-proveedor";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";
import { diaDeCalendario, mediodiaDelDia, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * Oráculo de combinaciones de «una sola compra», CONTRA LA BASE REAL (regla «Combinaciones» del dueño): arma cada combinación de `docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md` con filas verdaderas (la compra por el camino
 * real, la nota de crédito, el consumo de stock, el pago) y corre el caso de uso. Las reglas puras ya se recorren exhaustivamente en `test/core/combinaciones-una-sola-compra.test.ts`; acá se prueba que el caso de uso las aplica
 * con el dato de la base (no solo la función). Son pocas combinaciones: se recorren todas, no una muestra por pares.
 */
const DIMENSIONES = dimensionesDelOraculo();
const hoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let sucursalId: string, seccionId: string, adminId: string, harinaId: string, molinoId: string, otroId: string;
const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) }) as unknown as ContextoDeAccion;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  const catalogo = await sembrarCatalogoBase();
  seccionId = (await sembrarSeccion(sucursalId)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
  molinoId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  otroId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro SA" } })).id;
});

const anularFactura = (facturaId: string) => anularFacturaProveedorCasoDeUso(actor(), { facturaId, motivo: "Prueba", claveIdempotencia: randomUUID() });
const resultado = (r: { ok: boolean; codigo?: string }, exito: string) => (r.ok ? exito : `RECHAZA_${r.codigo}`);

async function conNotas(facturaId: string, notas: string) {
  if (notas === "SIN") return;
  const base = datosDeNota({ facturaId, proveedorId: molinoId, usuarioId: adminId });
  if (notas === "VIGENTE") await prisma.notaCreditoProveedor.create({ data: base as never });
  else await prisma.notaCreditoProveedor.create({ data: { ...base, anuladaEn: new Date(), anuladaPorId: adminId, motivoAnulacion: "Anulada en la prueba" } as never });
}

async function consumirTodo() {
  const op = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: new Date(), usuarioId: adminId } });
  await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: "CONSUMO", cantidad: -10, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 } });
}

describe("oráculo contra la base: anular la factura entera", () => {
  const tabla = tablaDelOraculo("Anular la factura entera");
  it("la tabla cubre todo el producto de A, N y S", () => {
    expect(tabla.filas.length).toBe(productoCartesiano({ A: DIMENSIONES["A"]!, N: DIMENSIONES["N"]!, S: DIMENSIONES["S"]! }).length);
  });
  for (const fila of tabla.filas) {
    it(`A=${fila["A"]} N=${fila["N"]} S=${fila["S"]} → ${fila["Resultado"]}`, async () => {
      const { facturaId } = await cargarCompraDeUnaParte(actor(), { seccionId, proveedorId: molinoId, productoId: harinaId, nroFactura: "A-0001-00000001" });
      if (fila["A"] === "SI") expect((await anularFactura(facturaId)).ok).toBe(true);
      await conNotas(facturaId, fila["N"]!);
      if (fila["S"] === "CONSUMIDO") await consumirTodo();
      const r = await anularFactura(facturaId);
      expect(resultado(r, "ANULA"), r.mensaje).toBe(fila["Resultado"]);
    });
  }
});

describe("oráculo contra la base: corregir los datos de la factura", () => {
  const tabla = tablaDelOraculo("Corregir los datos de la factura");
  it("la tabla cubre todo el producto de A, V y N", () => {
    expect(tabla.filas.length).toBe(productoCartesiano({ A: DIMENSIONES["A"]!, V: DIMENSIONES["V"]!, N: DIMENSIONES["N"]! }).length);
  });
  for (const fila of tabla.filas) {
    it(`A=${fila["A"]} V=${fila["V"]} N=${fila["N"]} → ${fila["Resultado"]}`, async () => {
      const { facturaId } = await cargarCompraDeUnaParte(actor(), { seccionId, proveedorId: molinoId, productoId: harinaId, nroFactura: "A-0001-00000001", detalleLibre: "Original" });
      if (fila["A"] === "SI") expect((await anularFactura(facturaId)).ok).toBe(true);
      await conNotas(facturaId, fila["N"]!);
      const esperado = { proveedorId: molinoId, nroFactura: "A-0001-00000001", detalleLibre: "Original" };
      const nueva = { ...esperado, ...(fila["V"] === "SI" ? { proveedorId: otroId } : { detalleLibre: "Corregido" }) };
      const r = await corregirFacturaProveedorCasoDeUso({ ...actor(), membresias: [{ sucursalId }] as never }, { facturaId, nueva, esperado });
      expect(resultado(r, "CORRIGE"), r.mensaje).toBe(fila["Resultado"]);
      // Rechazada = no escribió nada: la factura y la compra de su parte siguen como estaban.
      if (!r.ok) {
        const f = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId }, include: { partes: true } });
        expect([f.proveedorId, f.detalleLibre]).toEqual([molinoId, "Original"]);
      }
    });
  }
});

describe("oráculo contra la base: declarar el pago de la factura", () => {
  const tabla = tablaDelOraculo("Declarar el pago de la factura");
  it("la tabla cubre todo el producto de A, C y P", () => {
    expect(tabla.filas.length).toBe(productoCartesiano({ A: DIMENSIONES["A"]!, C: DIMENSIONES["C"]!, P: DIMENSIONES["P"]! }).length);
  });
  const dia = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
  const declarar = (facturaId: string) => declararPagoDeFacturaCasoDeUso(actor(), { facturaId, fechaPago: dia(), medio: "EFECTIVO", claveIdempotencia: randomUUID() });
  for (const fila of tabla.filas) {
    it(`A=${fila["A"]} C=${fila["C"]} P=${fila["P"]} → ${fila["Resultado"]}`, async () => {
      const c = await registrarFacturaProveedorCasoDeUso(actor(), {
        fecha: hoy(), proveedorId: molinoId, nroFactura: "A-0001-00000002", seccionId,
        items: [{ productoId: harinaId, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
        reparto: { modo: "PORCENTAJE", partes: [{ sucursalId, valor: 100 }] }, claveIdempotencia: randomUUID(), condicionPago: fila["C"] as "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO",
      });
      expect(c.ok, c.mensaje).toBe(true);
      const facturaId = (c.ok && c.datos.facturaId) as string;
      if (fila["P"] === "SI" && fila["C"] === "PENDIENTE_DE_PAGO") expect((await declarar(facturaId)).ok).toBe(true);
      // CONTADO_PAGADA nunca tiene pago vigente (no lo admite): la fila P=SI de contado se prueba con el pago pendiente imposible, solo el rechazo por «se cargó pagada».
      if (fila["A"] === "SI") expect((await anularFactura(facturaId)).ok).toBe(true);
      const r = await declarar(facturaId);
      expect(resultado(r, "DECLARA"), r.mensaje).toBe(fila["Resultado"]);
    });
  }
});
