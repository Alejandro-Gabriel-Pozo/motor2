import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { ordenarSeccionesCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/ordenar-secciones-carta";
import { ordenarSeccionesCarta } from "../../src/server/actions/carta/secciones";

/**
 * CARTA-MANT F3 (fila O.487 de docs/pureza-integracion.md): «Ordenar» las secciones de la carta (de la EMPRESA) contra Postgres real como `motor2_app`: todas de una vez, todo o nada, contra el
 * orden que vio la pantalla, idempotente y con una auditoría por sección que cambia de lugar.
 */
const ITERACIONES = 10;

describe("«Ordenar» las secciones de la carta (CARTA-MANT F3)", () => {
  let sucursalA: string;
  let usuarioId: string;
  let operadorId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  /** Las secciones de la empresa en el orden en que salen (orden, nombre), con su orden. */
  const enOrden = async () => (await prisma.seccionCarta.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { nombre: true, orden: true } })).map((x) => `${x.nombre}:${x.orden}`);
  const auditorias = () => prisma.registroAuditoria.count({ where: { entidad: "SeccionCarta", campo: "orden" } });
  /** Lo que mandaría la pantalla: los ids en el orden pedido, cada uno con el orden que se ve hoy. */
  const pedido = async (nombres: string[]) => {
    const todas = await prisma.seccionCarta.findMany({ select: { id: true, nombre: true, orden: true } });
    return nombres.map((n) => {
      const x = todas.find((y) => y.nombre === n)!;
      return { seccionCartaId: x.id, ordenVisto: x.orden };
    });
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: base.operador.id })).id;
    // Como las deja el alta (DA5: orden = cuántas había), y una con un orden cargado a mano.
    for (const [nombre, orden] of [["Entradas", 0], ["Platos principales", 1], ["Bebidas", 2], ["Postres", 7]] as const) await prisma.seccionCarta.create({ data: { nombre, orden } });
  });

  it("deja todas en el orden pedido (posición 0, 1, 2…) con una auditoría por sección que cambió de lugar; repetirlo no escribe ni audita", async () => {
    const orden = await pedido(["Entradas", "Platos principales", "Postres", "Bebidas"]);
    const r = await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: orden });
    expect(r).toMatchObject({ ok: true, datos: { cambiadas: 2 } });
    expect(await enOrden()).toEqual(["Entradas:0", "Platos principales:1", "Postres:2", "Bebidas:3"]);
    expect(await auditorias()).toBe(2);
    expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "SeccionCarta", descripcion: { contains: "Postres" } } })).toMatchObject({
      valorAnterior: "7",
      valorNuevo: "2",
      actorId: usuarioId,
      sucursalId: null,
    });
    // El mismo pedido otra vez (doble clic, o el reintento de uno que ya se aplicó): éxito sin escribir.
    expect(await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: orden })).toMatchObject({ ok: true, datos: { cambiadas: 0 } });
    expect(await auditorias()).toBe(2);
  });

  it("«Deshacer»: el orden de antes, contra las posiciones nuevas, vuelve a dejarlas como estaban (con su propia auditoría)", async () => {
    await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: await pedido(["Postres", "Entradas", "Platos principales", "Bebidas"]) });
    expect(await enOrden()).toEqual(["Postres:0", "Entradas:1", "Platos principales:2", "Bebidas:3"]);
    expect(await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: await pedido(["Entradas", "Platos principales", "Bebidas", "Postres"]) })).toMatchObject({ ok: true, datos: { cambiadas: 4 } });
    expect(await enOrden()).toEqual(["Entradas:0", "Platos principales:1", "Bebidas:2", "Postres:3"]);
    expect(await auditorias()).toBe(8);
  });

  it("TODO O NADA contra lo que vio la pantalla: si el orden de una cambió, o alguien creó otra sección, no se cambia ninguna", async () => {
    const orden = await pedido(["Bebidas", "Entradas", "Platos principales", "Postres"]);
    await prisma.seccionCarta.updateMany({ where: { nombre: "Postres" }, data: { orden: 9 } });
    const r = await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: orden });
    expect(r).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
    expect(r.mensaje).toMatch(/no se cambió ninguna\. Recargá la pantalla/);
    expect(await enOrden()).toEqual(["Entradas:0", "Platos principales:1", "Bebidas:2", "Postres:9"]);

    const orden2 = await pedido(["Bebidas", "Entradas", "Platos principales", "Postres"]);
    await prisma.seccionCarta.create({ data: { nombre: "Cafetería", orden: 4 } });
    expect(await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: orden2 })).toMatchObject({ ok: false, codigo: "ORDEN_DESACTUALIZADO" });
    expect(await auditorias()).toBe(0);
  });

  it("una sección que no es de la empresa (o ya no existe): «No se encontró…», sin escribir", async () => {
    const orden = await pedido(["Entradas", "Platos principales", "Bebidas"]);
    expect(await ordenarSeccionesCartaCasoDeUso(actor(), { secciones: [...orden, { seccionCartaId: "no-existe", ordenVisto: 7 }] })).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    expect(await auditorias()).toBe(0);
  });

  it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos órdenes distintos a la vez → gana uno, entero, y el otro ORDEN_DESACTUALIZADO; dos iguales → uno escribe y el otro es un éxito sin cambio`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const a = await pedido(["Postres", "Bebidas", "Platos principales", "Entradas"]);
      const b = await pedido(["Platos principales", "Entradas", "Postres", "Bebidas"]);
      const antes = await auditorias();
      const [x, y] = await Promise.allSettled([ordenarSeccionesCartaCasoDeUso(actor(), { secciones: a }), ordenarSeccionesCartaCasoDeUso(actor(), { secciones: b })]);
      const resumen = [x, y].map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : r.value.codigo) : `error:${String(r.reason)}`)).sort();
      expect(resumen, `vuelta ${i}`).toEqual(["ORDEN_DESACTUALIZADO", "ok"]);
      const ganador = x.status === "fulfilled" && x.value.ok ? "a" : "b";
      expect(await enOrden(), `vuelta ${i}`).toEqual(
        ganador === "a" ? ["Postres:0", "Bebidas:1", "Platos principales:2", "Entradas:3"] : ["Platos principales:0", "Entradas:1", "Postres:2", "Bebidas:3"]
      );
      expect((await auditorias()) - antes, `vuelta ${i}: una auditoría por sección que cambió, del ganador`).toBe(
        (x.status === "fulfilled" && x.value.ok ? x.value.datos.cambiadas : 0) + (y.status === "fulfilled" && y.value.ok ? y.value.datos.cambiadas : 0)
      );

      const igual = await pedido(["Entradas", "Bebidas", "Postres", "Platos principales"]);
      const dos = await Promise.allSettled([ordenarSeccionesCartaCasoDeUso(actor(), { secciones: igual }), ordenarSeccionesCartaCasoDeUso(actor(), { secciones: igual })]);
      const cambiadas = dos.map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.datos.cambiadas : -1)).sort();
      expect(cambiadas[0], `vuelta ${i}: ${JSON.stringify(dos)}`).toBe(0);
      expect(cambiadas[1], `vuelta ${i}`).toBeGreaterThan(0);
      expect(await enOrden(), `vuelta ${i}`).toEqual(["Entradas:0", "Bebidas:1", "Postres:2", "Platos principales:3"]);
    }
  });

  describe("la Server Action", () => {
    it("sin `carta_secciones` (operador) no escribe; un pedido sin forma se rechaza; con la clave escribe", async () => {
      const orden = await pedido(["Postres", "Entradas", "Platos principales", "Bebidas"]);
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      expect((await ordenarSeccionesCarta({ secciones: orden })).ok).toBe(false);
      expect(await auditorias()).toBe(0);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect((await ordenarSeccionesCarta({ secciones: "Postres primero" })).ok).toBe(false);
      expect((await ordenarSeccionesCarta({ secciones: orden.map((x) => ({ ...x, ordenVisto: String(x.ordenVisto) })) })).ok).toBe(false);
      expect((await ordenarSeccionesCarta({ secciones: [...orden, orden[0]] })).ok).toBe(false);
      expect(await enOrden()).toEqual(["Entradas:0", "Platos principales:1", "Bebidas:2", "Postres:7"]);

      expect(await ordenarSeccionesCarta({ secciones: orden })).toMatchObject({ ok: true, mensaje: "Listo: las secciones quedaron en el orden nuevo, en todas las sucursales." });
      expect(await enOrden()).toEqual(["Postres:0", "Entradas:1", "Platos principales:2", "Bebidas:3"]);
    });
  });
});
