import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearMozo, entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { guardarParteDePromo } from "../../src/server/actions/carta/promos";

/**
 * E2a, PERMISOS: llevar una parte de una promo al estado pedido es definir lo que entra a la promo por su precio fijo, o sea `carta_promo_definir` (empresa, administrador) verificado en el SERVIDOR: un mozo (que toma pedidos pero no define promos)
 * recibe el rechazo por permiso, sin escribir nada, aunque mande un pedido bien formado; el administrador sí. Y quitarle el permiso al administrador (cambio de permisos) lo deja igual que al mozo. Un pedido mal formado se rechaza antes de tocar la base.
 */
describe("guardarParteDePromo: permiso de definir promos", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let promoId: string;
  let seccionId: string;
  const pedido = (extra: object = {}) => ({ promoCartaId: promoId, lugar: { tipo: "SECCION", seccionCartaId: seccionId }, modo: "TODA", cantidadMinima: 1, cantidadMaxima: 1, ...extra });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Entradas" } })).id;
    const seccionPromo = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionPromo.id, titulo: "Menú", precio: "5000.00", sucursales: { create: { sucursalId: s.sucursalId } } } })).id;
  });

  it("un mozo no puede: el servidor lo rechaza por permiso y no queda ningún cupo", async () => {
    await entrarComo(await crearMozo(s.sucursalId));
    expect(await guardarParteDePromo(pedido())).toMatchObject({ ok: false });
    expect(await prisma.promoCartaCupo.count()).toBe(0);
  });

  it("el administrador puede; sin el permiso (cambio de permisos) deja de poder; un pedido mal formado se rechaza", async () => {
    await entrarComo(s.admin);
    expect(await guardarParteDePromo(pedido({ modo: "TODA", entradas: [{ productoId: "x" }] }))).toMatchObject({ ok: false });
    expect(await prisma.promoCartaCupo.count()).toBe(0);
    expect(await guardarParteDePromo(pedido())).toMatchObject({ ok: true });
    expect(await prisma.promoCartaCupo.findFirstOrThrow()).toMatchObject({ tipo: "SECCION", activo: true });
    await prisma.permisoRol.updateMany({ where: { rol: { nombre: "admin" }, accionClave: "carta_promo_definir" }, data: { puedeEditar: false } });
    expect(await guardarParteDePromo(pedido({ modo: "NO_ENTRA", cantidadMinima: undefined, cantidadMaxima: undefined }))).toMatchObject({ ok: false });
    expect(await prisma.promoCartaCupo.findFirstOrThrow()).toMatchObject({ activo: true });
  });
});
