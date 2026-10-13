import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (patrón de `precio-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima llamada a
 * `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió. Las demás delegan en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { sembrarEscenarioDeOpciones } from "../setup/opciones";
import { azarDelProceso } from "../../src/lib/azar";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { crearOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import { crearGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-opciones";
import { editarGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones";

/**
 * GO-2a: cada caso de uso del catálogo de opciones escribe su fila y TODA su auditoría en UNA transacción, con el mismo `tx`: si una fila de auditoría falla (aunque sea la última),
 * no queda NADA — ni la fila nueva o editada, ni las filas de auditoría que sí se habían escrito, ni la versión subida.
 */
describe("catálogo de opciones: la escritura y su auditoría son atómicas (GO-2a)", () => {
  let adminId: string;
  let sucursalId: string;
  const actor = () => actorDePrueba(adminId, sucursalId);

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    interruptor.llamadas = 0;
  });

  afterEach(() => {
    interruptor.fallarEnLlamada = null;
  });

  it("crear un grupo: falla la ÚLTIMA fila de auditoría del alta → no queda ni el grupo ni ninguna fila de auditoría", async () => {
    interruptor.fallarEnLlamada = 4;
    await expect(crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 })).rejects.toThrow("auditoría caída");
    expect(await prisma.grupoDeOpciones.count()).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("editar un grupo: falla la segunda columna auditada → el grupo queda como estaba (nombre, cantidades y versión) y sin auditoría de la edición", async () => {
    const r = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 });
    const grupoId = r.ok ? r.datos.grupoId : "";
    const auditoriaDelAlta = await prisma.registroAuditoria.count();
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 2;
    await expect(editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Agregados", cantidadMinima: 0, cantidadMaxima: 2, activo: false })).rejects.toThrow("auditoría caída");
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } })).toMatchObject({ nombre: "Extras", cantidadMaxima: 3, activo: true, version: 1 });
    expect(await prisma.registroAuditoria.count()).toBe(auditoriaDelAlta);
  });

  // paso 7
  it("crear un ADICIONAL con su ancla: falla la ÚLTIMA fila de auditoría → no queda ni la opción, ni su versión, ni el producto ancla, ni ninguna auditoría", async () => {
    await limpiarBaseDeTest();
    const e = await sembrarEscenarioDeOpciones();
    const productos = await prisma.producto.count();
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 12; // 3 del ancla + 4 de la opción + 5 de la versión: la última
    await expect(
      crearOpcionDeGrupoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), { grupoId: e.grupoAdicionalId, nombre: "Crema", orden: 2, esNinguna: false, ancla: { unidadStockId: e.unidadId }, version: { diferencia: { tipo: "MONTO", monto: 250 }, factorEscala: null, consumos: [] } }, azarDelProceso)
    ).rejects.toThrow("auditoría caída");
    expect(await prisma.producto.count()).toBe(productos);
    expect(await prisma.opcionDeGrupo.count({ where: { nombre: "Crema" } })).toBe(0);
    expect(await prisma.versionDeOpcion.count({ where: { opcion: { nombre: "Crema" } } })).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  // paso 7
  it("agregar una versión: falla la auditoría → no queda la versión ni sus consumos", async () => {
    await limpiarBaseDeTest();
    const e = await sembrarEscenarioDeOpciones();
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 3;
    await expect(
      agregarVersionDeOpcionCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), { opcionId: e.almendrasId, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 175 }, factorEscala: null, consumos: [{ efecto: "REEMPLAZA", insumoProductoId: e.almendrasInsumoId, reemplazaAProductoId: e.lecheId, cantidad: 0.25, mermaPorcentaje: 0, escalaConLaMedida: false }] } })
    ).rejects.toThrow("auditoría caída");
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.almendrasId } })).toBe(1);
    expect(await prisma.consumoDeOpcion.count()).toBe(1);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  // paso 9
  it("fijar lo que admite un producto: falla la auditoría de una opción → no queda la fila del grupo ni la de ninguna opción", async () => {
    await limpiarBaseDeTest();
    const e = await sembrarEscenarioDeOpciones();
    const te = await prisma.producto.create({ data: { codigo: "PV_TE", nombre: "Té", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "800.00" } });
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 5; // 2 de la fila del grupo + 3 de la primera opción: falla la tercera de la primera opción
    const op = (opcionId: string) => ({ opcionId, versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true });
    await expect(
      fijarAdmisionDeGrupoEnProductoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), { productoId: te.id, grupoId: e.grupoVarianteId, versionEsperada: 0, orden: 0, cantidadMinima: null, cantidadMaxima: null, modoPrecio: null, activo: true, opciones: [op(e.vacaId), op(e.almendrasId)] })
    ).rejects.toThrow("auditoría caída");
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: te.id } })).toBe(0);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: te.id } })).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

});
