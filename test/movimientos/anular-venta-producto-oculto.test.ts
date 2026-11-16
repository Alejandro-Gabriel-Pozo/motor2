import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { anularVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-venta";
import { registrarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico";
import { ocultarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/ocultar-producto";
import { MENSAJE_PRODUCTO_OCULTO } from "../../src/core/catalogo/public";

/**
 * «Ocultar» como Pedernal, etapa (c2): ANULAR una venta DEVUELVE existencia, y un producto oculto no recibe existencia (docs/diseno-ocultar-como-pedernal-2026-11-15.md, O-5, R-8, R-9; el hueco de `anularVentaEnTx`).
 * Se rechaza TODA la anulación («Este producto está oculto.») solo si algún producto devuelto está oculto en la sucursal y quedaría con saldo POR ENCIMA DE CERO en su sección (el mecanismo de Pedernal: una venta que
 * dejó el saldo negativo se puede anular hasta cero); primero se vuelve a mostrar. Un producto solo DESACTIVADO se sigue pudiendo anular (O-11). Contra Postgres real con la RLS real.
 */
describe("anularVentaCasoDeUso con un producto oculto", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ahora: AHORA_DE_LA_CORRIDA, ...baseDe(sucursalId) });
  const saldo = async () => Number((await prisma.movimientoStock.aggregate({ where: { productoId: harinaId, seccionId }, _sum: { cantidad: true } }))._sum.cantidad ?? 0);
  const ocultar = () => prismaAdmin.ocultamientoProducto.create({ data: { id: randomUUID(), productoId: harinaId, sucursalId, oculto: true, actualizadoPorId: adminId, actualizadoEn: AHORA_DE_LA_CORRIDA } });
  const reversiones = () => prisma.operacion.count({ where: { revierteAOperacionId: { not: null } } });
  const auditorias = () => prisma.registroAuditoria.count({ where: { entidad: "Operacion" } });

  async function operacion(proceso: "COMPRA" | "VENTA", cantidad: number) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date("2026-08-06T12:00:00Z"), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId, proceso, cantidad, detalle: `${proceso} de Harina`, precioTotal: Math.abs(cantidad) * 100, precioPorUnidadStock: 100 } });
    return op;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: harinaId, disponible: true } });
  });

  it("vendió todo el stock, se ocultó (saldo 0) y quiere anular: se rechaza con el texto aprobado y NO se escribe nada; al volver a mostrar, pasa", async () => {
    await operacion("COMPRA", 2);
    const venta = await operacion("VENTA", -2);
    await ocultar();
    expect(await saldo()).toBe(0);
    const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id, motivo: "Error de carga" });
    expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_OCULTO", mensaje: MENSAJE_PRODUCTO_OCULTO });
    expect(await saldo(), "el stock no cambió").toBe(0);
    expect(await reversiones()).toBe(0);
    expect(await auditorias()).toBe(0);
    await prismaAdmin.ocultamientoProducto.updateMany({ where: { productoId: harinaId }, data: { oculto: false } });
    expect(await anularVentaCasoDeUso(actor(), { operacionId: venta.id, motivo: "Error de carga" })).toMatchObject({ ok: true });
    expect(await saldo()).toBe(2);
  });

  it("una venta que dejó el saldo NEGATIVO se puede anular mientras no pase de cero (oculto con saldo −5, devuelve 2: queda en −3)", async () => {
    await operacion("COMPRA", 3);
    await operacion("VENTA", -3);
    await ocultar();
    const venta = await operacion("VENTA", -2);
    await operacion("VENTA", -3);
    expect(await saldo()).toBe(-5);
    expect(await anularVentaCasoDeUso(actor(), { operacionId: venta.id, motivo: "Error de carga" })).toMatchObject({ ok: true });
    expect(await saldo()).toBe(-3);
  });

  it("lo que solo está DESACTIVADO (no oculto) se sigue pudiendo anular (O-11); oculto en OTRO local no afecta", async () => {
    await operacion("COMPRA", 2);
    const venta = await operacion("VENTA", -2);
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: harinaId }, data: { disponible: false } });
    const otro = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    await prismaAdmin.ocultamientoProducto.create({ data: { id: randomUUID(), productoId: harinaId, sucursalId: otro, oculto: true, actualizadoPorId: adminId, actualizadoEn: AHORA_DE_LA_CORRIDA } });
    expect(await anularVentaCasoDeUso(actor(), { operacionId: venta.id, motivo: "Error de carga" })).toMatchObject({ ok: true });
  });

  it("CONCURRENCIA: anular y ocultar a la vez NUNCA dejan «oculto y con existencia»: una de las dos pierde (varias rondas)", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      await limpiarBaseDeTest();
      const base = await sembrarBase();
      sucursalId = base.sucursal.id;
      const catalogo = await sembrarCatalogoBase();
      seccionId = (await sembrarSeccion(sucursalId)).id;
      adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
      harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: harinaId, disponible: true } });
      await operacion("COMPRA", 2);
      const venta = await operacion("VENTA", -2); // saldo 0: se puede ocultar, y anular devuelve 2
      const [anulada, ocultada] = await Promise.all([
        anularVentaCasoDeUso(actor(), { operacionId: venta.id, motivo: "Error de carga" }),
        ocultarProductoCasoDeUso(actor(), { productoId: harinaId, alcance: "LOCAL", oculto: true, marcaId: randomUUID(), puedeEnLaEmpresa: false }),
      ]);
      const oculto = (await prismaAdmin.ocultamientoProducto.count({ where: { productoId: harinaId, oculto: true } })) > 0;
      expect(!(oculto && (await saldo()) > 0), `ronda ${ronda}: anulada=${JSON.stringify(anulada)} ocultada=${JSON.stringify(ocultada)} saldo=${await saldo()} oculto=${oculto}`).toBe(true);
    }
  });
});

describe("registrarConteoFisicoCasoDeUso con un producto oculto (R-10)", () => {
  it("un producto oculto no se cuenta (texto aprobado, sin escribir nada); desactivado gana sobre oculto; al volver a mostrar se puede contar", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId)).id;
    const usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: harinaId, disponible: true } });
    await prismaAdmin.ocultamientoProducto.create({ data: { id: randomUUID(), productoId: harinaId, sucursalId, oculto: true, actualizadoPorId: usuarioId, actualizadoEn: AHORA_DE_LA_CORRIDA } });
    const actor = { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", email: "admin@test.com", ahora: AHORA_DE_LA_CORRIDA, ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) };
    const contar = () => registrarConteoFisicoCasoDeUso(actor, { productoId: harinaId, seccionId, conteoReal: 0, fechaConteo: AHORA_DE_LA_CORRIDA, accion: "AJUSTAR" });
    expect(await contar()).toMatchObject({ ok: false, codigo: "PRODUCTO_OCULTO", mensaje: MENSAJE_PRODUCTO_OCULTO });
    expect(await prisma.conteoFisico.count()).toBe(0);
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: harinaId }, data: { disponible: false } });
    expect(await contar()).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_DISPONIBLE" });
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: harinaId }, data: { disponible: true } });
    await prismaAdmin.ocultamientoProducto.updateMany({ where: { productoId: harinaId }, data: { oculto: false } });
    expect((await contar()).ok).toBe(true);
  });
});
