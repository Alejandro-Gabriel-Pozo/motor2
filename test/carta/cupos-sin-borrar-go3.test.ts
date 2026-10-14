import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardarCuposPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta";
import { guardComandoGuardarCuposPromoCarta } from "../../src/core/features/carta/promos.guard";
import { diferenciaDeCupos } from "../../src/core/carta/public";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa, sembrarBase } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";

/**
 * GO-3b (ADR-032, paso D3): guardar los cupos de una promo YA NO BORRA. Cada cupo tiene su clave natural (la sección en un SECCION; el nombre sin mayúsculas en un LISTA o DEL_DIA) y guardar es
 * llevar las filas al estado pedido: lo que sigue se cambia en el lugar, lo que vuelve se reactiva (la MISMA fila), lo que no vino se da de baja (`activo = false`) y lo nuevo se crea. Las
 * entradas de una lista siguen colgando de su cupo aunque se dé de baja. La auditoría de los cupos de sección no cambia (`cupos-promo-auditados.test.ts`, mismos `entidadId`).
 *
 * Mutaciones demostradas (rojo y revertidas): borrar los cupos que no vienen en vez de darlos de baja (rojo: «da de baja sin borrar» y «la misma fila vuelve»); no leer los dados de baja
 * (rojo: «la misma fila vuelve», «otro tipo» y la concurrencia, por el único del nombre). Sacar `tambienChoqueDeUnico` NO la pone en rojo (verificado dos veces): bajo SERIALIZABLE Postgres
 * informa el choque del mismo cupo nuevo como 40001, que ya se reintenta; queda encendido como defensa por si llega como 23505.
 */
const ITERACIONES = 10;

describe("los cupos de una promo se guardan sin borrar (GO-3b, D3)", () => {
  let actor: ReturnType<typeof actorDePrueba> & { empresaZonaHoraria: string };
  let promoCartaId: string;
  let entradasId: string;
  let postresId: string;
  let adminId: string;
  let milanesaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    adminId = admin.id;
    actor = { ...actorDePrueba(admin.id, base.sucursal.id), empresaZonaHoraria: "America/Argentina/Buenos_Aires" };
    entradasId = (await prisma.seccionCarta.create({ data: { nombre: "Entradas" } })).id;
    postresId = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
    const menu = (await prisma.seccionCarta.create({ data: { nombre: "Menús" } })).id;
    promoCartaId = (await prisma.promoCarta.create({ data: { seccionCartaId: menu, titulo: "Menú del día", precio: 9500 } })).id;
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    milanesaId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidad.id, precioVenta: 8000 } })).id;
  });

  const guardar = (cupos: unknown[]) => guardarCuposPromoCartaCasoDeUso(actor, { promoCartaId, cupos: guardComandoGuardarCuposPromoCarta({ cupos }) });
  const cuposDeLaPromo = async () =>
    (await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId }, orderBy: [{ tipo: "asc" }, { nombre: "asc" }, { seccionCartaId: "asc" }] })).map((c) => ({
      tipo: c.tipo,
      seccionCartaId: c.seccionCartaId,
      nombre: c.nombre,
      activo: c.activo,
      cantidadMinima: c.cantidadMinima,
      cantidadMaxima: c.cantidadMaxima,
    }));
  const auditoria = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCartaCupo" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => ({
      entidadId: f.entidadId,
      campo: f.campo,
      valorAnterior: f.valorAnterior,
      valorNuevo: f.valorNuevo,
      actorId: f.actorId,
      descripcion: f.descripcion,
    }));

  const tresLugares = () => [
    { seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 1 },
    { tipo: "LISTA", nombre: "Postre", cantidadMinima: 1, cantidadMaxima: 1 },
    { tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1 },
  ];

  it("crea los tres tipos de lugar; un SECCION sin tipo es el de siempre", async () => {
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    expect(await cuposDeLaPromo()).toEqual([
      { tipo: "DEL_DIA", seccionCartaId: null, nombre: "Plato del día", activo: true, cantidadMinima: 1, cantidadMaxima: 1 },
      { tipo: "LISTA", seccionCartaId: null, nombre: "Postre", activo: true, cantidadMinima: 1, cantidadMaxima: 1 },
      { tipo: "SECCION", seccionCartaId: entradasId, nombre: null, activo: true, cantidadMinima: 1, cantidadMaxima: 1 },
    ]);
    const lista = await prismaAdmin.promoCartaCupo.findFirstOrThrow({ where: { promoCartaId, tipo: "LISTA" } });
    const filas = await auditoria();
    expect(filas.filter((f) => f.entidadId === `${promoCartaId}:${lista.id}`).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["cantidadMinima", null, "1"],
      ["cantidadMaxima", null, "1"],
    ]);
    expect(filas.find((f) => f.entidadId === `${promoCartaId}:${lista.id}`)?.descripcion).toContain("«Postre» (lista propia)");
    expect(filas.filter((f) => f.entidadId === `${promoCartaId}:${entradasId}`)).toHaveLength(2);
  });

  it("lo que no vino se DA DE BAJA sin borrar (con sus entradas colgando): nuevo null en la auditoría", async () => {
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    const lista = await prismaAdmin.promoCartaCupo.findFirstOrThrow({ where: { promoCartaId, tipo: "LISTA" } });
    await prisma.entradaDeCupo.create({ data: { cupoId: lista.id, productoId: milanesaId } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });

    expect(await guardar([{ seccionCartaId: entradasId, cantidadMinima: 1, cantidadMaxima: 1 }])).toMatchObject({ ok: true });
    expect((await cuposDeLaPromo()).map((c) => [c.tipo, c.activo])).toEqual([["DEL_DIA", false], ["LISTA", false], ["SECCION", true]]);
    expect(await prisma.entradaDeCupo.count({ where: { cupoId: lista.id } })).toBe(1);
    expect((await auditoria()).filter((f) => f.entidadId === `${promoCartaId}:${lista.id}`).map((f) => [f.campo, f.valorAnterior, f.valorNuevo, f.actorId])).toEqual([
      ["cantidadMinima", "1", null, adminId],
      ["cantidadMaxima", "1", null, adminId],
    ]);
  });

  it("volver a pedir un lugar dado de baja (aunque cambie mayúsculas) reactiva LA MISMA fila: anterior null", async () => {
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    const lista = await prismaAdmin.promoCartaCupo.findFirstOrThrow({ where: { promoCartaId, tipo: "LISTA" } });
    expect(await guardar([])).toMatchObject({ ok: true });
    expect((await cuposDeLaPromo()).every((c) => !c.activo)).toBe(true);
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });

    expect(await guardar([{ tipo: "LISTA", nombre: "  postre ", cantidadMinima: 0, cantidadMaxima: 2 }])).toMatchObject({ ok: true });
    const despues = await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId, tipo: "LISTA" } });
    expect(despues.map((c) => [c.id, c.nombre, c.activo, c.cantidadMaxima])).toEqual([[lista.id, "postre", true, 2]]);
    expect((await auditoria()).map((f) => [f.entidadId, f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      [`${promoCartaId}:${lista.id}`, "cantidadMinima", null, "0"],
      [`${promoCartaId}:${lista.id}`, "cantidadMaxima", null, "2"],
    ]);
  });

  it("un nombre ocupado por un lugar de OTRO tipo (aunque esté dado de baja) se rechaza sin escribir nada", async () => {
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    expect(await guardar([])).toMatchObject({ ok: true });
    const antes = await cuposDeLaPromo();
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
    expect(await guardar([{ tipo: "DEL_DIA", nombre: "Postre", cantidadMinima: 1, cantidadMaxima: 1 }])).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    expect(await cuposDeLaPromo()).toEqual(antes);
    expect(await auditoria()).toEqual([]);
  });

  it("idempotencia por estado: el mismo pedido dos veces no escribe ni audita la segunda", async () => {
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
    const antes = await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId }, orderBy: { id: "asc" } });
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
    expect(await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId }, orderBy: { id: "asc" } })).toEqual(antes);
    expect(await auditoria()).toEqual([]);
  });

  it("el piso cuenta los lugares de todos los tipos (un componente fijo cuenta como su máximo)", async () => {
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { precio: 0.02 } });
    expect(await guardar(tresLugares())).toMatchObject({ ok: false, codigo: "BAJO_EL_PISO" });
    expect(await cuposDeLaPromo()).toEqual([]);
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { precio: 0.03 } });
    expect(await guardar(tresLugares())).toMatchObject({ ok: true });
  });

  it("concurrencia real: dos guardados distintos a la vez nunca duplican un lugar y la cadena de la auditoría queda coherente (loop de 10)", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCartaCupo" } });
      const nombre = `Postre ${i}`;
      // Los dos crean el MISMO lugar nuevo (`Postre i`) con otro máximo, y uno además cambia la sección: los dos tienen que terminar bien (uno después del otro).
      const a = [{ seccionCartaId: entradasId, cantidadMaxima: 1 }, { tipo: "LISTA", nombre, cantidadMinima: 1, cantidadMaxima: 1 }];
      const b = [{ seccionCartaId: postresId, cantidadMaxima: 2 }, { tipo: "LISTA", nombre, cantidadMinima: 1, cantidadMaxima: 3 }];
      const resultados = await Promise.allSettled([guardar(a), guardar(b)]);
      expect(resultados.map((r) => r.status), `iteración ${i}`).toEqual(["fulfilled", "fulfilled"]);
      expect(resultados.map((r) => (r.status === "fulfilled" ? r.value.ok : false)), `iteración ${i}`).toEqual([true, true]);
      const lista = await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId, tipo: "LISTA", nombre: { equals: nombre, mode: "insensitive" } } });
      expect(lista, `iteración ${i}: el lugar nuevo quedó una sola vez`).toHaveLength(1);
      // El estado final es EXACTAMENTE uno de los dos pedidos (el último que confirmó), nunca una mezcla.
      const activos = (await cuposDeLaPromo()).filter((c) => c.activo).map((c) => `${c.tipo}:${c.seccionCartaId ?? c.nombre}:${c.cantidadMaxima}`);
      const finalA = [`LISTA:${nombre}:1`, `SECCION:${entradasId}:1`];
      const finalB = [`LISTA:${nombre}:3`, `SECCION:${postresId}:2`];
      expect([JSON.stringify(finalA), JSON.stringify(finalB)], `iteración ${i}: ${activos.join(", ")}`).toContain(JSON.stringify(activos));
      // La cadena de la auditoría del lugar nuevo: el «antes» de cada fila es el «después» de la anterior (nadie pisó al otro en silencio).
      const maximos = (await auditoria()).filter((f) => f.entidadId === `${promoCartaId}:${lista[0]!.id}` && f.campo === "cantidadMaxima");
      expect(maximos[0]!.valorAnterior, `iteración ${i}`).toBeNull();
      for (let k = 1; k < maximos.length; k++) expect(maximos[k]!.valorAnterior, `iteración ${i}`).toBe(maximos[k - 1]!.valorNuevo);
      expect(maximos.at(-1)!.valorNuevo).toBe(String(lista[0]!.cantidadMaxima));
      // Limpieza para la vuelta siguiente: la promo vuelve a informativa (los lugares quedan dados de baja; cada vuelta usa otro nombre).
      expect(await guardar([])).toMatchObject({ ok: true });
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó SERIALIZABLE ni el reintento").toBeGreaterThan(3 * ITERACIONES);
    intentos.mockRestore();
  });
});

describe("la diferencia de cupos (puro, GO-3b D3)", () => {
  const existente = (id: string, extra: Record<string, unknown>) => ({ id, tipo: "LISTA" as const, seccionCartaId: null, nombre: "Postre", cantidadMinima: 1, cantidadMaxima: 1, orden: 0, activo: true, ...extra });

  it("lo que sigue igual no se escribe; lo que cambia, vuelve, falta o es nuevo, sí", () => {
    const r = diferenciaDeCupos(
      [existente("a", {}), existente("b", { nombre: "Bebida", activo: false }), existente("c", { tipo: "SECCION", seccionCartaId: "s1", nombre: null })],
      [
        { tipo: "LISTA", seccionCartaId: null, nombre: "postre", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
        { tipo: "LISTA", seccionCartaId: null, nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
        { tipo: "DEL_DIA", seccionCartaId: null, nombre: "Plato", cantidadMinima: 1, cantidadMaxima: 1, orden: 2 },
      ],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diferencia.crear.map((c) => c.nombre)).toEqual(["Plato"]);
    // «postre» cambia solo de mayúsculas (se cambia el nombre en el lugar); «Bebida» vuelve de la baja.
    expect(r.diferencia.cambiar.map((c) => [c.estaba.id, c.queda.nombre])).toEqual([["a", "postre"], ["b", "Bebida"]]);
    expect(r.diferencia.darDeBaja.map((c) => c.id)).toEqual(["c"]);
  });

  it("idéntico a lo que hay: sin escrituras", () => {
    const r = diferenciaDeCupos([existente("a", {})], [{ tipo: "LISTA", seccionCartaId: null, nombre: "Postre", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 }]);
    expect(r).toEqual({ ok: true, diferencia: { crear: [], cambiar: [], darDeBaja: [] } });
  });
});

describe("el guard de los cupos con tipo (GO-3b D3)", () => {
  const g = (cupos: unknown[]) => guardComandoGuardarCuposPromoCarta({ cupos });
  it("SECCION por defecto (lo de siempre), y los rechazos de forma de los lugares nuevos", () => {
    expect(g([{ seccionCartaId: "s1", cantidadMaxima: 2 }])).toEqual({ ok: true, valor: [{ tipo: "SECCION", seccionCartaId: "s1", nombre: null, cantidadMinima: 0, cantidadMaxima: 2, orden: 0 }] });
    expect(g([{ tipo: "LISTA", nombre: " Entrada ", cantidadMaxima: 1 }])).toEqual({ ok: true, valor: [{ tipo: "LISTA", seccionCartaId: null, nombre: "Entrada", cantidadMinima: 0, cantidadMaxima: 1, orden: 0 }] });
    expect(g([{ tipo: "COMBO", nombre: "x", cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ tipo: "LISTA", cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ tipo: "LISTA", nombre: "   ", cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ tipo: "LISTA", nombre: "x".repeat(81), cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ tipo: "LISTA", nombre: "Postre", cantidadMaxima: 1 }, { tipo: "DEL_DIA", nombre: "POSTRE", cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ tipo: "LISTA", nombre: "Postre", seccionCartaId: "s1", cantidadMaxima: 1 }]).ok).toBe(false);
    expect(g([{ seccionCartaId: "s1", nombre: "Postre", cantidadMaxima: 1 }]).ok).toBe(false);
  });
});
