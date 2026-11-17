import { beforeEach, describe, expect, it } from "vitest";
import { guardarParteDePromoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-parte-de-promo";
import { guardComandoGuardarParteDePromo } from "../../src/core/features/carta/promos.guard";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";

/**
 * E2a de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`: el comando `guardarParteDePromo` (una parte y sus platos en UNA transacción SERIALIZABLE), contra Postgres real, como `motor2_app` con el alcance de la sucursal A.
 * Cubre: escritura IDEMPOTENTE (repetir no duplica ni escribe ni audita), pasar de «Toda la sección» a «Solo estos platos» y volver (I10: no conviven; I11: todo o nada), el bloqueo de I12b, el piso de $0,01 por unidad sobre TODAS las partes,
 * la ATOMICIDAD (un plato que falla deshace también el cupo), el AISLAMIENTO (otra empresa no se ve ni se toca), la CONCURRENCIA (dos guardados a la vez de la misma parte) y la AUDITORÍA. El permiso se prueba en `guardar-parte-de-promo-permiso.test.ts`.
 *
 * Mutaciones demostradas (rojo y revertidas): no dar de baja los platos que no vinieron (rojo: «I10 e I11», el conjunto final); sacar la baja del cupo SECCION al elegir «Solo estos platos» (rojo: «I10 e I11» y la concurrencia «Toda»/«Solo estos»);
 * medir el piso solo con la parte nueva y no con todas (rojo: «piso»).
 */
describe("guardarParteDePromo (E2a)", () => {
  let e: EscenarioDeCombosGo3b;
  let seccionEntradas: string;
  let seccionPostres: string;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const guardar = (entrada: object) => {
    const comando = guardComandoGuardarParteDePromo({ promoCartaId: e.promoId, ...entrada });
    if (!comando.ok) throw new Error(comando.mensaje);
    return guardarParteDePromoCasoDeUso(actor(), comando.valor);
  };
  const deSeccion = (seccionCartaId: string, modo: "NO_ENTRA" | "TODA" | "SOLO_ESTOS", extra: object = {}) =>
    guardar({ lugar: { tipo: "SECCION", seccionCartaId }, modo, ...(modo === "NO_ENTRA" ? {} : { cantidadMinima: 1, cantidadMaxima: 1 }), ...extra });
  const plato = (productoId: string) => ({ productoId, modoDeOpciones: "FIJAS" as const, opciones: [] });
  const cupos = async () => (await prisma.promoCartaCupo.findMany({ where: { promoCartaId: e.promoId }, orderBy: [{ orden: "asc" }, { id: "asc" }] })).map((c) => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, seccion: c.seccionCartaId, activo: c.activo, min: c.cantidadMinima, max: c.cantidadMaxima }));
  const delLugar = async (seccionCartaId: string, nombre: string) => {
    const todos = await cupos();
    return { entera: todos.find((c) => c.tipo === "SECCION" && c.seccion === seccionCartaId), lista: todos.find((c) => c.tipo === "LISTA" && c.nombre === nombre) };
  };
  const auditoria = async () => (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: { in: ["PromoCartaCupo", "EntradaDeCupo"] } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => [f.entidad, f.entidadId, f.campo, f.valorAnterior, f.valorNuevo]);
  const activas = async (cupoId: string) => (await prisma.entradaDeCupo.findMany({ where: { cupoId, activa: true } })).map((x) => x.productoId).sort();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
    seccionEntradas = (await prisma.seccionCarta.create({ data: { nombre: "Entradas" } })).id;
    seccionPostres = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
  });

  it("«Toda la sección» crea el cupo de sección; repetirlo no escribe ni audita (por estado)", async () => {
    const r = await deSeccion(seccionEntradas, "TODA");
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect((await delLugar(seccionEntradas, "Entradas")).entera).toMatchObject({ activo: true, min: 1, max: 1 });
    const antes = await auditoria();
    expect(antes.filter((f) => f[0] === "PromoCartaCupo").map((f) => f[2]).sort()).toEqual(["cantidadMaxima", "cantidadMinima"]);
    const cantidad = (await cupos()).length;
    expect(await deSeccion(seccionEntradas, "TODA")).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect((await cupos()).length).toBe(cantidad);
    expect(await auditoria()).toEqual(antes);
  });

  it("«Solo estos platos» crea una lista con el nombre de la sección y sus platos; repetirlo no duplica ni audita; la auditoría dice quién", async () => {
    const r = await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.guisoId)] });
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    const { entera, lista } = await delLugar(seccionEntradas, "Entradas");
    expect(entera).toBeUndefined();
    expect(lista).toMatchObject({ activo: true, min: 1, max: 1 });
    expect(await activas(lista!.id)).toEqual([e.sopaId, e.guisoId].sort());
    const antes = await auditoria();
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: { in: ["PromoCartaCupo", "EntradaDeCupo"] } } });
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) expect(f.actorId).toBe(e.usuarioId);
    expect(await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.guisoId), plato(e.sopaId)] })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.entradaDeCupo.count({ where: { cupoId: lista!.id } })).toBe(2);
    expect(await auditoria()).toEqual(antes);
  });

  it("I10 e I11: de «Toda» a «Solo estos» (y al revés) no conviven; lo que no vino se da de baja y lo que vuelve se reactiva (el conjunto es el final)", async () => {
    await deSeccion(seccionEntradas, "TODA");
    await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.guisoId)] });
    let { entera, lista } = await delLugar(seccionEntradas, "Entradas");
    expect(entera).toMatchObject({ activo: false });
    expect(lista).toMatchObject({ activo: true });
    // El conjunto final: sale el guiso y entra la milanesa.
    await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.milanesaId)] });
    expect(await activas(lista!.id)).toEqual([e.sopaId, e.milanesaId].sort());
    expect(await prisma.entradaDeCupo.count({ where: { cupoId: lista!.id } })).toBe(3);
    // Volver a «Toda»: la lista queda dada de baja (con sus platos guardados) y la sección entra.
    await deSeccion(seccionEntradas, "TODA");
    ({ entera, lista } = await delLugar(seccionEntradas, "Entradas"));
    expect(entera).toMatchObject({ activo: true });
    expect(lista).toMatchObject({ activo: false });
    expect(await prisma.promoCartaCupo.count({ where: { promoCartaId: e.promoId, OR: [{ seccionCartaId: seccionEntradas }, { nombre: "Entradas" }] } })).toBe(2);
    // «No entra»: ninguno de los dos queda activo.
    await deSeccion(seccionEntradas, "NO_ENTRA");
    ({ entera, lista } = await delLugar(seccionEntradas, "Entradas"));
    expect([entera?.activo, lista?.activo]).toEqual([false, false]);
  });

  it("«No está en la carta»: una lista con nombre propio, solo «Solo estos platos»; su nombre no puede ser el de una sección que ya entra entera ni el de un lugar de otro tipo", async () => {
    const fuera = (extra: object) => guardar({ lugar: { tipo: "LISTA", nombre: "No está en la carta" }, modo: "SOLO_ESTOS", cantidadMinima: 1, cantidadMaxima: 1, ...extra });
    expect(await fuera({ entradas: [plato(e.guisoId)] })).toMatchObject({ ok: true });
    expect((await cupos()).find((c) => c.nombre === "No está en la carta")).toMatchObject({ tipo: "LISTA", activo: true });
    await deSeccion(seccionPostres, "TODA");
    const choque = await guardar({ lugar: { tipo: "LISTA", nombre: "postres" }, modo: "SOLO_ESTOS", cantidadMinima: 1, cantidadMaxima: 1, entradas: [plato(e.flanId)] });
    expect(choque).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    const otroTipo = await guardar({ lugar: { tipo: "LISTA", nombre: "Plato del día" }, modo: "SOLO_ESTOS", cantidadMinima: 1, cantidadMaxima: 1, entradas: [plato(e.flanId)] });
    expect(otroTipo).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    expect(await prisma.entradaDeCupo.count({ where: { productoId: e.flanId } })).toBe(0);
  });

  it("I12b: «Solo estos platos» sin ningún plato y con mínimo mayor a 0 se bloquea sin escribir; con mínimo 0 se acepta", async () => {
    const antes = { cupos: await cupos(), auditoria: await auditoria() };
    expect(await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [] })).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    expect({ cupos: await cupos(), auditoria: await auditoria() }).toEqual(antes);
    expect(await guardar({ lugar: { tipo: "SECCION", seccionCartaId: seccionEntradas }, modo: "SOLO_ESTOS", cantidadMinima: 0, cantidadMaxima: 2, entradas: [] })).toMatchObject({ ok: true });
  });

  it("ATOMICIDAD: si un plato falla (sin receta) no queda nada a medias: ni el cupo, ni los platos anteriores, ni la auditoría", async () => {
    const antes = { cupos: await cupos(), auditoria: await auditoria(), entradas: await prisma.entradaDeCupo.count() };
    const r = await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.sinRecetaId)] });
    expect(r).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect({ cupos: await cupos(), auditoria: await auditoria(), entradas: await prisma.entradaDeCupo.count() }).toEqual(antes);
    // También al volver de «Toda»: la sección sigue entera.
    await deSeccion(seccionEntradas, "TODA");
    const medio = { cupos: await cupos(), auditoria: await auditoria() };
    expect(await deSeccion(seccionEntradas, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.sinRecetaId)] })).toMatchObject({ ok: false });
    expect({ cupos: await cupos(), auditoria: await auditoria() }).toEqual(medio);
  });

  it("piso: se mide sobre TODAS las partes de la promo, no solo la nueva; no se escribe nada si no alcanza", async () => {
    // La promo ya tiene 3 cupos de 1 unidad (Entrada, Plato del día, Postre): $0,03 de piso. Con precio $0,05 entran 2 unidades más; 3 más no.
    await prismaAdmin.promoCarta.update({ where: { id: e.promoId }, data: { precio: "0.05" } });
    const antes = { cupos: await cupos(), auditoria: await auditoria() };
    const sube = (max: number) => guardar({ lugar: { tipo: "SECCION", seccionCartaId: seccionEntradas }, modo: "TODA", cantidadMinima: 0, cantidadMaxima: max });
    const r = await sube(3);
    expect(r).toMatchObject({ ok: false, codigo: "BAJO_EL_PISO" });
    expect({ cupos: await cupos(), auditoria: await auditoria() }).toEqual(antes);
    expect(await sube(2)).toMatchObject({ ok: true });
    // El precio LOCAL de una sucursal también cuenta.
    await prismaAdmin.promoCartaSucursal.updateMany({ where: { promoCartaId: e.promoId, sucursalId: e.sucursalA }, data: { precioLocal: "0.04" } });
    expect(await guardar({ lugar: { tipo: "SECCION", seccionCartaId: seccionPostres }, modo: "TODA", cantidadMinima: 0, cantidadMaxima: 1 })).toMatchObject({ ok: false, codigo: "BAJO_EL_PISO" });
  });

  it("AISLAMIENTO: la promo, la sección y el plato de otra empresa no se ven ni se tocan", async () => {
    const ajeno = await sembrarCombosAjenos();
    const antes = { cupos: await cupos(), auditoria: await auditoria() };
    const comando = (extra: object) => {
      const c = guardComandoGuardarParteDePromo({ promoCartaId: e.promoId, modo: "TODA", cantidadMinima: 1, cantidadMaxima: 1, ...extra });
      if (!c.ok) throw new Error(c.mensaje);
      return guardarParteDePromoCasoDeUso(actor(), c.valor);
    };
    expect(await comando({ promoCartaId: ajeno.promo.id, lugar: { tipo: "SECCION", seccionCartaId: seccionEntradas } })).toMatchObject({ ok: false, codigo: "PROMO_NO_ENCONTRADA" });
    expect(await comando({ lugar: { tipo: "SECCION", seccionCartaId: ajeno.promo.seccionCartaId } })).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    expect(await comando({ lugar: { tipo: "SECCION", seccionCartaId: seccionEntradas }, modo: "SOLO_ESTOS", entradas: [plato(ajeno.producto.id)] })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect({ cupos: await cupos(), auditoria: await auditoria() }).toEqual(antes);
    expect(await ajeno.testigo.promoCartaCupo.count({ where: { promoCartaId: ajeno.promo.id } })).toBe(2);
  });

  it("CONCURRENCIA: dos guardados iguales a la vez dejan una sola lista y sus platos sin duplicar (varias veces)", async () => {
    for (let i = 0; i < 6; i++) {
      const nombre = `Sección ${i}`;
      const seccion = (await prisma.seccionCarta.create({ data: { nombre } })).id;
      const pedido = () => deSeccion(seccion, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.guisoId)] });
      const resultados = await Promise.all([pedido(), pedido()]);
      expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
      const listas = (await cupos()).filter((c) => c.tipo === "LISTA" && c.nombre === nombre);
      expect(listas).toHaveLength(1);
      expect(await activas(listas[0]!.id)).toEqual([e.sopaId, e.guisoId].sort());
      expect(await prisma.entradaDeCupo.count({ where: { cupoId: listas[0]!.id } })).toBe(2);
    }
  }, 60_000);

  it("CONCURRENCIA: «Toda» y «Solo estos» de la misma sección a la vez dejan UN estado válido (nunca las dos activas ni platos a medias)", async () => {
    for (let i = 0; i < 6; i++) {
      const nombre = `Parte ${i}`;
      const seccion = (await prisma.seccionCarta.create({ data: { nombre } })).id;
      const resultados = await Promise.all([deSeccion(seccion, "TODA"), deSeccion(seccion, "SOLO_ESTOS", { entradas: [plato(e.sopaId), plato(e.guisoId)] })]);
      expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
      const { entera, lista } = await delLugar(seccion, nombre);
      expect([entera?.activo ?? false, lista?.activo ?? false].filter(Boolean)).toHaveLength(1);
      if (lista?.activo) expect(await activas(lista.id)).toEqual([e.sopaId, e.guisoId].sort());
    }
  }, 60_000);
});
