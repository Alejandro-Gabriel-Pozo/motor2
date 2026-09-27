import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import type { DatosVentaInput } from "../../src/core/features/ventas/venta.schema";

/**
 * Caso de uso `registrarVentaCasoDeUso` (src/server/actions/movimientos/casos-de-uso/registrar-venta.ts; Task #41, Fase M): la parte
 * transaccional de `registrarVenta` (I3 + `registrarVentaEnTx`), movida tal cual cuando `venta.ts` entró en `ACCIONES_CON_CASO_DE_USO`.
 * Postgres real, sin mocks. Las validaciones de entrada y el permiso siguen en la Server Action (test/movimientos/venta.test.ts, sin tocar).
 * Un caso por cada código de resultado, más el hash I3.
 */
describe("registrarVentaCasoDeUso", () => {
  let sucursalId: string;
  let sucursalNombre: string;
  let seccionId: string;
  let adminId: string;
  let gaseosaId: string;

  const actor = () => ({ usuarioId: adminId, sucursalId, sucursalNombre });
  const datos = (extra: Partial<DatosVentaInput> = {}): DatosVentaInput => ({
    fecha: new Date("2026-08-06T12:00:00Z"),
    seccionId,
    nroFactura: "F-1",
    ventas: [{ productoId: gaseosaId, cantidadVendida: 1 }],
    ...extra,
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalNombre = base.sucursal.nombre;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    gaseosaId = (await sembrarProductoDisponible({ codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: kg.id, precioVenta: 500 }, sucursalId)).id;
  });

  it("éxito: datos con las Operaciones VENTA creadas, el mismo mensaje que el núcleo", async () => {
    const r = await registrarVentaCasoDeUso(actor(), datos());

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA", sucursalId } });
    expect(r.datos).toEqual({ operacionIds: ventas.map((v) => v.id), repetida: false });
    expect(ventas[0].claveIdempotencia).toBeNull();
  });

  it("con clave: el hash I3 es el MISMO que calculaba la Server Action (tag VENTA, payload = datos sin la clave), y un reenvío devuelve el mensaje ORIGINAL", async () => {
    const clave = randomUUID();
    const primera = await registrarVentaCasoDeUso(actor(), datos({ claveIdempotencia: clave }));
    expect(primera.ok).toBe(true);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { claveIdempotencia: clave } });
    expect(venta.payloadHash).toBe(calcularPayloadHash("VENTA", sucursalId, { ...datos(), claveIdempotencia: undefined }));
    expect(venta.resultadoMensaje).toBe(primera.mensaje);

    const reenvio = await registrarVentaCasoDeUso(actor(), datos({ claveIdempotencia: clave }));

    expect(reenvio).toEqual({ ok: true, mensaje: primera.mensaje, datos: { operacionIds: null, repetida: true } });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
  });

  it("CONFLICTO_IDEMPOTENCIA: la misma clave con otro payload", async () => {
    const clave = randomUUID();
    expect((await registrarVentaCasoDeUso(actor(), datos({ claveIdempotencia: clave }))).ok).toBe(true);

    const r = await registrarVentaCasoDeUso(actor(), datos({ claveIdempotencia: clave, nroFactura: "F-2" }));

    expect(r).toEqual({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
  });

  it("VENTA_RECHAZADA: el núcleo rechaza (producto inexistente) con su propio mensaje, sin escribir nada", async () => {
    const r = await registrarVentaCasoDeUso(actor(), datos({ ventas: [{ productoId: "no-existe", cantidadVendida: 1 }] }));

    expect(r).toEqual({ ok: false, codigo: "VENTA_RECHAZADA", mensaje: "El producto no existe." });
    expect(await prisma.operacion.count()).toBe(0);
  });
});
