import { beforeEach, describe, expect, it } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import type { ComandoCrearGrupoEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { crearGrupoEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-en-el-producto";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Fase 6, paso 6.14c: el comando «crear un grupo sin salir del producto» no cruza empresas. Todo pasa por el cliente de la transacción de la sesión (la RLS `aislamiento_empresa` de cada tabla del catálogo), así
 * que un `productoId` de OTRA empresa responde igual que uno que no existe (`PRODUCTO_NO_ENCONTRADO`) y no queda ninguna fila en NINGUNA de las dos empresas. Y un grupo de la biblioteca de la otra empresa que se
 * llama igual no cuenta: el nombre es único dentro de cada empresa, no entre empresas (ni se adopta ni se toca).
 *
 * No tiene mutación propia: lo garantiza la RLS (`opciones-rls.test.ts` la prueba y la muta); acá se documenta que el comando compuesto no la esquiva (no usa el cliente de dueño ni ningún `prismaAdmin`).
 */
describe("crear un grupo sin salir del producto — aislamiento por empresa (6.14c)", () => {
  let e: EscenarioDeOpciones;
  let ajenoId: string;
  let grupoAjenoId: string;
  const testigo = () => clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  const crear = (comando: ComandoCrearGrupoEnElProducto) => crearGrupoEnElProductoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), comando, azarDelProceso);
  const comando = (productoId: string): ComandoCrearGrupoEnElProducto => ({
    productoId,
    nombre: "Presentación",
    respuesta: "PRECIO_FINAL",
    prefijoEnCarta: null,
    opciones: [{ nombre: "Simple", importe: 8000 }, { nombre: "Doble", importe: 11000 }],
  });
  /** Las filas del catálogo de opciones de UNA empresa (la que ve el cliente que se pasa). */
  const filasDe = async (cliente: typeof prisma) => ({
    grupos: await cliente.grupoDeOpciones.count(),
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
    ajenoId = (await otra.producto.create({ data: { codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidad.id, modoDeVenta: "BASE_CONFIGURABLE" } })).id;
    // Un grupo de la biblioteca de la OTRA empresa con el mismo nombre que el del comando y una opción de la misma «forma».
    const grupo = await otra.grupoDeOpciones.create({ data: { nombre: "Presentación", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    grupoAjenoId = grupo.id;
    await otra.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Simple", orden: 10 } });
  });

  it("un producto de OTRA empresa responde como uno que no existe y no queda ni una fila en ninguna de las dos empresas", async () => {
    const [propiasAntes, ajenasAntes] = [await filasDe(prisma), await filasDe(testigo())];
    const r = await crear(comando(ajenoId));
    expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO", mensaje: "No se encontró el producto." });
    expect(await filasDe(prisma)).toEqual(propiasAntes);
    expect(await filasDe(testigo())).toEqual(ajenasAntes);
    // El grupo de la otra empresa sigue como estaba (ni opciones nuevas, ni admisión).
    expect(await testigo().opcionDeGrupo.count({ where: { grupoId: grupoAjenoId } })).toBe(1);
    expect(await testigo().productoAdmiteGrupo.count()).toBe(0);
  });

  it("un grupo de la biblioteca de OTRA empresa con el mismo nombre no cuenta: se crea el propio, y el ajeno ni se adopta ni se toca", async () => {
    const ajenasAntes = await filasDe(testigo());
    const r = await crear(comando(e.cafeId));
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!r.ok) return;
    expect(r.datos.grupoId).not.toBe(grupoAjenoId);
    expect(await prisma.grupoDeOpciones.count({ where: { nombre: "Presentación" } })).toBe(1);
    expect(await prisma.opcionDeGrupo.count({ where: { grupoId: r.datos.grupoId } })).toBe(2);
    expect(await filasDe(testigo())).toEqual(ajenasAntes);
    expect(await testigo().grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoAjenoId } })).toMatchObject({ nombre: "Presentación", activo: true, version: 1 });
  });
});
