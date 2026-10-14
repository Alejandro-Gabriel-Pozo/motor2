import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { agregarProductoALaCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-producto-a-la-carta";
import { quitarProductoDeLaCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/quitar-producto-de-la-carta";
import { quitarProductoDeLaCarta } from "../../src/server/actions/carta/mantenimiento";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";

/**
 * CARTA-MANT (decisión del dueño, 2026-10-14; fila O.483 de docs/pureza-integracion.md): «Quitar de la carta», el «Deshacer» de «Agregar a la carta» y la salida de un producto que no va. Contra
 * Postgres real como `motor2_app` con el alcance de la sucursal activa: borra el contenido de ESTA sucursal (vuelve a «Fuera de carta») con la auditoría de cada dato, pide confirmación si había algo
 * cargado a mano, es idempotente, no toca otra sucursal ni el ítem agrupado, y agregar y quitar a la vez quedan ordenados.
 */
const ITERACIONES = 10;

describe("quitar un producto de la carta (CARTA-MANT)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let unidadId: string;
  let platos: string;
  let n = 0;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `PV_Q_${n++}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalA)).id;
  const contenido = (productoId: string, sucursalId = sucursalA) => prisma.contenidoCartaProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
  const auditoria = (productoId: string) =>
    prisma.registroAuditoria.findMany({ where: { entidad: "ContenidoCartaProducto", entidadId: `${sucursalA}:${productoId}` }, orderBy: [{ creadoEn: "asc" }, { campo: "asc" }], select: { campo: true, valorAnterior: true, valorNuevo: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    platos = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
  });

  it("el «Deshacer» de agregar: uno recién agregado (sin nada cargado) se quita sin confirmar y vuelve a «Fuera de carta»; quitarlo otra vez no hace nada", async () => {
    const guiso = await pv("Guiso");
    expect((await agregarProductoALaCartaCasoDeUso(actor(), { productoId: guiso, seccionCartaId: platos })).ok).toBe(true);
    expect(await quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: guiso, confirmado: false })).toMatchObject({ ok: true, datos: { huboCambio: true }, mensaje: "«Guiso» volvió a «Fuera de carta» (POS y menú del día)." });
    expect(await contenido(guiso)).toBeNull();
    expect((await cargarCartaParaMantener(actor().db, sucursalA)).fueraDeCarta.map((p) => p.id)).toEqual([guiso]);
    // La auditoría: el alta y, al quitar, un registro por dato que tenía (visible, sección, orden).
    expect(await auditoria(guiso)).toEqual(
      expect.arrayContaining([
        { campo: "visibleEnCarta", valorAnterior: null, valorNuevo: "true" },
        { campo: "visibleEnCarta", valorAnterior: "true", valorNuevo: null },
        { campo: "seccionCartaId", valorAnterior: platos, valorNuevo: null },
        { campo: "orden", valorAnterior: "0", valorNuevo: null },
      ])
    );
    const antes = (await auditoria(guiso)).length;
    expect(await quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: guiso, confirmado: false })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect((await auditoria(guiso)).length).toBe(antes);
    // Y se puede volver a agregar (antes, con el contenido oculto, daba YA_TIENE_CONTENIDO).
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: guiso, seccionCartaId: platos })).toMatchObject({ ok: true, datos: { huboCambio: true } });
  });

  it("con datos cargados a mano pide confirmar (no borra nada); confirmado, los deja en la auditoría", async () => {
    const flan = await pv("Flan");
    const genero = await prisma.generoCarta.create({ data: { sucursalId: sucursalA, nombre: "Postres caseros" } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: flan, visibleEnCarta: true, seccionCartaId: platos, descripcion: "De la abuela", tags: ["Casero", "Sin TACC"], especial: true, generoCartaId: genero.id, orden: 3 } });
    const r = await quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: flan, confirmado: false });
    expect(r).toMatchObject({ ok: false, codigo: "HAY_DATOS_CARGADOS" });
    expect(r.mensaje).toBe("«Flan» tiene cargado la descripción, los tags, el ★ especial, el género: al quitarlo de la carta se pierde. Confirmá para quitarlo igual.");
    expect(await contenido(flan)).not.toBeNull();
    expect(await auditoria(flan)).toEqual([]);

    expect((await quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: flan, confirmado: true })).ok).toBe(true);
    expect(await contenido(flan)).toBeNull();
    expect(await auditoria(flan)).toEqual(
      expect.arrayContaining([
        { campo: "descripcion", valorAnterior: "De la abuela", valorNuevo: null },
        { campo: "tags", valorAnterior: "Casero, Sin TACC", valorNuevo: null },
        { campo: "especial", valorAnterior: "true", valorNuevo: null },
        { campo: "generoCartaId", valorAnterior: genero.id, valorNuevo: null },
        { campo: "orden", valorAnterior: "3", valorNuevo: null },
      ])
    );
    // El género, la sección y el producto siguen (nada colgaba de la fila borrada).
    expect(await prisma.generoCarta.count({ where: { id: genero.id } })).toBe(1);
    expect(await prisma.producto.count({ where: { id: flan } })).toBe(1);
  });

  it("borra SOLO en la sucursal activa (el contenido de Norte queda) y no toca el ítem agrupado de un miembro (lo dice el mensaje)", async () => {
    const quilmes = await pv("Quilmes");
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: quilmes, visibleEnCarta: true, seccionCartaId: platos } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalB, productoId: quilmes, visibleEnCarta: true, seccionCartaId: platos } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Cervezas", seccionCartaId: platos } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalA, itemAgrupadoCartaId: item.id, productoId: quilmes } });
    const r = await quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: quilmes, confirmado: false });
    expect(r).toMatchObject({ ok: true, mensaje: "«Quilmes» salió de la carta suelta; sigue saliendo dentro del agrupado «Cervezas» (eso se maneja desde «Agrupados»)." });
    expect(await contenido(quilmes)).toBeNull();
    expect(await contenido(quilmes, sucursalB)).not.toBeNull();
    expect(await prisma.opcionItemAgrupadoCarta.count({ where: { productoId: quilmes } })).toBe(1);
    // «Agregar» a un miembro de un agrupado lo rechaza: suelto quedaría duplicado (D3).
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: quilmes, seccionCartaId: platos })).toMatchObject({ ok: false, codigo: "ES_MIEMBRO_DE_AGRUPADO" });
  });

  it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos «quitar» a la vez dejan una sola tanda de auditoría; «agregar» y «quitar» a la vez terminan en un estado coherente con su auditoría`, async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const p = await pv(`Doble ${i}`);
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: p, visibleEnCarta: true, seccionCartaId: platos } });
      const res = await Promise.allSettled([quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: p, confirmado: false }), quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: p, confirmado: false })]);
      const cambios = res.map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.datos.huboCambio : null));
      expect(cambios.sort(), `vuelta ${i}: ${JSON.stringify(res)}`).toEqual([false, true]);
      expect((await auditoria(p)).filter((f) => f.campo === "visibleEnCarta"), `vuelta ${i}`).toHaveLength(1);

      const q = await pv(`Cruce ${i}`);
      await Promise.allSettled([agregarProductoALaCartaCasoDeUso(actor(), { productoId: q, seccionCartaId: platos }), quitarProductoDeLaCartaCasoDeUso(actor(), { productoId: q, confirmado: false })]);
      const quedo = await contenido(q);
      // La cadena de `visibleEnCarta`: alternada y terminando en lo que quedó (con fila: «true»; sin fila: null o sin registros).
      const cadena = (await auditoria(q)).filter((f) => f.campo === "visibleEnCarta");
      let estado: string | null = null;
      for (const [k, fila] of cadena.entries()) {
        expect(fila.valorAnterior, `vuelta ${i}, fila ${k}`).toBe(estado);
        estado = fila.valorNuevo;
      }
      expect(estado, `vuelta ${i}`).toBe(quedo ? "true" : null);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna vuelta chocaron los pedidos: el test no ejercitó SERIALIZABLE").toBeGreaterThan(4 * ITERACIONES);
    intentos.mockRestore();
  });

  describe("la Server Action", () => {
    it("sin `carta_contenido_producto` (operador) no borra; con el eco de otra sucursal tampoco; con la clave y confirmando, sí", async () => {
      const flan = await pv("Flan");
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: flan, visibleEnCarta: true, seccionCartaId: platos, descripcion: "Casero" } });
      const operador = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
      const operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: operador.id })).id;
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      expect((await quitarProductoDeLaCarta({ sucursalId: sucursalA, productoId: flan, confirmado: true })).ok).toBe(false);
      expect(await contenido(flan)).not.toBeNull();

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect(await quitarProductoDeLaCarta({ sucursalId: sucursalB, productoId: flan, confirmado: true })).toMatchObject({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      expect(await quitarProductoDeLaCarta({ sucursalId: sucursalA, productoId: flan })).toMatchObject({ ok: false });
      expect(await contenido(flan)).not.toBeNull();
      expect(await quitarProductoDeLaCarta({ sucursalId: sucursalA, productoId: flan, confirmado: true })).toMatchObject({ ok: true });
      expect(await contenido(flan)).toBeNull();
    });
  });
});
