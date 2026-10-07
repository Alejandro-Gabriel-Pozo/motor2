import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico";
import { cancelarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico";
import { resolverConteoPendienteCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente";

/**
 * La hora entra por `actor.ahora`, no por el reloj, también al cancelar y al resolver un conteo físico (Pureza 1.2; auditoría de la Fase 1: faltaban 10 de los 13 tests con hora fija).
 * El caso de uso se llama con la hora tres días atrás y se lee la fecha de la Operación de CONTROL que escribe.
 */
describe("conteo físico: la fecha de la operación de control es la hora de entrada", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let productoId: string;

  const actor = (ahora = new Date()) => ({ usuarioId: adminId, sucursalId, sucursalNombre: "Central", ahora, ...baseDeTest });
  const fijaHaceTresDias = () => new Date(Date.now() - 3 * 24 * 3_600_000);
  const controles = () => prisma.operacion.findMany({ where: { proceso: "CONTROL" }, orderBy: { creadoEn: "asc" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    productoId = (await prisma.producto.create({ data: { codigo: "MP_HF", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId, disponible: true } });
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 } });
  });

  it("cancelar un conteo resuelto: la reversión del Kardex lleva la hora de entrada", async () => {
    const reg = await registrarConteoFisicoCasoDeUso(actor(), { productoId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
    expect(reg.ok, reg.ok ? "" : reg.mensaje).toBe(true);
    const conteo = await prisma.conteoFisico.findFirstOrThrow();
    const fija = fijaHaceTresDias();

    const r = await cancelarConteoFisicoCasoDeUso(actor(fija), conteo.id);

    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    const ops = await controles();
    expect(ops).toHaveLength(2); // el ajuste del conteo y su reversión
    expect(ops[1].fecha.getTime()).toBe(fija.getTime());
  });

  it("resolver un conteo pendiente ajustando: el ajuste del Kardex lleva la hora de entrada", async () => {
    const reg = await registrarConteoFisicoCasoDeUso(actor(), { productoId, seccionId, conteoReal: 6, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    expect(reg.ok, reg.ok ? "" : reg.mensaje).toBe(true);
    const conteo = await prisma.conteoFisico.findFirstOrThrow();
    expect(conteo.estado).toBe("PENDIENTE");
    const fija = fijaHaceTresDias();

    const r = await resolverConteoPendienteCasoDeUso(actor(fija), conteo.id, "ajustar");

    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    const ops = await controles();
    expect(ops).toHaveLength(1);
    expect(ops[0].fecha.getTime()).toBe(fija.getTime());
  });
});
