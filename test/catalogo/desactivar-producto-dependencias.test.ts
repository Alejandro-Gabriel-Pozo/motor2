import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarSeccion, prisma } from "../setup/test-db";
import { dependenciasParaDesactivar } from "../../src/core/catalogo/desactivar-producto";

/**
 * Qué depende de un producto antes de darlo de baja: las recetas VIGENTES de platos activos que lo usan (las versiones viejas y los platos inactivos no
 * cuentan, no se pueden vender) y las secciones, de CUALQUIER sucursal (el producto es global), donde tiene saldo distinto de cero.
 */
describe("dependenciasParaDesactivar", () => {
  let kgId: string;
  let sucursalId: string;
  let usuarioId: string;
  let harinaId: string;

  async function plato(nombre: string, activo: boolean, versiones: Array<string[]>) {
    const p = await prisma.producto.create({ data: { codigo: `PV_${nombre}`, nombre, tipo: "PV", unidadStockId: kgId, precioVenta: 100, activo } });
    for (const [i, ingredientes] of versiones.entries()) {
      await prisma.recetaVersion.create({
        data: { productoId: p.id, version: i + 1, ingredientes: { create: ingredientes.map((insumoProductoId) => ({ insumoProductoId, cantidad: 1, unidadId: kgId })) } },
      });
    }
    return p;
  }

  async function mover(seccionId: string, cantidad: number, proceso: "COMPRA" | "VENTA" = "COMPRA") {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(), usuarioId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId, proceso, cantidad, detalle: "test" } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    sucursalId = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "u@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId: catalogo.insumo.id } })).id;
  });

  it("un producto que nadie usa y sin movimientos no depende de nada", async () => {
    expect(await dependenciasParaDesactivar(harinaId)).toEqual({ recetasVigentes: [], saldos: [] });
  });

  it("lista los platos ACTIVOS cuya receta VIGENTE lo usa, por nombre; ignora versiones viejas y platos inactivos", async () => {
    await plato("Pizza", true, [[harinaId]]); // vigente v1 lo usa → cuenta
    await plato("Fainá", true, [[], [harinaId]]); // v1 no, v2 (la vigente) sí → cuenta
    await plato("Calzone", true, [[harinaId], []]); // v1 sí, pero la vigente es v2 y no lo usa → NO cuenta
    await plato("Empanada", false, [[harinaId]]); // lo usa pero está inactivo → NO cuenta

    const { recetasVigentes } = await dependenciasParaDesactivar(harinaId);
    expect(recetasVigentes.map((r) => r.nombre)).toEqual(["Fainá", "Pizza"]);
  });

  it("lista las secciones con saldo distinto de cero, de cualquier sucursal, y omite las que quedan en cero", async () => {
    const deposito = await sembrarSeccion(sucursalId, "Depósito");
    const cocina = await sembrarSeccion(sucursalId, "Cocina");
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const barra = await sembrarSeccion(otraSucursal.id, "Barra");

    await mover(deposito.id, 10);
    await mover(deposito.id, -4, "VENTA"); // Depósito: 6
    await mover(cocina.id, 5);
    await mover(cocina.id, -5, "VENTA"); // Cocina: 0 → no se lista
    await mover(barra.id, 2.5); // otra sucursal: cuenta igual

    const { saldos } = await dependenciasParaDesactivar(harinaId);
    expect(saldos).toEqual([
      { sucursalNombre: "Central", seccionNombre: "Depósito", saldo: 6 },
      { sucursalNombre: "Norte", seccionNombre: "Barra", saldo: 2.5 },
    ]);
  });
});
