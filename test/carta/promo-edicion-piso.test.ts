import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// La revalidación de la carta pública se CUENTA (no se ejecuta): un rechazo no revalida.
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPromoCarta } from "../../src/server/actions/carta/promos";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";

/**
 * O.42 (Hito 4, bloque D; arreglo de dinero aprobado por el dueño, `docs/pureza-integracion.md`): EDITAR una promo mira el piso de $0,01 por unidad del peor caso de
 * sus cupos vigentes (`core/carta/piso-de-promo.ts`), el mismo que ya regía al guardar los cupos y el precio local. Antes, el precio de la empresa de una promo con 3
 * unidades de cupo podía bajar a $0,01 (lo fijaba la huella de dinero del tramo C como hallazgo). Sin cupos, no hay piso. El rechazo no escribe NADA: ni los datos
 * de la promo (tampoco el título, que llega en la misma edición) ni la fila de auditoría del precio, y no revalida la carta pública.
 *
 * Los textos van LITERALES (no se arman con `mensajePisoDePromo`): un piso mal calculado (otro mínimo u otras unidades) tiene que verse en rojo acá.
 */
describe("O.42: editar una promo respeta el piso de sus cupos", () => {
  let platosId: string;
  let postresId: string;
  let menuId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    platosId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
    postresId = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
    // Peor caso: Platos hasta 2 + Postres hasta 1 = 3 unidades → piso $0,03.
    menuId = (
      await prisma.promoCarta.create({
        data: {
          seccionCartaId: platosId,
          titulo: "Menú del día",
          precio: 10000,
          sucursales: { create: { sucursalId: base.sucursal.id } },
          cupos: {
            create: [
              { seccionCartaId: platosId, cantidadMinima: 0, cantidadMaxima: 2, orden: 0 },
              { seccionCartaId: postresId, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
            ],
          },
        },
      })
    ).id;
    vi.mocked(revalidarCartasPublicas).mockClear();
  });

  const promo = () => prismaAdmin.promoCarta.findUniqueOrThrow({ where: { id: menuId } });

  it("por debajo del piso: rechaza con el mensaje del piso y no escribe ni audita ni revalida", async () => {
    const antes = await promo();
    const r = await guardarPromoCarta({ id: menuId, seccionCartaId: postresId, titulo: "Menú barato", precio: 0.02 });
    expect(r).toEqual({
      ok: false,
      mensaje:
        'El precio de "Menú barato" ($0.02) no alcanza el piso de $0,01 por unidad en el peor caso (3 unidades si se elige el máximo de cada cupo: hace falta al menos $0.03). Subí el precio o bajá los máximos.',
    });
    expect(await promo()).toEqual(antes);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("justo en el piso: guarda el precio y lo audita", async () => {
    expect(await guardarPromoCarta({ id: menuId, seccionCartaId: platosId, titulo: "Menú del día", precio: 0.03 })).toEqual({ ok: true, mensaje: 'Promo "Menú del día" guardada.' });
    expect(Number((await promo()).precio)).toBe(0.03);
    const auditoria = await prismaAdmin.registroAuditoria.findMany();
    expect(auditoria.map((a) => [a.entidad, a.campo, a.valorAnterior, a.valorNuevo])).toEqual([["PromoCarta", "precio", "10000", "0.03"]]);
    expect(vi.mocked(revalidarCartasPublicas)).toHaveBeenCalledTimes(1);
  });

  it("sin cupos no hay piso: una promo informativa puede bajar a $0,01", async () => {
    await prismaAdmin.promoCartaCupo.deleteMany({ where: { promoCartaId: menuId } });
    expect(await guardarPromoCarta({ id: menuId, seccionCartaId: platosId, titulo: "Menú del día", precio: 0.01 })).toEqual({ ok: true, mensaje: 'Promo "Menú del día" guardada.' });
    expect(Number((await promo()).precio)).toBe(0.01);
  });

  it("el piso es el de los cupos de ESTA promo (los de otra no cuentan)", async () => {
    const otra = await prisma.promoCarta.create({ data: { seccionCartaId: platosId, titulo: "Informativa", precio: 500 } });
    // `menu` tiene 3 unidades de cupo; `otra` ninguna: bajarla a $0,01 se acepta.
    expect((await guardarPromoCarta({ id: otra.id, seccionCartaId: platosId, titulo: "Informativa", precio: 0.01 })).ok).toBe(true);
  });
});
