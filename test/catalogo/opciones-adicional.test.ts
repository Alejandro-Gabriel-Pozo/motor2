import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { azarDelProceso } from "../../src/lib/azar";
import { crearOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import { guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { actualizarDisponibilidadProducto } from "../../src/server/actions/catalogo/productos";

/**
 * GO-2a, paso 8: el ADICIONAL con su PRODUCTO ANCLA (D-1, variante A′: lo crea el sistema en la misma transacción que la opción). El ancla nace PV, con el nombre de la opción, su
 * código autogenerado, la unidad elegida, SIN receta y SIN filas de disponibilidad (queda oculto por «sin fila = no disponible»), es único por empresa y no puede tener receta, ni
 * ponerse a la venta suelto, ni admitir opciones. Dos adicionales que piden la misma ancla (el mismo nombre) a la vez: una sola.
 */
const ADICIONAL = (nombre: string, grupoId: string, unidadStockId: string) => ({
  grupoId,
  nombre,
  orden: 1,
  esNinguna: false,
  ancla: { unidadStockId },
  version: { diferencia: { tipo: "MONTO" as const, monto: 300 }, factorEscala: null, consumos: [] },
});

describe("el ADICIONAL y su producto ancla (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  it("crea la opción, su versión 1 y el ancla en una transacción: PV con el nombre de la opción, código PV_…, la unidad elegida, sin receta y sin disponibilidad en ninguna sucursal, con la auditoría del alta", async () => {
    const r = await crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL("Crema batida", e.grupoAdicionalId, e.unidadId), azarDelProceso);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!r.ok) return;
    const ancla = await prisma.producto.findUniqueOrThrow({ where: { id: r.datos.productoAnclaId! }, select: { nombre: true, codigo: true, tipo: true, unidadStockId: true, categoriaId: true, creadoEn: true } });
    expect(ancla).toMatchObject({ nombre: "Crema batida", tipo: "PV", unidadStockId: e.unidadId, categoriaId: null });
    expect(ancla.codigo).toMatch(/^PV_[0-9a-f-]{6}$/);
    expect(ancla.creadoEn.getTime()).toBe(actor().ahora.getTime());
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: r.datos.opcionId } })).productoId).toBe(r.datos.productoAnclaId);
    expect(await prisma.disponibilidadProducto.count({ where: { productoId: r.datos.productoAnclaId! } })).toBe(0);
    expect(await prisma.recetaVersion.count({ where: { productoId: r.datos.productoAnclaId! } })).toBe(0);
    const delAncla = await prisma.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: r.datos.productoAnclaId! }, select: { campo: true, valorNuevo: true } });
    expect(delAncla.map((f) => f.campo).sort()).toEqual(["alta", "factorConversion", "unidadStockId"]);
    expect(r.mensaje).toMatch(/producto de respaldo PV_/);
  });

  it("NOMBRE_DE_ANCLA_REPETIDO si ya hay un producto con ese nombre (sin distinguir mayúsculas); REFERENCIA_NO_ENCONTRADA con una unidad de otra empresa; sin escribir nada", async () => {
    const productos = await prisma.producto.count();
    expect(await crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL("CAFÉ", e.grupoAdicionalId, e.unidadId), azarDelProceso)).toMatchObject({ ok: false, codigo: "NOMBRE_DE_ANCLA_REPETIDO" });
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidadAjena = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    expect(await crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL("Miel", e.grupoAdicionalId, unidadAjena.id), azarDelProceso)).toMatchObject({ ok: false, codigo: "REFERENCIA_NO_ENCONTRADA" });
    expect(await prisma.producto.count()).toBe(productos);
    expect(await prisma.opcionDeGrupo.count({ where: { grupoId: e.grupoAdicionalId } })).toBe(1);
  });

  it("repetir el alta del mismo adicional devuelve el mismo, sin otra ancla", async () => {
    const a = await crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL("Miel", e.grupoAdicionalId, e.unidadId), azarDelProceso);
    const b = await crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL("Miel", e.grupoAdicionalId, e.unidadId), azarDelProceso);
    expect(b).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(a.ok && b.ok && a.datos.productoAnclaId === b.datos.productoAnclaId).toBe(true);
    expect(await prisma.producto.count({ where: { nombre: "Miel" } })).toBe(1);
  });

  it("una opción que no es adicional NO lleva ancla (CONFIGURACION_INVALIDA, sin producto nuevo)", async () => {
    const productos = await prisma.producto.count();
    expect(await crearOpcionDeGrupoCasoDeUso(actor(), { ...ADICIONAL("Tostada", e.grupoVarianteId, e.unidadId), version: { diferencia: { tipo: "MONTO", monto: 0 }, factorEscala: null, consumos: [] } }, azarDelProceso)).toMatchObject({
      ok: false,
      codigo: "CONFIGURACION_INVALIDA",
    });
    expect(await prisma.producto.count()).toBe(productos);
  });

  describe("blindaje del ancla", () => {
    it("no puede tener receta (ES_ANCLA_DE_ADICIONAL), no se pone a la venta suelta, y no admite opciones; apagarla sí se puede", async () => {
      const r = await guardarReceta(e.anclaDelShotId, [{ insumoProductoId: e.lecheId, cantidad: 1, unidadId: e.unidadId }], [], {}, 0);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/producto de respaldo de un adicional: no lleva receta/);
      expect(await prisma.recetaVersion.count({ where: { productoId: e.anclaDelShotId } })).toBe(0);

      const prender = await actualizarDisponibilidadProducto(e.anclaDelShotId, true);
      expect(prender.ok).toBe(false);
      expect(prender.mensaje).toMatch(/se vende solo como adicional/);
      expect(await prisma.disponibilidadProducto.count({ where: { productoId: e.anclaDelShotId, disponible: true } })).toBe(0);
      expect(await actualizarDisponibilidadProducto(e.anclaDelShotId, false)).toMatchObject({ ok: true });

      const admitir = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), {
        productoId: e.anclaDelShotId,
        grupoId: e.grupoVarianteId,
        versionEsperada: 0,
        orden: 0,
        cantidadMinima: null,
        cantidadMaxima: null,
        modoPrecio: null,
        activo: true,
        opciones: [],
      });
      expect(admitir).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
    });

    it("un producto común sigue con su receta y su disponibilidad como siempre (control)", async () => {
      const prendido = await actualizarDisponibilidadProducto(e.cafeId, true);
      expect(prendido, prendido.mensaje).toMatchObject({ ok: true });
      expect(await actualizarDisponibilidadProducto(e.cafeId, true)).toMatchObject({ ok: true });
    });
  });

  it("dos adicionales de grupos distintos con el MISMO nombre a la vez: UNA sola ancla; el otro recibe NOMBRE_DE_ANCLA_REPETIDO o, si es el mismo pedido, la misma opción", async () => {
    const otroGrupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Toppings", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2 } });
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < 5; i++) {
      const nombre = `Queso extra ${i}`;
      const [a, b] = await Promise.all([
        crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL(nombre, e.grupoAdicionalId, e.unidadId), azarDelProceso),
        crearOpcionDeGrupoCasoDeUso(actor(), ADICIONAL(nombre.toUpperCase(), otroGrupo.id, e.unidadId), azarDelProceso),
      ]);
      expect([a, b].filter((r) => r.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["NOMBRE_DE_ANCLA_REPETIDO"]);
      expect(await prisma.producto.count({ where: { nombre: { equals: nombre, mode: "insensitive" } } })).toBe(1);
      expect(await prisma.opcionDeGrupo.count({ where: { nombre: { equals: nombre, mode: "insensitive" } } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único del nombre ni el reintento").toBeGreaterThan(2 * 5);
    intentos.mockRestore();
  });
});
