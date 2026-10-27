import { beforeEach, describe, expect, it } from "vitest";
import { guardarSoloSalonPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-solo-salon-promo-carta";
import { guardarVigenciaPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-vigencia-promo-carta";
import { guardComandoGuardarSoloSalonPromoCarta } from "../../src/core/features/carta/promos.guard";
import { guardComandoGuardarVigenciaPromoCarta } from "../../src/core/features/carta/combos.guard";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";

/**
 * Interruptor «solo salón» de una promo (docs/diseno-promo-solo-salon-2026-10-26.md, paso 4): el CASO DE USO `guardarSoloSalonPromoCartaCasoDeUso`, contra Postgres real y como `motor2_app` con el alcance de la sucursal activa (A).
 * Cubre: lo que escribe (el interruptor y la versión), la auditoría (quién, qué cambió, de qué a qué), la IDEMPOTENCIA (pedir lo que ya está es éxito sin cambio ni auditoría duplicada, también con una versión vieja: un doble clic no
 * muestra «otra persona la cambió»), la versión vieja, otra empresa (RLS: «no encontrada») y la CONCURRENCIA REAL con `Promise.all` (SERIALIZABLE + `UPDATE … WHERE version`).
 *
 * Mutaciones demostradas (rojo y revertidas): sacar la comparación de la versión leída Y el `version: esperada` del `updateMany` (rojo: «versión vieja», «contra la vigencia»); sacar el chequeo «ya tiene el valor» (rojo: «idempotente»
 * y «dos iguales»: audita dos veces); sacar `registrarCambioAuditado` (rojo: «auditoría»); poner `where: { id }` sin empresa… lo frena RLS igual (el test de otra empresa lo fija).
 */
const ITERACIONES = 10;

describe("guardarSoloSalonPromoCartaCasoDeUso", () => {
  let e: EscenarioDeCombosGo3b;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const guardar = (versionEsperada: number, soloSalon: boolean, promoCartaId = e.promoId) => {
    const c = guardComandoGuardarSoloSalonPromoCarta({ promoCartaId, versionEsperada, soloSalon });
    if (!c.ok) throw new Error(c.mensaje);
    return guardarSoloSalonPromoCartaCasoDeUso(actor(), c.valor);
  };
  const promo = () => prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } });
  const auditoria = async (promoCartaId = e.promoId) =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCarta", entidadId: promoCartaId, campo: "soloSalon" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] }));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("prende el interruptor con la versión vista, sube la versión y deja una fila de auditoría (quién, qué, de qué a qué)", async () => {
    expect(await promo()).toMatchObject({ soloSalon: false, version: 1 });
    const r = await guardar(1, true);
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidad: "PromoCarta", entidadId: e.promoId, campo: "soloSalon", valorAnterior: "false", valorNuevo: "true", actorId: e.usuarioId });
    expect(filas[0]!.creadoEn).toBeInstanceOf(Date);
    // Y se apaga con la versión nueva.
    expect(await guardar(2, false)).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await promo()).toMatchObject({ soloSalon: false, version: 3 });
    expect((await auditoria()).map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["false", "true"], ["true", "false"]]);
  });

  it("IDEMPOTENTE: pedir lo que la promo ya tiene es éxito sin cambio — no escribe, no sube la versión ni audita de nuevo —, aunque la versión sea vieja", async () => {
    expect(await guardar(1, false)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await promo()).toMatchObject({ soloSalon: false, version: 1 });
    expect(await auditoria()).toHaveLength(0);
    expect(await guardar(1, true)).toMatchObject({ ok: true, datos: { huboCambio: true } });
    // Un segundo pedido igual (doble clic, reintento de red), con la versión que tenía la pantalla: éxito, no «otra persona la cambió».
    expect(await guardar(1, true)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    expect(await auditoria()).toHaveLength(1);
  });

  it("con una versión vieja y un valor distinto no escribe nada (VERSION_DESACTUALIZADA)", async () => {
    expect(await guardar(1, true)).toMatchObject({ ok: true });
    const r = await guardar(1, false);
    expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(r.mensaje).toContain("Otra persona cambió");
    expect(r.mensaje).toContain("Recargá la pantalla");
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    expect(await auditoria()).toHaveLength(1);
  });

  it("comparte versión con la vigencia: guardar la vigencia invalida la pantalla del interruptor (y al revés), sin pisar nada", async () => {
    const c = guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada: 1, vigenteDesde: "2026-10-01" });
    if (!c.ok) throw new Error(c.mensaje);
    expect(await guardarVigenciaPromoCartaCasoDeUso(actor(), c.valor)).toMatchObject({ ok: true });
    expect(await guardar(1, true)).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect((await promo()).soloSalon).toBe(false);
    expect(await guardar(2, true)).toMatchObject({ ok: true });
    expect(await promo()).toMatchObject({ soloSalon: true, version: 3 });
    expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).vigenteDesde?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("una promo que no existe se rechaza (PROMO_NO_ENCONTRADA) sin escribir", async () => {
    expect(await guardar(1, true, "no-existe")).toMatchObject({ ok: false, codigo: "PROMO_NO_ENCONTRADA" });
    expect(await prismaAdmin.registroAuditoria.count({ where: { campo: "soloSalon" } })).toBe(0);
  });

  it("OTRA EMPRESA: la promo de la empresa testigo no se ve ni se toca (RLS + búsqueda por id: «no encontrada»), y no se audita", async () => {
    const ajenos = await sembrarCombosAjenos();
    const r = await guardar(1, true, ajenos.promo.id);
    expect(r).toMatchObject({ ok: false, codigo: "PROMO_NO_ENCONTRADA" });
    expect(await prismaAdmin.promoCarta.findUniqueOrThrow({ where: { id: ajenos.promo.id } })).toMatchObject({ soloSalon: false, version: 1 });
    expect(await prismaAdmin.registroAuditoria.count({ where: { campo: "soloSalon" } })).toBe(0);
  });

  it("CONCURRENCIA REAL: dos pedidos iguales a la vez (misma versión) — los dos ven éxito, uno solo cambia y audita (loop de 10)", async () => {
    // Se cuentan las transacciones SERIALIZABLE abiertas: si en ninguna iteración chocaron, el test no ejercitó el reintento.
    for (let i = 0; i < ITERACIONES; i++) {
      const { version, soloSalon } = await promo();
      const destino = !soloSalon;
      const antes = (await auditoria()).length;
      const resultados = await Promise.all([guardar(version, destino), guardar(version, destino)]);
      expect(resultados.every((r) => r.ok), `iteración ${i}: ${resultados.map((r) => r.mensaje).join(" | ")}`).toBe(true);
      expect(resultados.filter((r) => r.ok && r.datos.huboCambio), `iteración ${i}`).toHaveLength(1);
      expect(await promo(), `iteración ${i}`).toMatchObject({ soloSalon: destino, version: version + 1 });
      expect((await auditoria()).length, `iteración ${i}`).toBe(antes + 1);
    }
  });

  it("CONCURRENCIA REAL: dos administradores con la misma pantalla y pedidos OPUESTOS — nunca se pisan: el estado final es el de uno de los dos, con una sola versión de más y sin auditoría duplicada (loop de 10)", async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const { version, soloSalon } = await promo();
      const antes = (await auditoria()).length;
      // A pide lo opuesto a lo que hay (un cambio real); B pide lo que ya hay (no cambia nada): se pisarían si alguno ignorara la versión.
      const [a, b] = await Promise.all([guardar(version, !soloSalon), guardar(version, soloSalon)]);
      expect(a, `iteración ${i}: ${a.mensaje}`).toMatchObject({ ok: true, datos: { huboCambio: true } });
      // B pide lo que ya hay: si lee antes de que A confirme, éxito sin cambio; si lee después, ve la versión nueva y un valor distinto: VERSION_DESACTUALIZADA. Nunca revierte lo de A.
      expect(b.ok || b.codigo === "VERSION_DESACTUALIZADA", `iteración ${i}: ${b.mensaje}`).toBe(true);
      if (b.ok) expect(b.datos.huboCambio, `iteración ${i}`).toBe(false);
      expect(await promo(), `iteración ${i}`).toMatchObject({ soloSalon: !soloSalon, version: version + 1 });
      expect((await auditoria()).length, `iteración ${i}`).toBe(antes + 1);
    }
  });

  it("CONCURRENCIA REAL: el interruptor contra la vigencia sobre la MISMA versión — gana uno y el otro VERSION_DESACTUALIZADA; nada se pisa (loop de 10)", async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const { version, soloSalon } = await promo();
      const c = guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada: version, vigenteHasta: `2026-12-${String(i + 1).padStart(2, "0")}` });
      if (!c.ok) throw new Error(c.mensaje);
      const [a, b] = await Promise.all([guardar(version, !soloSalon), guardarVigenciaPromoCartaCasoDeUso(actor(), c.valor)]);
      expect([a, b].filter((r) => r.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
      expect((await promo()).version, `iteración ${i}`).toBe(version + 1);
    }
  });
});
