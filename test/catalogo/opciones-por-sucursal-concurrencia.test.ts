import { beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { apagarOpcionEnSucursalCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/apagar-opcion-en-sucursal";
import { fijarPrecioLocalDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-precio-local-de-opcion";

/**
 * GO-2a, paso 10: CONCURRENCIA REAL de lo que decide cada sucursal (Postgres real, como `motor2_app` con el alcance de la sucursal activa), en loop y con la guarda contra el falso verde.
 *  - Dos apagados a la vez: UNA fila y una sola auditoría (el segundo ve que ya está apagada).
 *  - Apagar y prender a la vez: el estado final es uno de los dos y la cadena de auditoría es coherente (el «antes» de cada fila es el «después» de la anterior; la última, el estado final).
 *  - Dos precios distintos con el MISMO precio esperado: gana uno, el otro `PRECIO_DESACTUALIZADO`; repetir no agrega nada.
 */
const ITERACIONES = 10;

describe("opciones de venta en la sucursal — concurrencia real (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => ({ ...actorDePrueba(e.usuarioId, e.sucursalA), sucursalNombre: "Central" });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: { in: [e.chicoId, e.medianoId, e.grandeId] } }, data: { precioAbsoluto: "1500.00" } });
  });

  it("dos apagados a la vez de la misma opción: una fila, las dos terminan bien y una sola auditoría", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    const opciones = [e.chicoId, e.medianoId, e.grandeId, e.vacaId, e.almendrasId, e.azucarId, e.shotId];
    for (let i = 0; i < opciones.length; i++) {
      const opcionId = opciones[i]!;
      const [a, b] = await Promise.all([apagarOpcionEnSucursalCasoDeUso(actor(), { opcionId, apagada: true }), apagarOpcionEnSucursalCasoDeUso(actor(), { opcionId, apagada: true })]);
      expect(a.ok && b.ok, `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toBe(true);
      expect([a, b].filter((r) => r.ok && r.datos.huboCambio)).toHaveLength(1);
      expect(await prisma.opcionApagadaEnSucursal.count({ where: { opcionId } })).toBe(1);
      expect(await prisma.registroAuditoria.count({ where: { entidad: "OpcionApagadaEnSucursal", entidadId: `${e.sucursalA}:${opcionId}` } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron los dos apagados: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * opciones.length);
    intentos.mockRestore();
  });

  it("apagar y prender a la vez: el estado final es uno de los dos y la cadena de auditoría es coherente", async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      await Promise.all([apagarOpcionEnSucursalCasoDeUso(actor(), { opcionId: e.almendrasId, apagada: true }), apagarOpcionEnSucursalCasoDeUso(actor(), { opcionId: e.almendrasId, apagada: false })]);
      const final = (await prisma.opcionApagadaEnSucursal.findUnique({ where: { sucursalId_opcionId: { sucursalId: e.sucursalA, opcionId: e.almendrasId } } }))?.apagada ?? false;
      const cadena = await prisma.registroAuditoria.findMany({ where: { entidad: "OpcionApagadaEnSucursal" }, orderBy: { creadoEn: "asc" }, select: { valorAnterior: true, valorNuevo: true } });
      let estado = "false";
      for (const [k, fila] of cadena.entries()) {
        expect(fila.valorAnterior, `iteración ${i}, fila ${k}: el «antes» no es el «después» de la anterior`).toBe(estado);
        estado = fila.valorNuevo!;
      }
      expect(estado, `iteración ${i}`).toBe(String(final));
    }
  });

  it("dos precios distintos con el mismo precio esperado: uno gana, el otro PRECIO_DESACTUALIZADO; repetir el ganador no agrega nada", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    let esperado: { precio: number; habilitado: boolean } | null = null;
    for (let i = 0; i < ITERACIONES; i++) {
      const pedido = (precio: number) => fijarPrecioLocalDeOpcionCasoDeUso(actor(), { productoId: e.cafeId, opcionId: e.grandeId, esperado, precio });
      const [a, b] = await Promise.all([pedido(2000 + i), pedido(3000 + i)]);
      expect([a, b].filter((r) => r.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["PRECIO_DESACTUALIZADO"]);
      const ganador = a.ok ? 2000 + i : 3000 + i;
      const fila = await prisma.precioLocalDeOpcion.findUniqueOrThrow({ where: { sucursalId_productoId_opcionId: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId } } });
      expect(Number(fila.precio)).toBe(ganador);
      const auditoria = await prisma.registroAuditoria.count({ where: { entidad: "PrecioLocalDeOpcion" } });
      expect(await fijarPrecioLocalDeOpcionCasoDeUso(actor(), { productoId: e.cafeId, opcionId: e.grandeId, esperado, precio: ganador })).toMatchObject({ ok: true, datos: { huboCambio: false } });
      expect(await prisma.registroAuditoria.count({ where: { entidad: "PrecioLocalDeOpcion" } })).toBe(auditoria);
      esperado = { precio: ganador, habilitado: true };
    }
    expect(await prisma.precioLocalDeOpcion.count()).toBe(1);
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración se cruzaron los dos precios: el test no ejercitó SERIALIZABLE").toBeGreaterThan(3 * ITERACIONES);
    intentos.mockRestore();
  });
});
