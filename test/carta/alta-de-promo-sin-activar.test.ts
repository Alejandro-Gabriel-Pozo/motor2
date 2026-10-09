import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { guardarPromoCarta } from "../../src/server/actions/carta/promos";

/**
 * S-10 / D1, la fila de sucursal del alta de una promo (fila O.59 de `docs/pureza-integracion.md`; CAMBIA COMPORTAMIENTO, aprobado por el dueño). Una promo es de la EMPRESA: definirla
 * (`carta_promo_definir`, clave de empresa que sigue valiendo con la membresía de cualquier sucursal) no es lo mismo que PRENDERLA en una sucursal (`carta_promo_activar`, clave de
 * sucursal). El alta creaba SIEMPRE la fila de `PromoCartaSucursal` de la sucursal activa PRENDIDA: quien definía una promo con `carta_promo_definir` (por la membresía de otra sucursal)
 * la ofrecía en la carta y en el POS de una sucursal donde no puede prender nada. Ahora la fila de la sucursal activa nace prendida solo si quien la crea tiene `carta_promo_activar`
 * ALLÍ; si no, nace APAGADA (la promo existe y la prende quien pueda).
 *
 * Escenario: Central (S1) y Norte (S2). `mixto` es administrador de Central y operador de Norte (sin `carta_promo_activar` allá); la sucursal activa es Norte. `dueno` es administrador de las dos.
 */
describe("S-10 / D1: el alta de una promo no se prende sola donde quien la crea no puede prenderla", () => {
  let centralId: string;
  let norteId: string;
  let seccionId: string;
  let mixtoId: string;
  let duenoId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const filasDeLaPromo = () => prisma.promoCartaSucursal.findMany({ where: { promoCarta: { titulo: "Combo" } } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    duenoId = (await crearUsuarioConMembresia({ email: "dueno@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: duenoId, sucursalId: norteId, rolId: base.admin.id });
    mixtoId = (await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: mixtoId, sucursalId: norteId, rolId: base.operador.id });
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
  });

  it("`carta_promo_definir` por la membresía de Central, sin `carta_promo_activar` en Norte (la activa): la promo se crea y nace APAGADA en Norte", async () => {
    await como(mixtoId, "mixto@test.com");
    __setCookieDeTestParaSucursal(norteId);
    const r = await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 10, orden: 1 });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.promoCarta.count({ where: { titulo: "Combo" } })).toBe(1);
    const filas = await filasDeLaPromo();
    expect(filas.map((f) => ({ sucursalId: f.sucursalId, activa: f.activa }))).toEqual([{ sucursalId: norteId, activa: false }]);
    // El mensaje no le dice que quedó prendida donde no lo está.
    expect(r.mensaje).not.toMatch(/prendida en esta sucursal/);
  });

  it("CONTROL: con `carta_promo_activar` en la sucursal activa, la promo nace prendida acá (como siempre)", async () => {
    await como(duenoId, "dueno@test.com");
    __setCookieDeTestParaSucursal(norteId);
    const r = await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 10, orden: 1 });
    expect(r.ok, r.mensaje).toBe(true);
    expect((await filasDeLaPromo()).map((f) => ({ sucursalId: f.sucursalId, activa: f.activa }))).toEqual([{ sucursalId: norteId, activa: true }]);
    expect(r.mensaje).toMatch(/prendida en esta sucursal/);
  });

  it("CONTROL: la misma persona, parada en Central (donde sí es administrador), la prende en Central y no toca Norte", async () => {
    await como(mixtoId, "mixto@test.com");
    __setCookieDeTestParaSucursal(centralId);
    const r = await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 10, orden: 1 });
    expect(r.ok, r.mensaje).toBe(true);
    expect((await filasDeLaPromo()).map((f) => ({ sucursalId: f.sucursalId, activa: f.activa }))).toEqual([{ sucursalId: centralId, activa: true }]);
  });

  it("la edición de una promo existente no toca la fila de ninguna sucursal", async () => {
    await como(duenoId, "dueno@test.com");
    __setCookieDeTestParaSucursal(norteId);
    await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 10, orden: 1 });
    const promo = await prisma.promoCarta.findFirstOrThrow({ where: { titulo: "Combo" } });
    await prisma.promoCartaSucursal.updateMany({ where: { promoCartaId: promo.id }, data: { activa: false } });
    await como(mixtoId, "mixto@test.com");
    const r = await guardarPromoCarta({ id: promo.id, seccionCartaId: seccionId, titulo: "Combo", precio: 12, orden: 1 });
    expect(r.ok, r.mensaje).toBe(true);
    expect((await filasDeLaPromo()).map((f) => f.activa)).toEqual([false]);
  });
});
