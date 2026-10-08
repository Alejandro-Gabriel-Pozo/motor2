import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `dinero-de-carta-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima
 * llamada a `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió. El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarSeccionCarta } from "../../src/server/actions/carta/secciones";
import { guardarCuposPromoCarta, guardarPromoCarta } from "../../src/server/actions/carta/promos";

/**
 * S-06 (plan de endurecimiento de seguridad, tanda T2): `guardarCuposPromoCarta` REEMPLAZABA los cupos de una promo sin dejar rastro. Los cupos fijan cuántas
 * unidades de cada sección entran por el precio de la promo (el POS prorratea el precio entre lo elegido): subir el máximo de un cupo de 2 a 30 cambia cuánta
 * mercadería sale por el mismo importe, y no quedaba quién lo hizo ni cuándo. Ahora cada cupo que cambia (o aparece, o desaparece) deja una fila de auditoría por
 * columna (`cantidadMinima`, `cantidadMaxima`) con el valor anterior y el nuevo, DENTRO de la transacción del reemplazo: si la auditoría falla, no queda ni el
 * cupo nuevo ni una fila suelta.
 */
describe("S-06: los cupos de una promo se auditan", () => {
  let promoId: string;
  let entradasId: string;
  let postresId: string;
  let adminId: string;

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const entradas = await guardarSeccionCarta({ nombre: "Entradas" });
    const postres = await guardarSeccionCarta({ nombre: "Postres" });
    const menu = await guardarSeccionCarta({ nombre: "Menús" });
    entradasId = entradas.ok ? entradas.id : "";
    postresId = postres.ok ? postres.id : "";
    expect((await guardarPromoCarta({ seccionCartaId: menu.ok ? menu.id : "", titulo: "Menú del día", precio: 20000 })).ok).toBe(true);
    promoId = (await prisma.promoCarta.findFirstOrThrow({ where: { titulo: "Menú del día" } })).id;
    interruptor.llamadas = 0;
  });

  const filasDeCupos = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCartaCupo" }, orderBy: [{ entidadId: "asc" }, { campo: "asc" }] })).map((f) => ({
      entidadId: f.entidadId,
      campo: f.campo,
      valorAnterior: f.valorAnterior,
      valorNuevo: f.valorNuevo,
      actorId: f.actorId,
      sucursalId: f.sucursalId,
    }));

  const idCupo = (seccionId: string) => `${promoId}:${seccionId}`;

  it("EL ATAQUE: subir el máximo de un cupo de 2 a 30 deja una fila con el anterior y el nuevo (antes: cero filas)", async () => {
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 }])).ok).toBe(true);
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });

    // 30 unidades por $20.000: el piso de $0,01 por unidad se cumple de sobra, así que solo la auditoría puede dejar el rastro.
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 30 }])).ok).toBe(true);

    expect(await filasDeCupos()).toEqual([{ entidadId: idCupo(entradasId), campo: "cantidadMaxima", valorAnterior: "2", valorNuevo: "30", actorId: adminId, sucursalId: null }]);
  });

  it("un cupo nuevo deja una fila por columna con anterior null; los que no cambian no dejan fila", async () => {
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 }])).ok).toBe(true);
    expect(await filasDeCupos()).toEqual([
      { entidadId: idCupo(entradasId), campo: "cantidadMaxima", valorAnterior: null, valorNuevo: "2", actorId: adminId, sucursalId: null },
      { entidadId: idCupo(entradasId), campo: "cantidadMinima", valorAnterior: null, valorNuevo: "1", actorId: adminId, sucursalId: null },
    ]);

    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
    // Mismo cupo, mismos valores: no cambia nada, no hay rastro que dejar.
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 }])).ok).toBe(true);
    expect(await filasDeCupos()).toEqual([]);
  });

  it("un cupo que ya no viene en la lista deja una fila por columna con nuevo null (y el otro, intacto, ninguna)", async () => {
    expect(
      (await guardarCuposPromoCarta(promoId, [
        { seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 },
        { seccionCartaId: postresId, cantidadMaxima: 1 },
      ])).ok,
    ).toBe(true);
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });

    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 }])).ok).toBe(true);
    expect(await filasDeCupos()).toEqual([
      { entidadId: idCupo(postresId), campo: "cantidadMaxima", valorAnterior: "1", valorNuevo: null, actorId: adminId, sucursalId: null },
      { entidadId: idCupo(postresId), campo: "cantidadMinima", valorAnterior: "0", valorNuevo: null, actorId: adminId, sucursalId: null },
    ]);

    // Y vaciarla del todo (volver a informativa) también deja el rastro del último cupo.
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
    expect((await guardarCuposPromoCarta(promoId, [])).ok).toBe(true);
    expect((await filasDeCupos()).map((f) => `${f.campo}:${f.valorAnterior}->${f.valorNuevo}`)).toEqual(["cantidadMaxima:2->null", "cantidadMinima:1->null"]);
  });

  it("la descripción dice la promo y la sección (se lee en la pantalla de auditoría)", async () => {
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: postresId, cantidadMaxima: 3 }])).ok).toBe(true);
    const fila = await prismaAdmin.registroAuditoria.findFirstOrThrow({ where: { entidad: "PromoCartaCupo", campo: "cantidadMaxima" } });
    expect(fila.descripcion).toContain("Menú del día");
    expect(fila.descripcion).toContain("Postres");
  });

  it("un rechazo (por el piso, o por la forma) no escribe cupos ni deja filas de auditoría", async () => {
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMaxima: 2 }])).ok).toBe(true);
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });

    // Un máximo de 2.000.001 unidades por $20.000 no alcanza el piso de $0,01 por unidad en el peor caso.
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMaxima: 2_000_001 }])).ok).toBe(false);
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: "no-existe", cantidadMaxima: 1 }])).ok).toBe(false);
    expect((await prisma.promoCartaCupo.findMany({ where: { promoCartaId: promoId } })).map((c) => c.cantidadMaxima)).toEqual([2]);
    expect(await filasDeCupos()).toEqual([]);
  });

  it("atomicidad: si falla la auditoría, quedan los cupos anteriores y ninguna fila suelta", async () => {
    expect((await guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 2 }])).ok).toBe(true);
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 1;

    await expect(guardarCuposPromoCarta(promoId, [{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 30 }])).rejects.toThrow("auditoría caída");

    const cupos = await prisma.promoCartaCupo.findMany({ where: { promoCartaId: promoId } });
    expect(cupos.map((c) => c.cantidadMaxima)).toEqual([2]);
    expect(await filasDeCupos()).toEqual([]);
  });
});
