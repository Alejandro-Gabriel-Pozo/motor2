import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { fijarDisponibilidadDeHoyCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-disponibilidad-de-hoy";
import { fijarDisponibilidadDeHoy } from "../../src/server/actions/carta/mantenimiento";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";

/**
 * CARTA-MANT F2 (fila O.482 de docs/pureza-integracion.md): «Hoy» de la carta, contra Postgres real como `motor2_app` con el alcance de la sucursal activa. Es la disponibilidad por producto y
 * sucursal de siempre (`DisponibilidadProducto`), varios a la vez y TODO O NADA, con las mismas reglas que el caso de uso de un producto (dependencias al apagar, ancla, D4 a $0) y su auditoría.
 */
const ITERACIONES = 10;

describe("«Hoy»: apagar o prender varios productos a la vez, todo o nada (CARTA-MANT)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let unidadId: string;
  const actor = () => ({ ...actorDePrueba(usuarioId, sucursalA), sucursalNombre: "Central" });
  let n = 0;
  const pv = async (nombre: string, precioVenta = 1000) => (await sembrarProductoDisponible({ codigo: `PV_HOY_${n++}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta }, sucursalA)).id;
  const disponible = async (productoId: string, sucursalId = sucursalA) =>
    (await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.disponible ?? false;
  const auditorias = (productoId: string) => prisma.registroAuditoria.count({ where: { entidad: "DisponibilidadProducto", entidadId: `${sucursalA}:${productoId}` } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
  });

  it("apaga una sección entera (tres productos) con una auditoría por producto que cambió; repetirlo no escribe ni audita; el «Deshacer» deja todo como estaba", async () => {
    const [a, b, c] = [await pv("Tabla"), await pv("Provoleta"), await pv("Empanadas")];
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: c } }, data: { disponible: false } });
    const apagar = [a, b, c].map((productoId) => ({ productoId, disponible: false }));
    const r = await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: apagar, puedeEditarCamposSensibles: false });
    expect(r).toMatchObject({ ok: true, datos: { cambiados: 2 } });
    expect(r.mensaje).toBe("3 productos sin stock hoy en «Central» (1 ya estaba así).");
    expect([await disponible(a), await disponible(b), await disponible(c)]).toEqual([false, false, false]);
    expect([await auditorias(a), await auditorias(b), await auditorias(c)]).toEqual([1, 1, 0]);
    expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: `${sucursalA}:${a}` } })).toMatchObject({ campo: "disponible", valorAnterior: "true", valorNuevo: "false", actorId: usuarioId });

    expect(await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: apagar, puedeEditarCamposSensibles: false })).toMatchObject({ ok: true, datos: { cambiados: 0 } });
    expect([await auditorias(a), await auditorias(b), await auditorias(c)]).toEqual([1, 1, 0]);

    // «Deshacer»: los estados de antes.
    const deshacer = [{ productoId: a, disponible: true }, { productoId: b, disponible: true }, { productoId: c, disponible: false }];
    const d = await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: deshacer, puedeEditarCamposSensibles: false });
    expect(d).toMatchObject({ ok: true, datos: { cambiados: 2 } });
    expect(d.mensaje).toBe("3 productos vuelven a como estaban en «Central».");
    expect([await disponible(a), await disponible(b), await disponible(c)]).toEqual([true, true, false]);
  });

  it("TODO O NADA: si uno no se puede (tiene dependencias, es el ancla de un adicional o está a $0 sin la clave fina), no cambia NINGUNO", async () => {
    const libre = await pv("Libre");
    // Una MP en la receta vigente de un plato disponible acá: apagarla está bloqueado (la regla de siempre).
    const harina = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadId }, sucursalA)).id;
    const pizza = await pv("Pizza");
    await prisma.recetaVersion.create({ data: { productoId: pizza, version: 1, ingredientes: { create: [{ insumoProductoId: harina, cantidad: 1, unidadId }] } } });
    const r1 = await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [{ productoId: libre, disponible: false }, { productoId: harina, disponible: false }], puedeEditarCamposSensibles: false });
    expect(r1).toMatchObject({ ok: false, codigo: "TIENE_DEPENDENCIAS" });
    expect(r1.mensaje).toMatch(/^No se cambió ninguno: No se puede desactivar "Harina"/);
    expect(await disponible(libre)).toBe(true);

    // El ancla de un adicional no se pone a la venta.
    const ancla = await pv("Adicional - papas y huevo");
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: ancla } }, data: { disponible: false } });
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2 } });
    await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Papas y huevo", productoId: ancla } });
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: libre } }, data: { disponible: false } });
    expect(await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [{ productoId: libre, disponible: true }, { productoId: ancla, disponible: true }], puedeEditarCamposSensibles: true })).toMatchObject({ ok: false, codigo: "ES_ANCLA_DE_ADICIONAL" });
    expect(await disponible(libre)).toBe(false);

    // D4: un PV a $0 se pone a la venta solo con `producto_campos_sensibles`.
    const sinPrecio = await pv("Sin precio", 0);
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: sinPrecio } }, data: { disponible: false } });
    expect(await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [{ productoId: libre, disponible: true }, { productoId: sinPrecio, disponible: true }], puedeEditarCamposSensibles: false })).toMatchObject({ ok: false, codigo: "SIN_PERMISO_CAMPOS_SENSIBLES" });
    expect([await disponible(libre), await disponible(sinPrecio)]).toEqual([false, false]);
    expect(await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [{ productoId: libre, disponible: true }, { productoId: sinPrecio, disponible: true }], puedeEditarCamposSensibles: true })).toMatchObject({ ok: true, datos: { cambiados: 2 } });
    expect(await prisma.registroAuditoria.count({ where: { entidad: "DisponibilidadProducto", entidadId: { in: [`${sucursalA}:${harina}`, `${sucursalA}:${ancla}`] } } })).toBe(0);
  });

  it("escribe SOLO en la sucursal activa: Norte no cambia", async () => {
    const flan = await pv("Flan");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: flan, disponible: true } });
    expect((await fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [{ productoId: flan, disponible: false }], puedeEditarCamposSensibles: false })).ok).toBe(true);
    expect([await disponible(flan), await disponible(flan, sucursalB)]).toEqual([false, true]);
  });

  it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos lotes que se cruzan (apagar y prender la misma sección a la vez) terminan en UNO de los dos estados, entero, y la cadena de auditoría de cada producto es coherente`, async () => {
    const ids = [await pv("A"), await pv("B"), await pv("C")];
    for (let i = 0; i < ITERACIONES; i++) {
      // Orden distinto en cada lote: el caso de uso toma las filas en orden de id (sin abrazo mortal).
      const [x, y] = await Promise.allSettled([
        fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: ids.map((productoId) => ({ productoId, disponible: false })), puedeEditarCamposSensibles: false }),
        fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: [...ids].reverse().map((productoId) => ({ productoId, disponible: true })), puedeEditarCamposSensibles: false }),
      ]);
      expect(x.status === "fulfilled" && x.value.ok && y.status === "fulfilled" && y.value.ok, `vuelta ${i}: ${JSON.stringify([x, y])}`).toBe(true);
      const estados = await Promise.all(ids.map((id) => disponible(id)));
      expect(new Set(estados).size, `vuelta ${i}: la sección quedó a medias ${JSON.stringify(estados)}`).toBe(1);
      for (const id of ids) {
        const cadena = await prisma.registroAuditoria.findMany({ where: { entidad: "DisponibilidadProducto", entidadId: `${sucursalA}:${id}` }, orderBy: { creadoEn: "asc" }, select: { valorAnterior: true, valorNuevo: true } });
        let estado = "true";
        for (const [k, fila] of cadena.entries()) {
          expect(fila.valorAnterior, `vuelta ${i}, ${id}, fila ${k}: el «antes» no es el «después» de la anterior`).toBe(estado);
          estado = fila.valorNuevo!;
        }
        expect(estado).toBe(String(estados[0]));
      }
    }
  });

  it(`concurrencia real (${ITERACIONES} vueltas): dos «apagar la sección» iguales a la vez dejan una sola auditoría por producto (idempotente)`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const ids = [await pv(`X${i}`), await pv(`Y${i}`)];
      const lote = () => fijarDisponibilidadDeHoyCasoDeUso(actor(), { cambios: ids.map((productoId) => ({ productoId, disponible: false })), puedeEditarCamposSensibles: false });
      const res = await Promise.allSettled([lote(), lote()]);
      const cambiados = res.map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.datos.cambiados : -1)).sort();
      expect(cambiados, `vuelta ${i}`).toEqual([0, 2]);
      for (const id of ids) expect(await auditorias(id), `vuelta ${i}`).toBe(1);
    }
  });

  describe("la Server Action", () => {
    it("sin `producto_disponibilidad` no escribe; con el eco de otra sucursal tampoco; repetidos y vacíos se rechazan; con la clave escribe", async () => {
      const flan = await pv("Flan");
      const mozo = await prisma.rol.create({ data: { nombre: "mozo", clave: "mozo" } });
      const mozoId = (await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: sucursalA, rolId: mozo.id })).id;
      await mockearUsuarioActual({ id: mozoId, email: "mozo@test.com", nombre: null });
      expect((await fijarDisponibilidadDeHoy({ sucursalId: sucursalA, cambios: [{ productoId: flan, disponible: false }] })).ok).toBe(false);
      expect(await disponible(flan)).toBe(true);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect(await fijarDisponibilidadDeHoy({ sucursalId: sucursalB, cambios: [{ productoId: flan, disponible: false }] })).toMatchObject({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      expect(await fijarDisponibilidadDeHoy({ sucursalId: sucursalA, cambios: [] })).toMatchObject({ ok: false });
      expect(await fijarDisponibilidadDeHoy({ sucursalId: sucursalA, cambios: [{ productoId: flan, disponible: false }, { productoId: flan, disponible: true }] })).toMatchObject({ ok: false, mensaje: "Un producto figura dos veces en el mismo cambio." });
      expect(await fijarDisponibilidadDeHoy({ sucursalId: sucursalA, cambios: [{ productoId: flan, disponible: "no" }] })).toMatchObject({ ok: false });
      expect(await disponible(flan)).toBe(true);

      expect(await fijarDisponibilidadDeHoy({ sucursalId: sucursalA, cambios: [{ productoId: flan, disponible: false }] })).toMatchObject({ ok: true, mensaje: expect.stringMatching(/^«Flan»: sin stock hoy en «/) });
      expect(await disponible(flan)).toBe(false);
    });
  });
});
