import { beforeEach, describe, expect, it, vi } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import type { ComandoCrearGrupoEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { crearGrupoEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-en-el-producto";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";

/**
 * Fase 6, paso 6.14c: CONCURRENCIA REAL del comando compuesto «crear un grupo sin salir del producto» (Promise.allSettled contra Postgres, como `motor2_app`, sin mocks de base). En loop porque el cruce depende del
 * timing, y con una guarda contra el falso verde: si en ninguna iteración hubo un reintento (más de una transacción por llamada), el test no ejercitó el conflicto.
 *  - Dos envíos IDÉNTICOS a la vez (el doble clic que Next no serializa, dos pestañas): los dos terminan bien, queda UN grupo con sus N opciones y UNA admisión, y las auditorías son las de UNA sola alta.
 *  - El mismo nombre con OTRO contenido a la vez: uno termina bien y el otro recibe NOMBRE_REPETIDO sin dejar NINGÚN rastro (ni opciones, ni versiones, ni auditoría de la perdedora).
 *  - El mismo grupo, a la vez, en DOS productos distintos: uno lo crea y el otro lo adopta; un solo grupo, dos admisiones.
 *
 *  - La fila del producto se toma PRIMERO (`FOR UPDATE`): con la fila en manos de otra transacción el comando espera.
 *
 * Mutaciones demostradas: sacar la rama «idéntico → ya existía» del alta del grupo deja en rojo el primero y el tercero (la perdedora recibe NOMBRE_REPETIDO en vez de adoptar el grupo del ganador); sacar
 * la toma de la fila del producto deja en rojo el cuarto (los tres anteriores quedan verdes: dos altas iguales las ordena el único del grupo, no la fila del producto), y moverla después del alta del grupo también.
 */
const ITERACIONES = 10;

describe("crear un grupo sin salir del producto — concurrencia real (6.14c)", () => {
  let e: EscenarioDeOpciones;
  let milanesaId: string;
  let hamburguesaId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const crear = (comando: ComandoCrearGrupoEnElProducto) => crearGrupoEnElProductoCasoDeUso(actor(), comando, azarDelProceso);
  const comando = (nombre: string, productoId = milanesaId, opciones = [{ nombre: "Simple", importe: 8000 }, { nombre: "Doble", importe: 11000 }, { nombre: "Triple", importe: 14000 }]): ComandoCrearGrupoEnElProducto => ({
    productoId,
    nombre,
    respuesta: "PRECIO_FINAL",
    prefijoEnCarta: null,
    opciones,
  });
  const producto = async (codigo: string, nombre: string) =>
    (await prisma.producto.create({ data: { codigo, nombre, tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } })).id;
  /** Lo que quedó de UN grupo por nombre: el grupo, sus opciones y versiones, sus admisiones y las auditorías de su alta. */
  const rastros = async (nombre: string) => {
    const grupo = await prisma.grupoDeOpciones.findMany({ where: { nombre: { equals: nombre, mode: "insensitive" } }, select: { id: true } });
    const grupoIds = grupo.map((g) => g.id);
    const opciones = await prisma.opcionDeGrupo.findMany({ where: { grupoId: { in: grupoIds } }, select: { id: true, nombre: true } });
    return {
      grupos: grupo.length,
      opciones: opciones.length,
      versiones: await prisma.versionDeOpcion.count({ where: { opcionId: { in: opciones.map((o) => o.id) } } }),
      admisionesDeGrupo: await prisma.productoAdmiteGrupo.count({ where: { grupoId: { in: grupoIds } } }),
      admisionesDeOpcion: await prisma.productoAdmiteOpcion.count({ where: { opcionId: { in: opciones.map((o) => o.id) } } }),
      altasDelGrupo: await prisma.registroAuditoria.count({ where: { entidad: "GrupoDeOpciones", entidadId: { in: grupoIds }, campo: "nombre" } }),
      altasDeOpciones: await prisma.registroAuditoria.count({ where: { entidad: "OpcionDeGrupo", entidadId: { in: opciones.map((o) => o.id) }, campo: "nombre" } }),
      nombresDeOpciones: opciones.map((o) => o.nombre).sort(),
    };
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    milanesaId = await producto("PV_MILA", "Milanesa");
    hamburguesaId = await producto("PV_HAMB", "Hamburguesa");
  });

  it("dos envíos idénticos a la vez: los dos terminan bien, 1 grupo, N opciones, 1 admisión y las auditorías de una sola alta", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Presentación ${i}`;
      const resultados = await Promise.allSettled([crear(comando(nombre)), crear(comando(nombre))]);
      expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `iteración ${i}: ${JSON.stringify(resultados)}`).toBe(true);
      const valores = resultados.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof crear>>>).value);
      const ids = valores.map((v) => (v.ok ? v.datos.grupoId : ""));
      expect(ids[0], `iteración ${i}`).toBe(ids[1]);
      // Uno creó y el otro vio lo del ganador: nunca los dos «creó».
      expect(valores.filter((v) => v.ok && !v.datos.yaExistia).length, `iteración ${i}`).toBe(1);
      expect(await rastros(nombre), `iteración ${i}`).toEqual({
        grupos: 1,
        opciones: 3,
        versiones: 3,
        admisionesDeGrupo: 1,
        admisionesDeOpcion: 3,
        altasDelGrupo: 1,
        altasDeOpciones: 3,
        nombresDeOpciones: ["Doble", "Simple", "Triple"],
      });
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron los dos envíos: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("el mismo nombre con otro contenido a la vez: uno termina bien y el otro recibe NOMBRE_REPETIDO, sin ningún rastro de la perdedora", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    const otras = [{ nombre: "Chica", importe: 5000 }, { nombre: "Grande", importe: 9000 }];
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Porción ${i}`;
      const resultados = await Promise.allSettled([crear(comando(nombre)), crear(comando(nombre, hamburguesaId, otras))]);
      expect(resultados.every((s) => s.status === "fulfilled"), `iteración ${i}: ${JSON.stringify(resultados)}`).toBe(true);
      const valores = resultados.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof crear>>>).value);
      expect(valores.filter((v) => v.ok), `iteración ${i}: ${valores.map((v) => v.mensaje).join(" | ")}`).toHaveLength(1);
      expect(valores.filter((v) => !v.ok).map((v) => (v.ok ? "" : v.codigo)), `iteración ${i}`).toEqual(["NOMBRE_REPETIDO"]);

      // Lo que quedó es EXACTAMENTE el alta de la ganadora (una mezcla de las dos sería un rastro de la perdedora).
      const ganoLaPrimera = valores[0]!.ok;
      const esperadas = ganoLaPrimera ? ["Doble", "Simple", "Triple"] : ["Chica", "Grande"];
      expect(await rastros(nombre), `iteración ${i}`).toEqual({
        grupos: 1,
        opciones: esperadas.length,
        versiones: esperadas.length,
        admisionesDeGrupo: 1,
        admisionesDeOpcion: esperadas.length,
        altasDelGrupo: 1,
        altasDeOpciones: esperadas.length,
        nombresDeOpciones: esperadas,
      });
      // Y la admisión es del producto de la ganadora, no del otro.
      const grupo = await prisma.grupoDeOpciones.findFirstOrThrow({ where: { nombre }, select: { id: true } });
      expect((await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { grupoId: grupo.id } })).productoId, `iteración ${i}`).toBe(ganoLaPrimera ? milanesaId : hamburguesaId);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron las dos altas: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("el mismo grupo, a la vez, en dos productos distintos: uno lo crea y el otro lo adopta; un solo grupo y dos admisiones", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Tamaño ${i}`;
      const resultados = await Promise.allSettled([crear(comando(nombre, milanesaId)), crear(comando(nombre, hamburguesaId))]);
      expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `iteración ${i}: ${JSON.stringify(resultados)}`).toBe(true);
      const valores = resultados.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof crear>>>).value);
      expect(valores.filter((v) => v.ok && v.datos.yaExistia).length, `iteración ${i}`).toBe(1);
      expect(await rastros(nombre), `iteración ${i}`).toEqual({
        grupos: 1,
        opciones: 3,
        versiones: 3,
        admisionesDeGrupo: 2,
        admisionesDeOpcion: 6,
        altasDelGrupo: 1,
        altasDeOpciones: 3,
        nombresDeOpciones: ["Doble", "Simple", "Triple"],
      });
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron las dos altas: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("la fila del producto se toma PRIMERO (FOR UPDATE, como `actualizarProducto` y la admisión): con la fila en manos de otra transacción el comando espera, y termina bien cuando se libera", async () => {
    let terminado = false;
    let comandoEnCurso: ReturnType<typeof crear> | null = null;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Producto" WHERE id = ${milanesaId} FOR UPDATE`;
        comandoEnCurso = crear(comando("Con el producto tomado")).finally(() => {
          terminado = true;
        });
        await new Promise((resolver) => setTimeout(resolver, 1500));
        expect(terminado, "el comando no esperó la fila del producto").toBe(false);
        // «Primero» quiere decir ANTES de escribir nada: la transacción que espera la fila todavía no tiene número de transacción (una que ya insertó el grupo lo tendría). Si la toma de la fila
        // estuviera después del alta del grupo, el comando también esperaría (la admisión la vuelve a pedir) pero con el grupo y sus opciones ya escritos.
        const esperando = await prismaAdmin.$queryRaw<Array<{ escribio: boolean }>>`
          SELECT (backend_xid IS NOT NULL) AS escribio FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE%'`;
        expect(esperando, "tiene que haber UNA transacción esperando la fila").toHaveLength(1);
        expect(esperando[0]!.escribio, "el comando escribió algo antes de tomar la fila del producto").toBe(false);
      },
      { timeout: 20_000 }
    );
    expect(await comandoEnCurso!).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect((await rastros("Con el producto tomado")).grupos).toBe(1);
  });
});
