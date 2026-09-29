import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarSeccion, prisma } from "../setup/test-db";
import { dependenciasParaDesactivar } from "../../src/core/catalogo/desactivar-producto";

/**
 * Qué depende de un producto antes de darlo de baja EN UNA SUCURSAL (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.2):
 * las recetas VIGENTES de platos DISPONIBLES EN ESA SUCURSAL que lo usan (las versiones viejas y los platos no disponibles ahí
 * no cuentan, no se pueden vender ahí) y las secciones, DE ESA SUCURSAL ÚNICAMENTE, donde tiene saldo distinto de cero — saldo
 * en otra sucursal no bloquea acá.
 */
describe("dependenciasParaDesactivar", () => {
  let kgId: string;
  let sucursalId: string;
  let usuarioId: string;
  let harinaId: string;

  /** `disponibleAca`: si tiene una fila DisponibilidadProducto con disponible:true en `sucursalId`. Sin fila = no disponible. */
  async function plato(nombre: string, disponibleAca: boolean, versiones: Array<string[]>) {
    const p = await prisma.producto.create({ data: { codigo: `PV_${nombre}`, nombre, tipo: "PV", unidadStockId: kgId, precioVenta: 100 } });
    if (disponibleAca) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
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
    expect(await dependenciasParaDesactivar(harinaId, sucursalId, prisma)).toEqual({ recetasVigentes: [], saldos: [] });
  });

  it("lista los platos DISPONIBLES ACÁ cuya receta VIGENTE lo usa, por nombre; ignora versiones viejas y platos no disponibles acá", async () => {
    await plato("Pizza", true, [[harinaId]]); // vigente v1 lo usa → cuenta
    await plato("Fainá", true, [[], [harinaId]]); // v1 no, v2 (la vigente) sí → cuenta
    await plato("Calzone", true, [[harinaId], []]); // v1 sí, pero la vigente es v2 y no lo usa → NO cuenta
    await plato("Empanada", false, [[harinaId]]); // lo usa pero NO está disponible acá → NO cuenta

    const { recetasVigentes } = await dependenciasParaDesactivar(harinaId, sucursalId, prisma);
    expect(recetasVigentes.map((r) => r.nombre)).toEqual(["Fainá", "Pizza"]);
  });

  it("un plato disponible SOLO en otra sucursal no bloquea desactivar la MP acá", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const plato2 = await prisma.producto.create({ data: { codigo: "PV_SOLO_NORTE", nombre: "Solo en Norte", tipo: "PV", unidadStockId: kgId, precioVenta: 100 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursal.id, productoId: plato2.id, disponible: true } });
    await prisma.recetaVersion.create({ data: { productoId: plato2.id, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 1, unidadId: kgId }] } } });

    const { recetasVigentes } = await dependenciasParaDesactivar(harinaId, sucursalId, prisma);
    expect(recetasVigentes).toEqual([]);
  });

  it("lista las secciones DE ESTA SUCURSAL con saldo distinto de cero, y omite las que quedan en cero", async () => {
    const deposito = await sembrarSeccion(sucursalId, "Depósito");
    const cocina = await sembrarSeccion(sucursalId, "Cocina");

    await mover(deposito.id, 10);
    await mover(deposito.id, -4, "VENTA"); // Depósito: 6
    await mover(cocina.id, 5);
    await mover(cocina.id, -5, "VENTA"); // Cocina: 0 → no se lista

    const { saldos } = await dependenciasParaDesactivar(harinaId, sucursalId, prisma);
    expect(saldos).toEqual([{ sucursalNombre: "Central", seccionNombre: "Depósito", saldo: 6 }]);
  });

  it("saldo en OTRA sucursal NO bloquea desactivar acá — ni aparece en la lista", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const barra = await sembrarSeccion(otraSucursal.id, "Barra");
    const op = await prisma.operacion.create({ data: { sucursalId: otraSucursal.id, proceso: "COMPRA", fecha: new Date(), usuarioId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId: barra.id, proceso: "COMPRA", cantidad: 2.5, detalle: "test" } });

    const { saldos } = await dependenciasParaDesactivar(harinaId, sucursalId, prisma);
    expect(saldos).toEqual([]);
  });
});
