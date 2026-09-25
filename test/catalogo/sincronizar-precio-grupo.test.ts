import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, sincronizarPrecioGrupoCarta, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../src/server/actions/movimientos/precio-local";
import { resolverMenuCartaConDiagnostico } from "../../src/core/carta/menu-consulta";

/**
 * Sincronizar el precio de un producto agrupado (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): al cambiar el precio en
 * Catálogo (`actualizarProducto`) o en Precio Local (`setPrecioLocalProducto`) de un producto que está en un ítem agrupado de la
 * carta, la acción OFRECE (campo aditivo `sincronizable`) aplicar el mismo precio a los hermanos que quedaron a otro precio. La
 * sincronización es una acción aparte, con el mismo permiso y la misma auditoría; nunca es automática. Un producto no agrupado no
 * cambia en nada.
 */
describe("sincronizar el precio de un grupo de la carta", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let adminRolId: string;
  let operadorRolId: string;
  let unidadId: string;
  let ids: Record<string, string>;
  let agId: string;
  let otroAgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const cat = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol" } });
    const pv = async (codigo: string, nombre: string, precioVenta: number) =>
      (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", categoriaId: cat, precioVenta, unidadStockId: unidadId }, sucursalId)).id;
    ids = {
      coca: await pv("SPG_COCA", "Coca-Cola 500cc", 5000),
      sprite: await pv("SPG_SPRITE", "Sprite 500cc", 5000),
      fanta: await pv("SPG_FANTA", "Fanta 500cc", 5000),
      coca15: await pv("SPG_COCA15", "Coca-Cola 1,5L", 9000),
      suelto: await pv("SPG_SUELTO", "Tónica 500cc", 5000),
    };
    agId = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 500 CC", seccionCartaId: seccion.id } })).id;
    otroAgId = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 1,5L", seccionCartaId: seccion.id } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [
        ...[ids.coca, ids.sprite, ids.fanta].map((productoId, orden) => ({ itemAgrupadoCartaId: agId, productoId, orden })),
        { itemAgrupadoCartaId: otroAgId, productoId: ids.coca15, orden: 0 },
      ],
    });
  });

  const datosPV = (nombre: string, precioVenta: number): DatosProducto => ({ nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta });
  const precioVenta = async (id: string) => Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta);
  const auditoriasDePrecio = (entidadId: string) => prisma.registroAuditoria.findMany({ where: { entidadId, campo: "precioVenta" }, select: { valorAnterior: true, valorNuevo: true } });

  describe("Catálogo (precio de venta global)", () => {
    it("hermanos IGUALES al nuevo precio → no ofrece sincronizar (sin `sincronizable`)", async () => {
      // Coca y Sprite ya estaban a $5500: subir Fanta a $5500 no deja a nadie distinto.
      await prisma.producto.updateMany({ where: { id: { in: [ids.coca, ids.sprite] } }, data: { precioVenta: 5500 } });
      const r = await actualizarProducto(ids.fanta, datosPV("Fanta 500cc", 5500));
      expect(r).toEqual({ ok: true, mensaje: 'Producto "Fanta 500cc" actualizado.' });
      expect(r).not.toHaveProperty("sincronizable");
    });

    it("hermanos DISTINTOS → `sincronizable` trae el grupo, el precio nuevo y los hermanos con su precio; no sincroniza solo", async () => {
      const r = await actualizarProducto(ids.fanta, datosPV("Fanta 500cc", 5500));
      expect(r).toEqual({
        ok: true,
        mensaje: 'Producto "Fanta 500cc" actualizado.',
        sincronizable: {
          itemAgrupadoCartaId: agId,
          nombreItem: "Gaseosa 500 CC",
          precioNuevo: 5500,
          hermanos: [
            { productoId: ids.coca, nombre: "Coca-Cola 500cc", precioActual: 5000 },
            { productoId: ids.sprite, nombre: "Sprite 500cc", precioActual: 5000 },
          ],
        },
      });
      expect(await precioVenta(ids.coca)).toBe(5000);
      expect(await precioVenta(ids.sprite)).toBe(5000);
      // Sin confirmar: la red de seguridad de D5 (la carta muestra el mayor, con diagnóstico).
      const armado = await resolverMenuCartaConDiagnostico(sucursalId);
      expect(armado!.carta.secciones[0].items.find((i) => i.productoId === agId)!.precio).toBe(5500);
      expect(armado!.diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: agId, nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 5500 }]);
    });

    it("sin cambio de precio (se editó otra cosa) → no ofrece nada", async () => {
      await prisma.producto.update({ where: { id: ids.coca }, data: { precioVenta: 4000 } });
      const r = await actualizarProducto(ids.fanta, datosPV("Fanta 500 cc", 5000));
      expect(r).toEqual({ ok: true, mensaje: 'Producto "Fanta 500 cc" actualizado.' });
    });

    it("sincronizarPrecioGrupoCarta aplica el precio SOLO a los productoIds pasados, con su auditoría; la carta ya no avisa", async () => {
      await actualizarProducto(ids.fanta, datosPV("Fanta 500cc", 5500));
      const r = await sincronizarPrecioGrupoCarta([ids.coca, ids.sprite], 5500);
      expect(r).toEqual({ ok: true, mensaje: 'Precio de venta de "Coca-Cola 500cc", "Sprite 500cc" actualizado a $5.500 («Gaseosa 500 CC»).' });
      expect(await precioVenta(ids.coca)).toBe(5500);
      expect(await precioVenta(ids.sprite)).toBe(5500);
      // Nada fuera de la lista: otro grupo y un suelto quedan igual.
      expect(await precioVenta(ids.coca15)).toBe(9000);
      expect(await precioVenta(ids.suelto)).toBe(5000);
      expect(await auditoriasDePrecio(ids.coca)).toEqual([{ valorAnterior: "5000", valorNuevo: "5500" }]);
      expect(await auditoriasDePrecio(ids.sprite)).toEqual([{ valorAnterior: "5000", valorNuevo: "5500" }]);
      expect(await auditoriasDePrecio(ids.coca15)).toEqual([]);

      const armado = await resolverMenuCartaConDiagnostico(sucursalId);
      expect(armado!.carta.secciones[0].items.find((i) => i.productoId === agId)!.precio).toBe(5500);
      expect(armado!.diagnostico.agrupadosConPreciosDistintos).toEqual([]);
    });

    it("sincronizarPrecioGrupoCarta rechaza productos de otro grupo, sueltos, lista vacía o precio inválido, sin escribir", async () => {
      expect(await sincronizarPrecioGrupoCarta([ids.coca, ids.coca15], 5500)).toEqual({ ok: false, mensaje: "Esos productos no están todos en el mismo ítem agrupado de la carta." });
      expect(await sincronizarPrecioGrupoCarta([ids.suelto], 5500)).toEqual({ ok: false, mensaje: "Esos productos no están todos en el mismo ítem agrupado de la carta." });
      expect((await sincronizarPrecioGrupoCarta([], 5500)).ok).toBe(false);
      expect((await sincronizarPrecioGrupoCarta([ids.coca], -1)).ok).toBe(false);
      expect((await sincronizarPrecioGrupoCarta([ids.coca], Number.NaN)).ok).toBe(false);
      for (const id of [ids.coca, ids.coca15, ids.suelto]) expect(await auditoriasDePrecio(id)).toEqual([]);
      expect(await precioVenta(ids.coca)).toBe(5000);
    });

    it("regresión: un producto NO agrupado nunca ofrece sincronizar", async () => {
      const r = await actualizarProducto(ids.suelto, datosPV("Tónica 500cc", 7000));
      expect(r).toEqual({ ok: true, mensaje: 'Producto "Tónica 500cc" actualizado.' });
    });

    it("permiso: sin `editar_producto` no sincroniza nada", async () => {
      await prisma.permisoRol.updateMany({ where: { rolId: operadorRolId, accionClave: "editar_producto" }, data: { puedeEditar: false, puedeVer: false } });
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await sincronizarPrecioGrupoCarta([ids.coca, ids.sprite], 5500);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await precioVenta(ids.coca)).toBe(5000);
    });
  });

  describe("Precio Local (en la sucursal activa)", () => {
    const local = (productoId: string, sucursal = sucursalId) => prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: sucursal, productoId } } });

    it("hermanos IGUALES en esta sucursal → no ofrece sincronizar", async () => {
      await prisma.precioLocalProducto.createMany({
        data: [ids.coca, ids.sprite].map((productoId) => ({ sucursalId, productoId, precio: 5500, habilitado: true })),
      });
      const r = await setPrecioLocalProducto(ids.fanta, 5500, true);
      expect(r).toEqual({ ok: true, mensaje: 'Precio local de "Fanta 500cc" fijado en 5500.' });
    });

    it("hermanos DISTINTOS → `sincronizable` con su precio EN ESTA SUCURSAL (el local de otra sucursal no cuenta)", async () => {
      await prisma.precioLocalProducto.create({ data: { sucursalId: otraSucursalId, productoId: ids.coca, precio: 5500, habilitado: true } });
      const r = await setPrecioLocalProducto(ids.fanta, 5500, true);
      expect(r).toMatchObject({
        ok: true,
        sincronizable: {
          itemAgrupadoCartaId: agId,
          precioNuevo: 5500,
          hermanos: [
            { productoId: ids.coca, nombre: "Coca-Cola 500cc", precioActual: 5000 },
            { productoId: ids.sprite, nombre: "Sprite 500cc", precioActual: 5000 },
          ],
        },
      });
      expect(await local(ids.coca)).toBeNull();
    });

    it("un precio local DESHABILITADO no ofrece sincronizar (la carta sigue con el global)", async () => {
      const r = await setPrecioLocalProducto(ids.fanta, 5500, false);
      expect(r).toEqual({ ok: true, mensaje: 'Precio local de "Fanta 500cc" cargado (deshabilitado, se usa el precio global).' });
    });

    it("sincronizarPrecioLocalGrupoCarta: upsert solo de los productoIds pasados y solo en la sucursal activa, con su auditoría", async () => {
      await setPrecioLocalProducto(ids.fanta, 5500, true);
      const r = await sincronizarPrecioLocalGrupoCarta(sucursalId, [ids.coca, ids.sprite], 5500, true);
      expect(r).toEqual({ ok: true, mensaje: 'Precio local de "Coca-Cola 500cc", "Sprite 500cc" fijado en 5500 en "Central" («Gaseosa 500 CC»).' });
      for (const id of [ids.coca, ids.sprite]) expect(await local(id)).toMatchObject({ habilitado: true });
      expect(Number((await local(ids.coca))!.precio)).toBe(5500);
      expect(await local(ids.coca, otraSucursalId)).toBeNull();
      expect(await local(ids.coca15)).toBeNull();
      const filaCoca = (await local(ids.coca))!;
      expect(await prisma.registroAuditoria.findMany({ where: { entidadId: filaCoca.id }, select: { campo: true, valorAnterior: true, valorNuevo: true, sucursalId: true }, orderBy: { campo: "asc" } })).toEqual([
        { campo: "habilitado", valorAnterior: null, valorNuevo: "true", sucursalId },
        { campo: "precio", valorAnterior: null, valorNuevo: "5500", sucursalId },
      ]);
      const armado = await resolverMenuCartaConDiagnostico(sucursalId);
      expect(armado!.diagnostico.agrupadosConPreciosDistintos).toEqual([]);
      expect(armado!.carta.secciones[0].items.find((i) => i.productoId === agId)!.precio).toBe(5500);
    });

    it("sincronizarPrecioLocalGrupoCarta rechaza otra sucursal que la activa y productos de otro grupo, sin escribir", async () => {
      expect(await sincronizarPrecioLocalGrupoCarta(otraSucursalId, [ids.coca], 5500, true)).toEqual({
        ok: false,
        mensaje: "La sucursal activa cambió desde que se cargó la pantalla: recargala y volvé a intentar.",
      });
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [ids.coca, ids.coca15], 5500, true)).toEqual({
        ok: false,
        mensaje: "Esos productos no están todos en el mismo ítem agrupado de la carta.",
      });
      expect(await prisma.precioLocalProducto.count()).toBe(0);
    });

    it("regresión: un producto NO agrupado nunca ofrece sincronizar", async () => {
      expect(await setPrecioLocalProducto(ids.suelto, 7000, true)).toEqual({ ok: true, mensaje: 'Precio local de "Tónica 500cc" fijado en 7000.' });
    });

    it("permiso: sin `precio_local` (el operador arranca sin él) no sincroniza nada", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await sincronizarPrecioLocalGrupoCarta(sucursalId, [ids.coca, ids.sprite], 5500, true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await prisma.precioLocalProducto.count()).toBe(0);
    });
  });
});
