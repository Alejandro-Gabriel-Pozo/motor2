import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { agregarProductoALaCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-producto-a-la-carta";
import { agregarProductoALaCarta } from "../../src/server/actions/carta/mantenimiento";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";

/**
 * CARTA-MANT F1 (filas O.480 y O.481 de docs/pureza-integracion.md): «Agregar a la carta» un producto que estaba FUERA de carta (POS y menú del día), contra Postgres real como `motor2_app` con el
 * alcance de la sucursal activa. Crea el contenido visible al final de la sección, con su auditoría; nunca pisa un contenido existente; repetir no duplica; dos a la vez dejan UNA fila; escribe SOLO en
 * la sucursal activa; el ancla de un adicional no entra; sin la clave `carta_contenido_producto` no escribe nada.
 */
const ITERACIONES = 10;

describe("agregar un producto fuera de carta a la carta (CARTA-MANT)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let unidadId: string;
  let entradas: string;
  let platos: string;
  let apagada: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `PV_${nombre.replace(/\W/g, "_").toUpperCase()}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalA)).id;
  const auditorias = (productoId: string) => prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto", entidadId: `${sucursalA}:${productoId}` } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    entradas = (await prisma.seccionCarta.create({ data: { nombre: "Entradas", orden: 1 } })).id;
    platos = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 2 } })).id;
    apagada = (await prisma.seccionCarta.create({ data: { nombre: "Vieja", orden: 3, activa: false } })).id;
  });

  it("lo publica visible en la sección elegida y AL FINAL (después de productos e ítems agrupados de ESTA sucursal), con una fila de auditoría", async () => {
    const bife = await pv("Bife");
    const flan = await pv("Flan");
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: bife, visibleEnCarta: true, seccionCartaId: platos, orden: 4 } });
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Cervezas", seccionCartaId: platos, orden: 6 } });
    // Lo de OTRA sucursal no cuenta para el orden.
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalB, nombre: "Vinos", seccionCartaId: platos, orden: 50 } });

    const r = await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: platos });
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: flan } } })).toMatchObject({
      visibleEnCarta: true,
      seccionCartaId: platos,
      orden: 7,
      descripcion: null,
      tags: [],
      especial: false,
      generoCartaId: null,
    });
    const fila = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "ContenidoCartaProducto", entidadId: `${sucursalA}:${flan}` } });
    expect(fila).toMatchObject({ campo: "visibleEnCarta", valorAnterior: null, valorNuevo: "true", actorId: usuarioId, sucursalId: sucursalA });
    // Y la pantalla lo pasa de «Fuera de carta» a su sección.
    const carta = await cargarCartaParaMantener(actor().db, sucursalA);
    expect(carta.fueraDeCarta.map((p) => p.id)).not.toContain(flan);
    expect(carta.secciones.find((s) => s.id === platos)!.productos.map((p) => p.id)).toEqual([bife, flan]);
  });

  it("repetirlo no duplica ni audita de nuevo; con contenido en otra sección u oculto no lo pisa (YA_TIENE_CONTENIDO)", async () => {
    const flan = await pv("Flan");
    expect((await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: platos })).ok).toBe(true);
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: platos })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await auditorias(flan)).toBe(1);
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: entradas })).toMatchObject({ ok: false, codigo: "YA_TIENE_CONTENIDO" });

    const oculto = await pv("Oculto");
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: oculto, visibleEnCarta: false, seccionCartaId: platos, descripcion: "La de la abuela", orden: 3 } });
    const antes = await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: oculto } } });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: oculto, seccionCartaId: platos })).toMatchObject({ ok: false, codigo: "YA_TIENE_CONTENIDO" });
    expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: oculto } } })).toEqual(antes);
    expect(await auditorias(oculto)).toBe(0);
  });

  it("rechaza sin escribir: el ancla de un adicional, un MP, una sección apagada o inexistente y un producto de otra empresa", async () => {
    const ancla = await pv("Adicional - papas fritas y huevo frito");
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 } });
    await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Papas y huevo", productoId: ancla } });
    const mp = (await prisma.producto.create({ data: { codigo: "MP_X", nombre: "Harina", tipo: "MP", unidadStockId: unidadId } })).id;
    const flan = await pv("Flan");
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidadT = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const ajeno = (await testigo.producto.create({ data: { codigo: "PV_T", nombre: "Ajeno", tipo: "PV", unidadStockId: unidadT.id, precioVenta: 1 } })).id;

    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: ancla, seccionCartaId: platos })).toMatchObject({ ok: false, codigo: "ES_ANCLA_DE_ADICIONAL" });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: mp, seccionCartaId: platos })).toMatchObject({ ok: false, codigo: "NO_ES_PV" });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: apagada })).toMatchObject({ ok: false, codigo: "SECCION_APAGADA" });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: "no-existe" })).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: ajeno, seccionCartaId: platos })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect(await prisma.contenidoCartaProducto.count()).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto" } })).toBe(0);
    // Y el ancla tampoco figura en la pantalla (ni «Fuera de carta»).
    const carta = await cargarCartaParaMantener(actor().db, sucursalA);
    expect(carta.fueraDeCarta.map((p) => p.nombre)).toEqual(["Flan"]);
  });

  it("escribe SOLO en la sucursal activa: el contenido de Norte no cuenta ni se toca", async () => {
    const flan = await pv("Flan");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: flan, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalB, productoId: flan, visibleEnCarta: false, seccionCartaId: entradas, descripcion: "De Norte" } });
    expect(await agregarProductoALaCartaCasoDeUso(actor(), { productoId: flan, seccionCartaId: platos })).toMatchObject({ ok: true, datos: { huboCambio: true } });
    const filas = await prisma.contenidoCartaProducto.findMany({ where: { productoId: flan }, orderBy: { sucursalId: "asc" }, select: { sucursalId: true, visibleEnCarta: true, seccionCartaId: true, descripcion: true } });
    expect(filas).toEqual(
      expect.arrayContaining([
        { sucursalId: sucursalA, visibleEnCarta: true, seccionCartaId: platos, descripcion: null },
        { sucursalId: sucursalB, visibleEnCarta: false, seccionCartaId: entradas, descripcion: "De Norte" },
      ])
    );
    expect(filas).toHaveLength(2);
  });

  it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos «agregar» del mismo producto a la vez dejan UNA fila y UNA auditoría; a secciones distintas, gana uno y el otro YA_TIENE_CONTENIDO`, async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const igual = await pv(`Igual ${i}`);
      const [a, b] = await Promise.allSettled([
        agregarProductoALaCartaCasoDeUso(actor(), { productoId: igual, seccionCartaId: platos }),
        agregarProductoALaCartaCasoDeUso(actor(), { productoId: igual, seccionCartaId: platos }),
      ]);
      expect(a.status === "fulfilled" && b.status === "fulfilled", `vuelta ${i}: ${JSON.stringify([a, b])}`).toBe(true);
      const ra = (a as PromiseFulfilledResult<Awaited<ReturnType<typeof agregarProductoALaCartaCasoDeUso>>>).value;
      const rb = (b as PromiseFulfilledResult<Awaited<ReturnType<typeof agregarProductoALaCartaCasoDeUso>>>).value;
      expect(ra.ok && rb.ok, `vuelta ${i}: ${ra.mensaje} | ${rb.mensaje}`).toBe(true);
      expect([ra, rb].filter((r) => r.ok && r.datos.huboCambio), `vuelta ${i}`).toHaveLength(1);
      expect(await prisma.contenidoCartaProducto.count({ where: { productoId: igual } })).toBe(1);
      expect(await auditorias(igual)).toBe(1);

      const distinto = await pv(`Distinto ${i}`);
      const [c, d] = await Promise.allSettled([
        agregarProductoALaCartaCasoDeUso(actor(), { productoId: distinto, seccionCartaId: platos }),
        agregarProductoALaCartaCasoDeUso(actor(), { productoId: distinto, seccionCartaId: entradas }),
      ]);
      const resultados = [c, d].map((x) => (x.status === "fulfilled" ? x.value : null));
      expect(resultados.filter((r) => r?.ok), `vuelta ${i}: ${JSON.stringify(resultados)}`).toHaveLength(1);
      expect(resultados.filter((r) => r && !r.ok).map((r) => (r && !r.ok ? r.codigo : ""))).toEqual(["YA_TIENE_CONTENIDO"]);
      expect(await prisma.contenidoCartaProducto.count({ where: { productoId: distinto } })).toBe(1);
      expect(await auditorias(distinto)).toBe(1);
    }
    // Guarda contra el falso verde: si nunca se cruzaron, cada vuelta abre exactamente 4 transacciones.
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna vuelta chocaron los dos pedidos: el test no ejercitó el único ni el reintento").toBeGreaterThan(4 * ITERACIONES);
    intentos.mockRestore();
  });

  describe("la Server Action", () => {
    let operadorId: string;
    beforeEach(async () => {
      const operador = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
      operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: operador.id })).id;
    });

    it("con la clave escribe; sin `carta_contenido_producto` (operador) no escribe nada; con el eco de otra sucursal tampoco", async () => {
      const flan = await pv("Flan");
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const denegado = await agregarProductoALaCarta({ sucursalId: sucursalA, productoId: flan, seccionCartaId: platos });
      expect(denegado.ok).toBe(false);
      expect(await prisma.contenidoCartaProducto.count()).toBe(0);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect(await agregarProductoALaCarta({ sucursalId: sucursalB, productoId: flan, seccionCartaId: platos })).toMatchObject({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      expect(await agregarProductoALaCarta({ sucursalId: sucursalA, productoId: 42, seccionCartaId: platos })).toMatchObject({ ok: false });
      expect(await prisma.contenidoCartaProducto.count()).toBe(0);

      expect(await agregarProductoALaCarta({ sucursalId: sucursalA, productoId: flan, seccionCartaId: platos })).toMatchObject({ ok: true });
      expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: sucursalA, productoId: flan, visibleEnCarta: true } })).toBe(1);
    });
  });
});
