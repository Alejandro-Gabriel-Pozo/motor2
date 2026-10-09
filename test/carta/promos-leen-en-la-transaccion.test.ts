import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { guardarPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-promo-carta";
import { guardarPrecioLocalPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-precio-local-promo-carta";
import { guardarCuposPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta";
import { guardComandoGuardarCuposPromoCarta, guardComandoGuardarPrecioLocalPromoCarta } from "../../src/core/features/carta/promos.guard";

/**
 * M14 (S-51 de `docs/pureza-integracion.md`; hallazgo de la auditoría de acciones) y M-5 (auditoría intermedia): el piso de precio de una promo (el precio de la empresa y el local contra los cupos) se
 * leía FUERA de la transacción de la escritura: dos pedidos a la vez (cambiar los cupos y cambiar un precio) leían cada uno el estado viejo del otro y el precio quedaba BAJO el piso de los cupos
 * nuevos. Ahora cada caso de uso lee y escribe en UNA transacción SERIALIZABLE (uno aborta, el reintento relee y rechaza).
 *
 * Reproductor determinista: un `actor.db` que EXPLOTA ante cualquier uso (toda lectura de afuera de la transacción); y uno de carrera real (los dos pedidos a la vez, varias veces).
 */
describe("promos: el piso se lee y se escribe dentro de la transacción (M14, M-5)", () => {
  let sucursalId: string;
  let usuarioId: string;
  let platosId: string;
  let promoId: string;

  const dbProhibida = new Proxy({}, { get: (_t, p) => { throw new Error(`lectura FUERA de la transacción: actor.db.${String(p)}`); } }) as never;
  const actor = () => ({ usuarioId, sucursalId, transaccion: baseDeTest.transaccion, db: dbProhibida });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    platosId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: platosId, titulo: "Menú", precio: 10000, sucursales: { create: { sucursalId } } } })).id;
  });

  const cupos100 = [{ seccionCartaId: "", cantidadMinima: 0, cantidadMaxima: 100 }];
  const conSeccion = () => cupos100.map((c) => ({ ...c, seccionCartaId: platosId }));
  // S-52: los casos de uso reciben el resultado de los guards (la acción los calcula).
  const cuposDelGuard = () => guardComandoGuardarCuposPromoCarta({ cupos: conSeccion() });
  const precioDelGuard = (precioLocal: number) => guardComandoGuardarPrecioLocalPromoCarta({ precioLocal });

  it("guardarPromoCarta (edición): sin tocar `actor.db`, y el piso de los cupos vigentes sigue rigiendo", async () => {
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, seccionCartaId: platosId, cantidadMinima: 0, cantidadMaxima: 100, orden: 0 } });
    const rechazo = await guardarPromoCartaCasoDeUso(actor(), { id: promoId, seccionCartaId: platosId, titulo: "Menú", descripcion: null, precio: 0.5, orden: 0 });
    expect(rechazo).toMatchObject({ ok: false, codigo: "BAJO_EL_PISO" });
    const ok = await guardarPromoCartaCasoDeUso(actor(), { id: promoId, seccionCartaId: platosId, titulo: "Menú", descripcion: null, precio: 1, orden: 0 });
    expect(ok.ok, ok.ok ? "" : ok.mensaje).toBe(true);
  });

  it("guardarPromoCarta (alta): anda igual (la clave de prender es un gate y se lee con la base del contexto, M19)", async () => {
    const r = await guardarPromoCartaCasoDeUso({ ...actor(), db: baseDeTest.db }, { seccionCartaId: platosId, titulo: "Otra", descripcion: null, precio: 5000, orden: 1 });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(await prisma.promoCarta.count()).toBe(2);
  });

  it("guardarPrecioLocalPromoCarta: sin tocar `actor.db`, y el piso de los cupos vigentes sigue rigiendo", async () => {
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, seccionCartaId: platosId, cantidadMinima: 0, cantidadMaxima: 100, orden: 0 } });
    expect(await guardarPrecioLocalPromoCartaCasoDeUso(actor(), { promoCartaId: promoId, precio: precioDelGuard(0.5) })).toMatchObject({ ok: false, codigo: "BAJO_EL_PISO" });
    const ok = await guardarPrecioLocalPromoCartaCasoDeUso(actor(), { promoCartaId: promoId, precio: precioDelGuard(1) });
    expect(ok.ok, ok.ok ? "" : ok.mensaje).toBe(true);
  });

  it("guardarCuposPromoCarta: sin tocar `actor.db`", async () => {
    const r = await guardarCuposPromoCartaCasoDeUso(actor(), { promoCartaId: promoId, cupos: cuposDelGuard() });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(await prisma.promoCartaCupo.count({ where: { promoCartaId: promoId } })).toBe(1);
  });

  it("carrera real: cambiar los cupos (100 unidades, piso $1) y poner el precio local en $0,50 a la vez NUNCA deja el precio bajo el piso de los cupos", async () => {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promoId } });
      await prisma.promoCartaSucursal.updateMany({ where: { promoCartaId: promoId }, data: { precioLocal: null } });

      const [cupos, precio] = await Promise.all([
        guardarCuposPromoCartaCasoDeUso(actor(), { promoCartaId: promoId, cupos: cuposDelGuard() }),
        guardarPrecioLocalPromoCartaCasoDeUso(actor(), { promoCartaId: promoId, precio: precioDelGuard(0.5) }),
      ]);

      const hayCupos = (await prismaAdmin.promoCartaCupo.count({ where: { promoCartaId: promoId } })) > 0;
      const local = (await prismaAdmin.promoCartaSucursal.findFirstOrThrow({ where: { promoCartaId: promoId } })).precioLocal;
      const quedoBajoElPiso = hayCupos && local !== null && Number(local) < 1;
      expect(quedoBajoElPiso, `vuelta ${vuelta}: cupos ${JSON.stringify(cupos.ok)} / precio local ${JSON.stringify(precio.ok)}`).toBe(false);
      // Exactamente uno de los dos gana si chocan; si el precio fue primero, los cupos lo rechazan por el piso, y al revés.
      expect(cupos.ok || precio.ok).toBe(true);
    }
  });
});
