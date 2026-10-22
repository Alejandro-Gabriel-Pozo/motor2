import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { setPrecioLocalProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/set-precio-local-producto";
import { sincronizarPrecioGrupoCartaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/sincronizar-precio-grupo-carta";
import { actualizarDisponibilidadProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-disponibilidad-producto";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-opcion-item-agrupado-carta";

/**
 * Fase 4 de la ola «precio y carta», C7a (ADR-035): las escrituras que tocan el precio propio de un producto RECHAZAN una base (su precio guardado no se cobra), sobre el catálogo de referencia:
 *  - el precio local del producto en la sucursal (habilitarlo): `ES_BASE_CONFIGURABLE` (lo local de una base es la grilla de sus opciones); deshabilitarlo, sí;
 *  - agregar la base a un ítem agrupado de la carta (que muestra el precio guardado de cada producto): `ES_BASE_CONFIGURABLE`;
 *  - igualar el precio de venta de un ítem agrupado (defensa: una base no puede estar en uno): `ES_BASE_CONFIGURABLE`;
 *  - poner a la venta en la sucursal: la regla D4 (un PV a $0 exige la clave fina) es solo para DIRECTO (una base en 0 se activa sin la clave); una base que no cumple el invariante (sin grupo de precio)
 *    no se activa: `BASE_INVALIDA` (apagarla, sí).
 * El ajuste masivo «Precios» de la carta está apagado (`PRECIOS_EDITABLES`) y no se tocó en esta fase.
 */
describe("C7a: las escrituras del precio propio rechazan una base", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;

  const ctx = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
  const base = (id: string) => prismaAdmin.producto.update({ where: { id }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
  });

  it("precio local: habilitarlo en una base se rechaza sin escribir; deshabilitarlo (limpiar) sí se puede; en un directo, como siempre", async () => {
    await base(cat.producto.pizzas!);
    const r = await setPrecioLocalProductoCasoDeUso(ctx(), { productoId: cat.producto.pizzas!, precio: 19000, habilitado: true, esperado: null });
    expect(r).toMatchObject({ ok: false, codigo: "ES_BASE_CONFIGURABLE" });
    expect(!r.ok && r.mensaje).toMatch(/^«Pizzas» se vende por opción: su precio en esta sucursal es el de cada opción/);
    expect(await prismaAdmin.precioLocalProducto.count()).toBe(0);
    expect(await setPrecioLocalProductoCasoDeUso(ctx(), { productoId: cat.producto.pizzas!, precio: 0, habilitado: false, esperado: null })).toMatchObject({ ok: true });
    expect(await setPrecioLocalProductoCasoDeUso(ctx(), { productoId: cat.producto.gaseosa!, precio: 4500, habilitado: true, esperado: null })).toMatchObject({ ok: true });
  });

  it("ítem agrupado de la carta: agregar una base se rechaza; igualar el precio de un ítem que tiene una base (escrita por SQL) también", async () => {
    const seccion = await prisma.seccionCarta.findFirstOrThrow({ select: { id: true } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, nombre: "Para picar", seccionCartaId: seccion.id } });
    await base(cat.producto.pizzas!);
    const r = await agregarOpcionItemAgrupadoCartaCasoDeUso(ctx(), { itemAgrupadoCartaId: item.id, productoId: cat.producto.pizzas!, orden: { ok: true, valor: { orden: null } } });
    expect(r).toMatchObject({ ok: false, codigo: "ES_BASE_CONFIGURABLE" });
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
    expect(await agregarOpcionItemAgrupadoCartaCasoDeUso(ctx(), { itemAgrupadoCartaId: item.id, productoId: cat.producto.gaseosa!, orden: { ok: true, valor: { orden: null } } })).toMatchObject({ ok: true });
    // Defensa: una base metida a mano en el ítem no se iguala.
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, itemAgrupadoCartaId: item.id, productoId: cat.producto.pizzas!, orden: 1 } });
    const sinc = await sincronizarPrecioGrupoCartaCasoDeUso(ctx(), { productoIds: [cat.producto.gaseosa!, cat.producto.pizzas!], precio: 5000, preciosVistos: { [cat.producto.gaseosa!]: 4000, [cat.producto.pizzas!]: 18000 }, puedeEditarCamposSensibles: true });
    expect(sinc).toMatchObject({ ok: false, codigo: "ES_BASE_CONFIGURABLE" });
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: cat.producto.gaseosa! } })).precioVenta)).toBe(4000);
  });

  it("disponibilidad: una base en $0 se pone a la venta sin la clave fina (D4 es solo para directo); una base sin grupo de precio no (BASE_INVALIDA), apagarla sí", async () => {
    const apagar = () => prismaAdmin.disponibilidadProducto.updateMany({ where: { productoId: { in: [cat.producto.pizzas!, cat.producto.gaseosa!] } }, data: { disponible: false } });
    await apagar();
    await prismaAdmin.producto.updateMany({ where: { id: { in: [cat.producto.pizzas!, cat.producto.gaseosa!] } }, data: { precioVenta: 0 } });
    // Directo en $0 sin la clave: como siempre, no.
    expect(await actualizarDisponibilidadProductoCasoDeUso(ctx(), { productoId: cat.producto.gaseosa!, disponible: true, puedeEditarCamposSensibles: false })).toMatchObject({ ok: false, codigo: "SIN_PERMISO_CAMPOS_SENSIBLES" });
    // Base en $0 (el guardado no se cobra) con su grupo de precio: sí.
    await base(cat.producto.pizzas!);
    expect(await actualizarDisponibilidadProductoCasoDeUso(ctx(), { productoId: cat.producto.pizzas!, disponible: true, puedeEditarCamposSensibles: false })).toMatchObject({ ok: true });
    // Base sin grupo de precio (quitado por SQL): no se pone a la venta, ni con la clave.
    await apagar();
    await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: false } });
    const r = await actualizarDisponibilidadProductoCasoDeUso(ctx(), { productoId: cat.producto.pizzas!, disponible: true, puedeEditarCamposSensibles: true });
    expect(r).toMatchObject({ ok: false, codigo: "BASE_INVALIDA" });
    expect(!r.ok && r.mensaje).toMatch(/^"Pizzas" se vende por opción y no se puede poner a la venta así: Falta el precio final de cada opción/);
    expect((await prismaAdmin.disponibilidadProducto.findFirstOrThrow({ where: { productoId: cat.producto.pizzas! } })).disponible).toBe(false);
    expect(await actualizarDisponibilidadProductoCasoDeUso(ctx(), { productoId: cat.producto.pizzas!, disponible: false, puedeEditarCamposSensibles: false })).toMatchObject({ ok: true });
  });
});
