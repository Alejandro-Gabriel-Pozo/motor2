import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularCompra } from "../../src/server/actions/movimientos/compras";
import { obtenerPrecioLocalProducto, listarPreciosLocales } from "../../src/server/actions/movimientos/precio-local";

/**
 * Fase 0.3 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md, sección "Fase 0"): tests de
 * aislamiento ENTRE SUCURSALES, con las sucursales que YA existen hoy — el propio checklist dice que no hace falta el modelo
 * `Empresa` para probar la propiedad que después usará empresa ("usar las sucursales que ya existen"). Complementa, no
 * reemplaza, a `test/arquitectura/guardas/analizador.ts` (que analiza si CADA Server Action llama a una guarda de permiso —
 * una propiedad distinta de "¿el dato que devuelve/modifica está scoped a la sucursal correcta?", que es lo que se prueba acá).
 *
 * Los 3 casos elegidos usan funciones REALES del repo (no los nombres ilustrativos `obtenerStockActual`/`cambiarPrecio` del
 * checklist, que no existen tal cual):
 *  1. `registrarMovimiento` con una `seccionId` de OTRA sucursal — la guarda "Fase 6" (auditoría de seguridad/contratos,
 *     ya presente en varios casos de uso de Task #41: registrar-movimiento.ts, reclasificar-stock.ts) rechaza ANTES de
 *     escribir nada, sin que importe si el resto del payload es válido.
 *  2. `anularCompra` sobre una Operacion COMPRA de OTRA sucursal — `cargarCompraParaAnular` filtra por `sucursalId`: la
 *     compra ajena da "no encontrada", nunca se anula. La compra de sucursal B se siembra directo con Prisma (sin mockear
 *     sesión de un segundo actor): cambiar de usuario mockeado A MITAD de un mismo test no tiene precedente en este repo
 *     (`obtenerContextoUsuario` usa `cache()` de React, pensado para memoizar por request — sembrar por Prisma evita esa
 *     duda por completo, sin necesitar resolverla).
 *  3. `obtenerPrecioLocalProducto`/`listarPreciosLocales` de OTRA sucursal — rechazado al nivel de PERMISO
 *     (`requerirVerEnSucursal`), ni siquiera llega a leer nada: quien no tiene membresía en esa sucursal no puede ver su
 *     precio local. `setPrecioLocalProducto` (la escritura) ni siquiera se puede intentar contra otra sucursal: no acepta
 *     `sucursalId` por parámetro, siempre opera sobre `ctx.sucursalId` — aislamiento por construcción, no por chequeo.
 */
describe("aislamiento entre sucursales", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let adminRolId: string;
  let adminA: { id: string; email: string; nombre: null };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase(); // crea el rol "admin" + la sucursal "Central" (A)
    sucursalAId = base.sucursal.id;
    adminRolId = base.admin.id;
    const sucursalB = await prisma.sucursal.create({ data: { nombre: "Otra Sucursal (aislamiento)" } });
    sucursalBId = sucursalB.id;

    const usuarioA = await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: adminRolId });
    adminA = { id: usuarioA.id, email: usuarioA.email, nombre: null };
  });

  it("registrarMovimiento rechaza una seccionId de otra sucursal, sin escribir ninguna Operacion", async () => {
    await mockearUsuarioActual(adminA);
    const seccionB = await sembrarSeccion(sucursalBId, "Depósito B");
    // Producto REAL y disponible en sucursal B (no un id inexistente): si la guarda de sección se
    // rompiera, el resto del flujo tiene todo lo que necesita para completar el AJUSTE de verdad —
    // así el test detecta la ausencia de la guarda en vez de rechazar por otro motivo no relacionado
    // (confirmado mutando la guarda real: con un id inexistente, este test seguía en verde igual,
    // por "el producto no existe" — un falso positivo que no probaba lo que decía probar).
    // Disponible en la sucursal de A (no en B): si se dejara disponible solo en B, `productoDisponibleEn` lo
    // rechazaría por un motivo distinto (disponibilidad, no sección), enmascarando si la guarda de sección
    // en sí funciona o no — el único motivo de rechazo que puede quedar acá es la sección ajena.
    const catalogo = await sembrarCatalogoBase();
    const mp = await sembrarProductoDisponible({ codigo: "MP_AISLAMIENTO_SECCION", nombre: "Materia prima de aislamiento", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalAId);

    const resultado = await registrarMovimiento({
      proceso: "AJUSTE",
      fecha: new Date(),
      seccionId: seccionB.id, // ajena a A: A solo pertenece a sucursalAId
      items: [{ productoId: mp.id, cantidad: 1 }],
    });

    expect(resultado.ok).toBe(false);
    expect(await prisma.operacion.count()).toBe(0);
  });

  it("anularCompra rechaza una compra de otra sucursal, sin anularla", async () => {
    // Sembrado directo con Prisma (sin mockear un segundo actor) — ver el docstring del describe.
    const catalogo = await sembrarCatalogoBase();
    const seccionB = await sembrarSeccion(sucursalBId, "Depósito B");
    const mp = await sembrarProductoDisponible({ codigo: "MP_AISLAMIENTO", nombre: "Materia prima de aislamiento", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalBId);
    const usuarioB = await prisma.user.create({ data: { email: "admin-b@test.com" } });
    const operacion = await prisma.operacion.create({
      data: { sucursalId: sucursalBId, proceso: "COMPRA", fecha: new Date(), usuarioId: usuarioB.id },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: mp.id, seccionId: seccionB.id, proceso: "COMPRA", cantidad: 5, detalle: "Compra de aislamiento", precioTotal: 100, precioPorUnidadStock: 20 },
    });

    await mockearUsuarioActual(adminA);
    const resultado = await anularCompra(operacion.id);

    expect(resultado.ok).toBe(false);
    const releida = await prisma.operacion.findUniqueOrThrow({ where: { id: operacion.id } });
    expect(releida.anuladaEn).toBeNull();
  });

  it("obtenerPrecioLocalProducto/listarPreciosLocales de otra sucursal se rechazan al nivel de permiso, sin llegar a leer nada", async () => {
    await mockearUsuarioActual(adminA);

    await expect(obtenerPrecioLocalProducto(sucursalBId, "cualquier-producto")).rejects.toThrow();
    await expect(listarPreciosLocales(sucursalBId)).rejects.toThrow();
  });
});
