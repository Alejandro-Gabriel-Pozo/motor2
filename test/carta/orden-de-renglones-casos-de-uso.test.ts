import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Para forzar una falla A MITAD de camino (atomicidad): envuelve `fijarOrdenDeRenglon` con el original por defecto y deja que un test lo haga fallar en la N-ésima llamada.
vi.mock("../../src/server/persistencia/carta/orden-de-renglones", async (importar) => {
  const real = await importar<typeof import("../../src/server/persistencia/carta/orden-de-renglones")>();
  return { ...real, fijarOrdenDeRenglon: vi.fn(real.fijarOrdenDeRenglon) };
});

import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { fijarModoDeOrdenDeSeccionCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/fijar-modo-de-orden-de-seccion";
import { reordenarRenglonesDeSeccionCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/reordenar-renglones-de-seccion";
import { fijarModoDeOrdenDeSeccion, reordenarRenglonesDeSeccion } from "../../src/server/actions/carta/contenido-producto";
import { consultarOrdenDeSeccion } from "../../src/server/lecturas/carta/orden-de-renglones";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { fijarOrdenDeRenglon } from "../../src/server/persistencia/carta/orden-de-renglones";

/**
 * Etapa O1 (docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md, nivel 10): «reordenar los renglones de una sección» y «fijar el modo de orden» contra Postgres real como `motor2_app` con el alcance de la sucursal
 * activa. Concurrencia (gana uno), idempotencia (escribe y audita una sola vez), atomicidad (una falla a mitad no deja nada), aislamiento (otra sucursal y otra empresa responden «no encontrado»), permisos (el operador no; el administrador sí)
 * y «sin fila = como hoy» (la carta pública sale igual con la tabla vacía). Lo oculto y lo apagado no entran ni cuentan.
 */
const ITERACIONES = 10;

describe("orden de los renglones de una sección de carta (etapa O1)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let operadorId: string;
  let unidadId: string;
  let bebidas: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `PV_${nombre.replace(/\W/g, "_").toUpperCase()}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalA)).id;
  const producto = async (nombre: string, orden: number, extra: { visible?: boolean; seccion?: string; sucursal?: string } = {}) => {
    const id = await pv(nombre);
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: extra.sucursal ?? sucursalA, productoId: id, visibleEnCarta: extra.visible ?? true, seccionCartaId: extra.seccion ?? bebidas, orden } });
    return id;
  };
  /** Un ítem agrupado, con UNA opción de venta disponible (sin opciones disponibles la carta pública no lo muestra). */
  const agrupado = async (nombre: string, orden: number, extra: { activo?: boolean; sucursal?: string } = {}) => {
    const sucursalId = extra.sucursal ?? sucursalA;
    const id = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre, seccionCartaId: bebidas, orden, activo: extra.activo ?? true } })).id;
    const opcion = await sembrarProductoDisponible({ codigo: `OP_${nombre.replace(/\W/g, "_").toUpperCase()}_${sucursalId.slice(-4)}`, nombre: `${nombre} opción`, tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalId);
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: id, productoId: opcion.id } });
    return id;
  };
  /** La sección en el orden «a mano» en que se edita, con su `orden`. */
  const enOrden = async () => (await consultarOrdenDeSeccion(actor().db, { sucursalId: sucursalA, seccionCartaId: bebidas }))!.renglones.map((r) => `${r.nombre}:${r.orden}`);
  const auditoriasDeOrden = () => prisma.registroAuditoria.count({ where: { campo: "orden", entidad: { in: ["ContenidoCartaProducto", "ItemAgrupadoCarta"] } } });
  const auditoriasDeModo = () => prisma.registroAuditoria.count({ where: { entidad: "ModoDeOrdenDeSeccionCarta" } });
  const filasDeModo = () => prisma.modoDeOrdenDeSeccionCarta.findMany({ where: { seccionCartaId: bebidas }, orderBy: { sucursalId: "asc" } });
  /** Lo que mandaría la pantalla: los renglones en el orden pedido (por nombre), cada uno con el orden que se ve hoy. */
  const pedido = async (nombres: string[]) => {
    const vistos = (await consultarOrdenDeSeccion(actor().db, { sucursalId: sucursalA, seccionCartaId: bebidas }))!.renglones;
    return nombres.map((n) => {
      const r = vistos.find((x) => x.nombre === n)!;
      return { tipo: r.tipo, id: r.id, ordenVisto: r.orden };
    });
  };
  const fijar = (modo: "ALFABETICO" | "A_MANO", versionVista = 0, seccionCartaId = bebidas) =>
    fijarModoDeOrdenDeSeccionCasoDeUso(actor(), { seccionCartaId, modo, versionVista, modoId: crypto.randomUUID() });
  /** La carta pública de la sucursal A: los nombres de la sección «Bebidas», en el orden en que salen. */
  const cartaPublica = async () => {
    const carta = await resolverMenuCarta(sucursalA, actor().db, AHORA_DE_LA_CORRIDA);
    return (carta?.secciones.find((s) => s.id === bebidas)?.items ?? []).map((i) => i.nombre);
  };

  beforeEach(async () => {
    vi.mocked(fijarOrdenDeRenglon).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: base.operador.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    bebidas = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } })).id;
  });

  describe("reordenar los renglones", () => {
    it("deja productos e ítems agrupados en el orden pedido (0, 1, 2…, una sola escala), con una auditoría por renglón que cambió de lugar; repetirlo no escribe ni audita", async () => {
      await producto("Soda", 5);
      await producto("Agua", 1);
      await agrupado("Cervezas", 3);
      await producto("Jugo", 0);
      expect(await enOrden()).toEqual(["Jugo:0", "Agua:1", "Cervezas:3", "Soda:5"]);

      const orden = await pedido(["Soda", "Cervezas", "Jugo", "Agua"]);
      const r = await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden });
      expect(r).toMatchObject({ ok: true, datos: { cambiados: 4 } });
      expect(await enOrden()).toEqual(["Soda:0", "Cervezas:1", "Jugo:2", "Agua:3"]);
      expect(await auditoriasDeOrden()).toBe(4);
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "ItemAgrupadoCarta", descripcion: { contains: "Cervezas" } } })).toMatchObject({
        campo: "orden",
        valorAnterior: "3",
        valorNuevo: "1",
        actorId: usuarioId,
        sucursalId: sucursalA,
      });
      // El mismo pedido otra vez (doble clic o reintento): éxito sin escribir ni auditar.
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden })).toMatchObject({ ok: true, datos: { cambiados: 0 } });
      expect(await auditoriasDeOrden()).toBe(4);
    });

    it("lo OCULTO y lo APAGADO no entran a la lista ni se tocan; pedirlos es «cambió» (ya no son de la sección), y un id que no existe es «no encontrado»", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      const oculto = await producto("Vino", 7, { visible: false });
      const apagado = await agrupado("Viejo", 9, { activo: false });
      expect(await enOrden()).toEqual(["Agua:0", "Soda:1"]);

      const orden = await pedido(["Soda", "Agua"]);
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden })).toMatchObject({ ok: true, datos: { cambiados: 2 } });
      expect((await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: oculto } } })).orden).toBe(7);
      expect((await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: apagado } })).orden).toBe(9);

      const conOculto = [...(await pedido(["Soda", "Agua"])), { tipo: "PRODUCTO" as const, id: oculto, ordenVisto: 7 }];
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: conOculto })).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
      const conFantasma = [...(await pedido(["Soda", "Agua"])), { tipo: "PRODUCTO" as const, id: "no-existe", ordenVisto: 0 }];
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: conFantasma })).toMatchObject({ ok: false, codigo: "RENGLON_NO_ENCONTRADO" });
    });

    it("TODO O NADA contra lo que vio la pantalla: si el orden de uno cambió, si falta uno o si alguien agregó otro, no se cambia ninguno", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      await producto("Jugo", 2);
      const orden = await pedido(["Jugo", "Soda", "Agua"]);
      await prisma.contenidoCartaProducto.updateMany({ where: { sucursalId: sucursalA, orden: 2 }, data: { orden: 9 } });
      const r = await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden });
      expect(r).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
      expect(r.mensaje).toMatch(/no se cambió ninguno\. Recargá la pantalla/);
      expect(await enOrden()).toEqual(["Agua:0", "Soda:1", "Jugo:9"]);

      // Falta uno (la lista no es la de la sección) y sobra uno agregado en el medio.
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: (await pedido(["Soda", "Agua"])) })).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
      const lista = await pedido(["Jugo", "Soda", "Agua"]);
      await producto("Flan", 4);
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: lista })).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
      expect(await auditoriasDeOrden()).toBe(0);
    });

    it("ATOMICIDAD: una falla forzada a MITAD de camino (la segunda escritura) no deja ningún cambio ni ninguna auditoría", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      await producto("Jugo", 2);
      const orden = await pedido(["Jugo", "Soda", "Agua"]);
      const original = vi.mocked(fijarOrdenDeRenglon).getMockImplementation()!;
      let llamadas = 0;
      vi.mocked(fijarOrdenDeRenglon).mockImplementation(async (tx, args) => {
        llamadas++;
        if (llamadas === 2) throw new Error("falla forzada a mitad de camino");
        return original(tx, args);
      });
      try {
        await expect(reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden })).rejects.toThrow("falla forzada");
      } finally {
        vi.mocked(fijarOrdenDeRenglon).mockImplementation(original);
      }
      expect(await enOrden()).toEqual(["Agua:0", "Soda:1", "Jugo:2"]);
      expect(await auditoriasDeOrden()).toBe(0);
      // Y el reintento sin falla sale bien.
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: orden })).toMatchObject({ ok: true, datos: { cambiados: 2 } });
    });

    it("AISLAMIENTO: un renglón de otra sucursal u otra empresa responde «no encontrado» (como si no existiera); una sección de otra empresa, también", async () => {
      await producto("Agua", 0);
      const deB = await producto("Vino", 0, { sucursal: sucursalB });
      const agrupadoDeB = await agrupado("Cervezas", 4, { sucursal: sucursalB });
      const base = await pedido(["Agua"]);
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: [...base, { tipo: "PRODUCTO", id: deB, ordenVisto: 0 }] })).toMatchObject({ ok: false, codigo: "RENGLON_NO_ENCONTRADO" });
      expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: [...base, { tipo: "ITEM_AGRUPADO", id: agrupadoDeB, ordenVisto: 4 }] })).toMatchObject({ ok: false, codigo: "RENGLON_NO_ENCONTRADO" });

      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const ajena = await prismaAdmin.seccionCarta.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena", orden: 0 } });
      try {
        expect(await reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: ajena.id, renglones: base })).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
        expect(await fijar("ALFABETICO", 0, ajena.id)).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
      } finally {
        await prismaAdmin.seccionCarta.delete({ where: { id: ajena.id } });
      }
      expect(await auditoriasDeOrden()).toBe(0);
      expect(await filasDeModo()).toEqual([]);
    });

    it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos órdenes distintos a la vez → gana uno, entero, y el otro ORDEN_DESACTUALIZADO; dos iguales → uno escribe y el otro es un éxito sin cambio`, async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      await agrupado("Cervezas", 2);
      await producto("Jugo", 3);
      for (let i = 0; i < ITERACIONES; i++) {
        const a = await pedido(["Jugo", "Cervezas", "Soda", "Agua"]);
        const b = await pedido(["Agua", "Jugo", "Soda", "Cervezas"]);
        const antes = await auditoriasDeOrden();
        const [x, y] = await Promise.allSettled([
          reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: a }),
          reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: b }),
        ]);
        const resumen = [x, y].map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : r.value.codigo) : `error:${String(r.reason)}`)).sort();
        expect(resumen, `vuelta ${i}`).toEqual(["ORDEN_DESACTUALIZADO", "ok"]);
        const gano = x.status === "fulfilled" && x.value.ok ? "a" : "b";
        expect(await enOrden(), `vuelta ${i}`).toEqual(gano === "a" ? ["Jugo:0", "Cervezas:1", "Soda:2", "Agua:3"] : ["Agua:0", "Jugo:1", "Soda:2", "Cervezas:3"]);
        const cambiados = [x, y].reduce((n, r) => n + (r.status === "fulfilled" && r.value.ok ? r.value.datos.cambiados : 0), 0);
        expect((await auditoriasDeOrden()) - antes, `vuelta ${i}: una auditoría por renglón que cambió, del ganador`).toBe(cambiados);

        const igual = await pedido(["Soda", "Agua", "Cervezas", "Jugo"]);
        const dos = await Promise.allSettled([
          reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: igual }),
          reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: bebidas, renglones: igual }),
        ]);
        const hechos = dos.map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.datos.cambiados : -1)).sort();
        expect(hechos[0], `vuelta ${i}: ${JSON.stringify(dos)}`).toBe(0);
        expect(hechos[1], `vuelta ${i}`).toBeGreaterThan(0);
        expect(await enOrden(), `vuelta ${i}`).toEqual(["Soda:0", "Agua:1", "Cervezas:2", "Jugo:3"]);
      }
    }, 120_000);
  });

  describe("fijar el modo de orden", () => {
    it("sin fila rige A_MANO: elegir A_MANO no escribe nada; elegir ALFABETICO crea la fila (versión 1) con su auditoría; repetirlo no cambia ni audita", async () => {
      await producto("Agua", 0);
      expect(await fijar("A_MANO")).toMatchObject({ ok: true, datos: { cambio: false } });
      expect(await filasDeModo()).toEqual([]);
      expect(await auditoriasDeModo()).toBe(0);

      expect(await fijar("ALFABETICO")).toMatchObject({ ok: true, datos: { cambio: true } });
      expect(await filasDeModo()).toMatchObject([{ sucursalId: sucursalA, modo: "ALFABETICO", version: 1, actualizadoPorId: usuarioId }]);
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "ModoDeOrdenDeSeccionCarta" } })).toMatchObject({
        entidadId: `${sucursalA}:${bebidas}`,
        campo: "modo",
        valorAnterior: "A_MANO",
        valorNuevo: "ALFABETICO",
        sucursalId: sucursalA,
      });
      expect(await fijar("ALFABETICO", 1)).toMatchObject({ ok: true, datos: { cambio: false } });
      expect(await fijar("ALFABETICO", 0)).toMatchObject({ ok: true, datos: { cambio: false } });
      expect(await auditoriasDeModo()).toBe(1);
    });

    it("el control de versión: con una versión vieja se rechaza todo (MODO_DESACTUALIZADO); con la vigente cambia y sube la versión; la fila se sobrescribe, nunca se agrega otra", async () => {
      expect(await fijar("ALFABETICO", 0)).toMatchObject({ ok: true, datos: { cambio: true } });
      expect(await fijar("A_MANO", 0)).toMatchObject({ ok: false, codigo: "MODO_DESACTUALIZADO" });
      expect((await filasDeModo())[0]).toMatchObject({ modo: "ALFABETICO", version: 1 });
      expect(await fijar("A_MANO", 1)).toMatchObject({ ok: true, datos: { cambio: true } });
      expect(await filasDeModo()).toMatchObject([{ modo: "A_MANO", version: 2 }]);
      expect(await auditoriasDeModo()).toBe(2);
    });

    it(`concurrencia real (${ITERACIONES} vueltas): dos «ALFABETICO» a la vez desde cero → UNA fila, un solo cambio y una sola auditoría; el otro ve «ya era ese»`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.modoDeOrdenDeSeccionCarta.deleteMany({});
        await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "ModoDeOrdenDeSeccionCarta" } });
        const dos = await Promise.allSettled([fijar("ALFABETICO"), fijar("ALFABETICO")]);
        const cambios = dos.map((r) => (r.status === "fulfilled" && r.value.ok ? String(r.value.datos.cambio) : `error:${JSON.stringify(r)}`)).sort();
        expect(cambios, `vuelta ${i}`).toEqual(["false", "true"]);
        expect(await filasDeModo(), `vuelta ${i}`).toHaveLength(1);
        expect(await auditoriasDeModo(), `vuelta ${i}`).toBe(1);
      }
    });

    it("AISLAMIENTO: el modo de la sucursal B no lo ve ni lo cambia la A (cada una tiene el suyo); la A no puede pisar el de B", async () => {
      await prisma.modoDeOrdenDeSeccionCarta.create({ data: { id: crypto.randomUUID(), sucursalId: sucursalB, seccionCartaId: bebidas, modo: "ALFABETICO", actualizadoPorId: usuarioId, actualizadoEn: new Date() } });
      const antes = await consultarOrdenDeSeccion(actor().db, { sucursalId: sucursalA, seccionCartaId: bebidas });
      expect(antes).toMatchObject({ modo: "A_MANO", version: 0 });
      expect(await fijar("ALFABETICO", 0)).toMatchObject({ ok: true, datos: { cambio: true } });
      const filas = await filasDeModo();
      expect(filas.map((f) => [f.sucursalId === sucursalA ? "A" : "B", f.modo, f.version]).sort()).toEqual([["A", "ALFABETICO", 1], ["B", "ALFABETICO", 1]]);
      expect(await fijar("A_MANO", 1)).toMatchObject({ ok: true, datos: { cambio: true } });
      expect((await filasDeModo()).find((f) => f.sucursalId === sucursalB)).toMatchObject({ modo: "ALFABETICO", version: 1 });
    });
  });

  describe("la carta pública", () => {
    it("SIN FILA sale exactamente como hoy (orden y después nombre); con ALFABETICO sale por nombre SIN tocar el orden guardado; volver a A_MANO la deja como estaba", async () => {
      await producto("Soda", 0);
      await producto("Agua", 1);
      await agrupado("Cervezas", 2);
      await producto("Jugo", 3);
      const comoHoy = ["Soda", "Agua", "Cervezas", "Jugo"];
      expect(await cartaPublica()).toEqual(comoHoy);
      expect(await filasDeModo()).toEqual([]);

      await fijar("ALFABETICO");
      expect(await cartaPublica()).toEqual(["Agua", "Cervezas", "Jugo", "Soda"]);
      expect(await enOrden()).toEqual(["Soda:0", "Agua:1", "Cervezas:2", "Jugo:3"]);

      await fijar("A_MANO", 1);
      expect(await cartaPublica()).toEqual(comoHoy);
    });

    it("el modo es de UNA sucursal: la carta de la otra no cambia", async () => {
      await producto("Soda", 0);
      await producto("Agua", 1);
      await fijar("ALFABETICO");
      expect(await cartaPublica()).toEqual(["Agua", "Soda"]);
      const otraDb = actorDePrueba(usuarioId, sucursalB).db;
      const cartaB = await resolverMenuCarta(sucursalB, otraDb, AHORA_DE_LA_CORRIDA);
      expect(cartaB?.secciones.flatMap((s) => s.items)).toEqual([]);
    });
  });

  describe("las Server Actions", () => {
    it("el operador no puede (no escribe nada); el administrador sí; un pedido sin forma se rechaza antes de tocar la base", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      const orden = await pedido(["Soda", "Agua"]);
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      expect((await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: orden })).ok).toBe(false);
      expect((await fijarModoDeOrdenDeSeccion({ seccionCartaId: bebidas, modo: "ALFABETICO", versionVista: 0 })).ok).toBe(false);
      expect(await auditoriasDeOrden()).toBe(0);
      expect(await filasDeModo()).toEqual([]);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect((await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: "Soda primero" })).ok).toBe(false);
      expect((await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: orden.map((x) => ({ ...x, ordenVisto: String(x.ordenVisto) })) })).ok).toBe(false);
      expect((await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: [...orden, orden[0]] })).ok).toBe(false);
      expect((await fijarModoDeOrdenDeSeccion({ seccionCartaId: bebidas, modo: "AL_AZAR", versionVista: 0 })).ok).toBe(false);
      expect(await enOrden()).toEqual(["Agua:0", "Soda:1"]);

      expect(await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: orden })).toMatchObject({ ok: true, mensaje: "Listo: los renglones quedaron en el orden nuevo." });
      expect(await enOrden()).toEqual(["Soda:0", "Agua:1"]);
      expect(await fijarModoDeOrdenDeSeccion({ seccionCartaId: bebidas, modo: "ALFABETICO", versionVista: 0 })).toMatchObject({ ok: true });
      expect(await filasDeModo()).toMatchObject([{ modo: "ALFABETICO", version: 1 }]);
    });

    it("el GERENTE de la empresa puede aunque su rol en la sucursal sea de operador (el gerente es administrador efectivo en todo su alcance); escribe y audita una vez", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: sucursalA, rolId: (await prisma.rol.findFirstOrThrow({ where: { id: (await prisma.membresia.findFirstOrThrow({ where: { usuarioId: operadorId } })).rolId } })).id });
      await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
      const orden = await pedido(["Soda", "Agua"]);
      await mockearUsuarioActual({ id: gerente.id, email: "gerente@test.com", nombre: null });
      expect(await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: orden })).toMatchObject({ ok: true });
      expect(await enOrden()).toEqual(["Soda:0", "Agua:1"]);
      expect(await fijarModoDeOrdenDeSeccion({ seccionCartaId: bebidas, modo: "ALFABETICO", versionVista: 0 })).toMatchObject({ ok: true });
      expect(await filasDeModo()).toMatchObject([{ modo: "ALFABETICO", version: 1 }]);
      expect(await auditoriasDeOrden()).toBe(2);
    });

    it("la sucursal sale del contexto del servidor, no del pedido: un `sucursalId` que mande el navegador se ignora", async () => {
      await producto("Agua", 0);
      await producto("Soda", 1);
      await producto("Vino", 0, { sucursal: sucursalB });
      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      const orden = await pedido(["Soda", "Agua"]);
      await reordenarRenglonesDeSeccion({ seccionCartaId: bebidas, renglones: orden, sucursalId: sucursalB } as never);
      expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: sucursalB, orden: 0 } })).toBe(1);
      expect(await enOrden()).toEqual(["Soda:0", "Agua:1"]);
    });
  });
});
