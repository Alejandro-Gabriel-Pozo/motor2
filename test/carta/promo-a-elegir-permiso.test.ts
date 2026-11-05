import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { crearMozo, entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { agregarEntradaDeCupo } from "../../src/server/actions/carta/combos";

/**
 * Promo «a elegir», PERMISOS: dar de alta una entrada «a elegir» es definir lo que entra a una promo por su precio fijo, o sea `carta_promo_definir` (empresa, administrador) verificado en el SERVIDOR: un mozo (que
 * toma pedidos pero no define promos) recibe el rechazo por permiso, sin escribir nada, aunque mande un pedido bien formado; el administrador sí. Y quitarle el permiso al administrador lo deja igual que al mozo.
 */
describe("entrada «a elegir»: permiso de definir promos", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let cupoId: string;
  const pedido = () => ({ cupoId, productoId: c.cafeId, modoDeOpciones: "A_ELEGIR", opciones: [{ opcionId: c.chicoId }, { opcionId: c.medianoId }] });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Café y flan", precio: "2000.00", sucursales: { create: { sucursalId: s.sucursalId } } } });
    cupoId = (await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "LISTA", nombre: "Café", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
  });

  it("un mozo no puede: el servidor lo rechaza por permiso y no queda ninguna entrada", async () => {
    await entrarComo(await crearMozo(s.sucursalId));
    expect(await agregarEntradaDeCupo(pedido())).toMatchObject({ ok: false });
    expect(await prisma.entradaDeCupo.count()).toBe(0);
  });

  it("el administrador puede; sin el permiso (cambio de permisos) deja de poder", async () => {
    await entrarComo(s.admin);
    expect(await agregarEntradaDeCupo(pedido())).toMatchObject({ ok: true });
    expect(await prisma.entradaDeCupo.findFirstOrThrow()).toMatchObject({ modoDeOpciones: "A_ELEGIR" });
    await prisma.permisoRol.updateMany({ where: { rol: { nombre: "admin" }, accionClave: "carta_promo_definir" }, data: { puedeEditar: false } });
    await prisma.entradaDeCupo.updateMany({ data: { activa: false } });
    const sinPermiso = await agregarEntradaDeCupo({ ...pedido(), opciones: [{ opcionId: c.chicoId }] });
    expect(sinPermiso).toMatchObject({ ok: false });
    expect(await prisma.entradaDeCupo.count()).toBe(1);
  });
});
