import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, sembrarCremaDelCafe, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";

/**
 * GO-2b (ADR-030), contra Postgres real: ANULAR en el POS un producto con dos adicionales ya enviados. Anular el producto arrastra a sus adicionales (k × lo anulado,
 * un espejo por línea, que repite el padre, y una fila de auditoría por espejo); un adicional solo se rechaza (`ES_ADICIONAL`); el doble clic deja una sola cascada
 * entera (el otro recibe «cambió mientras lo mirabas»); el cierre después de una anulación parcial vende lo que queda; y la carrera cierre contra anulación.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let crema: Awaited<ReturnType<typeof sembrarCremaDelCafe>>;
let cuentaId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  crema = await sembrarCremaDelCafe(s, c);
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

/** Dos cafés medianos con dos shots cada uno (línea ×4) y una crema cada uno (línea ×2), enviados. */
async function cafesConAdicionales() {
  const r = await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.medianoId), elegida(c, c.shotId, 2), { opcionId: crema.cremaId, cantidad: 1, versionDeOpcionId: crema.versionId }] }]);
  expect(r.ok, r.mensaje).toBe(true);
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
  expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  return { cafe: items.find((i) => i.productoId === c.cafeId)!, shot: items.find((i) => i.productoId === c.anclaDelShotId)!, crema: items.find((i) => i.productoId === crema.anclaId)! };
}

const restantes = async () => {
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
  const de = (id: string) => items.filter((i) => i.id === id || i.anulaAItemId === id).reduce((suma, i) => suma + Number(i.cantidad), 0);
  return { items, de };
};

describe("anular en el POS un producto con adicionales (GO-2b)", () => {
  it("parcial y después total: cada adicional anula k × lo anulado del producto, un espejo por línea (con el padre) y una auditoría por espejo", async () => {
    const { cafe, shot, crema: cremaItem } = await cafesConAdicionales();
    expect(await anularItemEnviado(cafe.id, 1, "Se cayó", 2)).toEqual({ ok: true, mensaje: "Se anuló 1 × «Café» (con sus adicionales) de la mesa 4." });
    let r = await restantes();
    expect([r.de(cafe.id), r.de(shot.id), r.de(cremaItem.id)]).toEqual([1, 2, 1]);
    const espejos = r.items.filter((i) => i.anulaAItemId !== null);
    expect(espejos.map((e) => [e.anulaAItemId, Number(e.cantidad), e.lineaPadreId, e.huellaOpciones === cafe.huellaOpciones, e.numeroEnvio]).sort()).toEqual(
      [
        [cafe.id, -1, null, true, 1],
        [shot.id, -2, cafe.id, false, 1],
        [cremaItem.id, -1, cafe.id, false, 1],
      ].sort()
    );
    expect(await prisma.opcionElegidaEnLinea.count({ where: { cuentaItemId: { in: espejos.map((e) => e.id) } } })).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "CuentaItem" } })).toBe(3);

    expect((await anularItemEnviado(cafe.id, 1, "Se cayó otro", 1)).ok).toBe(true);
    r = await restantes();
    expect([r.de(cafe.id), r.de(shot.id), r.de(cremaItem.id)]).toEqual([0, 0, 0]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "CuentaItem" } })).toBe(6);
  });

  it("un adicional solo no se anula (ES_ADICIONAL) y no escribe nada", async () => {
    const { shot } = await cafesConAdicionales();
    expect(await anularItemEnviado(shot.id, 1, "No lo quiso", 4)).toEqual({ ok: false, mensaje: "«Shot extra» es un adicional de otro producto: anulá ese producto y se anula con sus adicionales." });
    expect(await prisma.cuentaItem.count({ where: { cuentaId, anulaAItemId: { not: null } } })).toBe(0);
  });

  it("doble clic a la vez (Promise.all, el mismo restante visto): una sola cascada ENTERA; el otro recibe «cambió mientras lo mirabas»", async () => {
    const { cafe } = await cafesConAdicionales();
    const resultados = await Promise.all([anularItemEnviado(cafe.id, 1, "Doble", 2), anularItemEnviado(cafe.id, 1, "Doble", 2)]);
    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(resultados.find((x) => !x.ok)!.mensaje).toMatch(/cambió mientras lo mirabas/);
    expect(await prisma.cuentaItem.count({ where: { cuentaId, anulaAItemId: { not: null } } })).toBe(3);
  });

  it("después de una anulación parcial, el cierre vende lo que queda: 1 café, 2 shots y 1 crema, colgados del café", async () => {
    const { cafe } = await cafesConAdicionales();
    expect((await anularItemEnviado(cafe.id, 1, "Se cayó", 2)).ok).toBe(true);
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
    const ops = await prisma.operacion.findMany({ where: { proceso: "VENTA" }, include: { movimientos: { where: { proceso: "VENTA" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    expect(ops.map((o) => [o.movimientos[0]!.productoId, -Number(o.movimientos[0]!.cantidad), o.operacionPadreId === ops[0]!.id])).toEqual([
      [c.cafeId, 1, false],
      [c.anclaDelShotId, 2, true],
      [crema.anclaId, 1, true],
    ]);
  });

  it("cerrar contra anular el producto a la vez: o se anula y el cierre vende lo que queda, o se cierra y la anulación se rechaza; nunca una cascada después del cierre", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      if (vuelta > 0) {
        const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 10 + vuelta } });
        cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
      }
      const { cafe } = await cafesConAdicionales();
      const [anulada, cierre] = await Promise.all([anularItemEnviado(cafe.id, 2, "Se fue", 2), cerrarCuenta(cuentaId)]);
      expect(cierre.ok, cierre.mensaje).toBe(true);
      const espejos = await prisma.cuentaItem.count({ where: { cuentaId, anulaAItemId: { not: null } } });
      const vendidos = await prisma.cuentaItem.count({ where: { cuentaId, operacionId: { not: null } } });
      if (anulada.ok) expect([espejos, vendidos], `vuelta ${vuelta}`).toEqual([3, 0]);
      else expect([espejos, vendidos, anulada.mensaje.includes("ya se cerró")], `vuelta ${vuelta}`).toEqual([0, 3, true]);
    }
  });
});
