import { beforeEach, describe, expect, it } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import type { ComandoCrearOpcionEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { crearOpcionEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-en-el-producto";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * «+ Opción» / «+ Extra» no cruza empresas. Todo pasa por el cliente de la transacción de la sesión (la RLS `aislamiento_empresa` de cada tabla del catálogo), así que el id de un producto, de un grupo o de una
 * unidad de OTRA empresa responde igual que uno que no existe y no queda ninguna fila en NINGUNA de las dos empresas: ni opción, ni versión, ni respaldo, ni admisión, ni auditoría.
 *
 * No tiene mutación propia: lo garantiza la RLS (`opciones-rls.test.ts` la prueba y la muta); acá se documenta que el comando compuesto no la esquiva (no usa el cliente de dueño ni ningún `prismaAdmin`).
 */
describe("agregar una opción al producto (+ Opción, + Extra) — aislamiento por empresa", () => {
  let e: EscenarioDeOpciones;
  let ajenoId: string;
  let grupoAjenoId: string;
  let unidadAjenaId: string;
  const testigo = () => clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  const crear = (comando: ComandoCrearOpcionEnElProducto) => crearOpcionEnElProductoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), comando, azarDelProceso);
  const propiaVersion = async (productoId: string, grupoId: string) => (await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId, grupoId } } })).version;
  /** Las filas del catálogo de opciones de UNA empresa (la que ve el cliente que se pasa). */
  const filasDe = async (cliente: typeof prisma) => ({
    opciones: await cliente.opcionDeGrupo.count(),
    versiones: await cliente.versionDeOpcion.count(),
    admisionesDeGrupo: await cliente.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await cliente.productoAdmiteOpcion.count(),
    productos: await cliente.producto.count(),
    auditorias: await cliente.registroAuditoria.count(),
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const otra = testigo();
    const unidad = await otra.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    unidadAjenaId = unidad.id;
    ajenoId = (await otra.producto.create({ data: { codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidad.id } })).id;
    // Un grupo de la biblioteca de la OTRA empresa que el producto ajeno usa, como el que tendría que usar el propio.
    const grupo = await otra.grupoDeOpciones.create({ data: { nombre: "Leche", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    grupoAjenoId = grupo.id;
    await otra.productoAdmiteGrupo.create({ data: { productoId: ajenoId, grupoId: grupo.id, orden: 0 } });
  });

  it("un producto de OTRA empresa responde como uno que no existe y no queda ni una fila en ninguna de las dos empresas", async () => {
    const [propiasAntes, ajenasAntes] = [await filasDe(prisma), await filasDe(testigo())];
    const r = await crear({ productoId: ajenoId, grupoId: grupoAjenoId, versionEsperada: 1, nombre: "Avena", importe: 200, unidadStockId: null });
    expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO", mensaje: "No se encontró el producto." });
    expect(await filasDe(prisma)).toEqual(propiasAntes);
    expect(await filasDe(testigo())).toEqual(ajenasAntes);
  });

  it("un grupo de OTRA empresa con un producto PROPIO responde como un grupo que no existe y no se toca nada en ninguna de las dos", async () => {
    const [propiasAntes, ajenasAntes] = [await filasDe(prisma), await filasDe(testigo())];
    const r = await crear({ productoId: e.cafeId, grupoId: grupoAjenoId, versionEsperada: 1, nombre: "Avena", importe: 200, unidadStockId: null });
    expect(r).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO", mensaje: "No se encontró el grupo de opciones." });
    expect(await filasDe(prisma)).toEqual(propiasAntes);
    expect(await filasDe(testigo())).toEqual(ajenasAntes);
    expect(await testigo().opcionDeGrupo.count({ where: { grupoId: grupoAjenoId } })).toBe(0);
  });

  it("«+ Extra» con la unidad de OTRA empresa para el respaldo: no se encuentra, y no queda ni la opción ni un producto de respaldo", async () => {
    const [propiasAntes, ajenasAntes] = [await filasDe(prisma), await filasDe(testigo())];
    const r = await crear({ productoId: e.cafeId, grupoId: e.grupoAdicionalId, versionEsperada: await propiaVersion(e.cafeId, e.grupoAdicionalId), nombre: "Crema", importe: 120, unidadStockId: unidadAjenaId });
    expect(r).toMatchObject({ ok: false, codigo: "REFERENCIA_NO_ENCONTRADA" });
    expect(await filasDe(prisma)).toEqual(propiasAntes);
    expect(await filasDe(testigo())).toEqual(ajenasAntes);
  });
});
