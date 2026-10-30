import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { azarDelProceso } from "../../src/lib/azar";
import { agregarVersionDeOpcion, crearOpcionDeGrupo, editarOpcionDeGrupo } from "../../src/server/actions/catalogo/opciones-de-venta";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { crearOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo";
import { editarOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo";
import type { DatosDeVersionDeOpcion } from "../../src/core/features/catalogo/opciones-de-venta.schema";

/**
 * GO-2a, paso 7: OPCIONES, VERSIONES y CONSUMOS (`opciones_definir`). Contra Postgres real, como `motor2_app`. La opción nace con su versión 1 y sus consumos en una transacción; la
 * versión solo se agrega (número esperado, idempotente si es el mismo pedido); los insumos son materias primas de la empresa y el consumo va en su unidad de stock (U7); los consumos
 * exigen el módulo Recetas (D-3); la «ninguna» solo en VARIANTE o INCLUIDA (D-2); auditoría con el antes y el después.
 */
const MONTO = (monto: number) => ({ tipo: "MONTO" as const, monto });
const sinConsumos = (diferencia = MONTO(0), factorEscala: number | null = null): DatosDeVersionDeOpcion => ({ diferencia, factorEscala, consumos: [] });

describe("opciones, versiones y consumos (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  let operadorId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  describe("crear una opción", () => {
    it("VARIANTE con un consumo que REEMPLAZA: la opción, su versión 1 y el consumo en la unidad de stock del insumo, con la auditoría del alta", async () => {
      const kg = (await prisma.unidad.create({ data: { nombre: "kgx", magnitud: "PESO", decimales: 3 } })).id;
      const avena = (await prisma.producto.create({ data: { codigo: "MP_AVENA", nombre: "Bebida de avena", tipo: "MP", unidadStockId: kg } })).id;
      const r = await crearOpcionDeGrupoCasoDeUso(
        actor(),
        { grupoId: e.grupoVarianteId, nombre: "Avena", orden: 3, esNinguna: false, ancla: null, version: { diferencia: MONTO(120.5), factorEscala: null, consumos: [{ efecto: "REEMPLAZA", insumoProductoId: avena, reemplazaAProductoId: e.lecheId, cantidad: 0.25, mermaPorcentaje: 2.5, escalaConLaMedida: true }] } },
        azarDelProceso
      );
      expect(r).toMatchObject({ ok: true, datos: { yaExistia: false, productoAnclaId: null } });
      if (!r.ok) return;
      const v = await prisma.versionDeOpcion.findUniqueOrThrow({ where: { id: r.datos.versionDeOpcionId }, include: { consumos: true } });
      expect(v).toMatchObject({ opcionId: r.datos.opcionId, numero: 1, tipoDeDiferencia: "MONTO", porcentaje: null, factorEscala: null, creadoPorId: e.usuarioId });
      expect(Number(v.diferenciaPrecio)).toBe(120.5);
      expect(v.creadoEn.getTime()).toBe(actor().ahora.getTime());
      expect(v.consumos.map((c) => ({ efecto: c.efecto, unidadId: c.unidadId, cantidad: Number(c.cantidad), merma: Number(c.mermaPorcentaje), escala: c.escalaConLaMedida, orden: c.orden }))).toEqual([
        { efecto: "REEMPLAZA", unidadId: kg, cantidad: 0.25, merma: 2.5, escala: true, orden: 0 },
      ]);
      const filas = await prisma.registroAuditoria.findMany({ where: { entidadId: { in: [r.datos.opcionId, r.datos.versionDeOpcionId] } }, select: { entidad: true, campo: true, valorAnterior: true, valorNuevo: true, descripcion: true } });
      expect(filas.filter((f) => f.entidad === "OpcionDeGrupo").map((f) => [f.campo, f.valorNuevo]).sort()).toEqual([["esNinguna", "false"], ["nombre", "Avena"], ["orden", "3"]]);
      expect(filas.filter((f) => f.entidad === "VersionDeOpcion").map((f) => [f.campo, f.valorAnterior, f.valorNuevo]).sort()).toEqual([
        ["diferenciaPrecio", null, "120.5"],
        ["numero", null, "1"],
        ["tipoDeDiferencia", null, "MONTO"],
      ]);
      expect(filas.find((f) => f.entidad === "VersionDeOpcion")!.descripcion).toMatch(/reemplaza «Leche» por 0.25 de «Bebida de avena», merma 2.5 %, escala con el tamaño/);
    });

    it("idempotente por estado: el mismo alta repetida (aunque cambien las mayúsculas) devuelve la MISMA opción; con otro contenido, NOMBRE_REPETIDO", async () => {
      const comando = { grupoId: e.grupoVarianteId, nombre: "Coco", orden: 4, esNinguna: false, ancla: null, version: sinConsumos(MONTO(80)) };
      const a = await crearOpcionDeGrupoCasoDeUso(actor(), comando, azarDelProceso);
      const auditoria = await prisma.registroAuditoria.count();
      const b = await crearOpcionDeGrupoCasoDeUso(actor(), { ...comando, nombre: "COCO" }, azarDelProceso);
      expect(b).toMatchObject({ ok: true, datos: { yaExistia: true } });
      expect(a.ok && b.ok && a.datos.opcionId === b.datos.opcionId && a.datos.versionDeOpcionId === b.datos.versionDeOpcionId).toBe(true);
      expect(await prisma.registroAuditoria.count()).toBe(auditoria);
      expect(await crearOpcionDeGrupoCasoDeUso(actor(), { ...comando, version: sinConsumos(MONTO(90)) }, azarDelProceso)).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await prisma.opcionDeGrupo.count({ where: { grupoId: e.grupoVarianteId } })).toBe(3);
    });

    it("las reglas del tipo: «ninguna» en una MEDIDA, una segunda «ninguna», una INCLUIDA con recargo, un factor fuera de la MEDIDA y un ADICIONAL sin ancla → CONFIGURACION_INVALIDA, sin escribir", async () => {
      const opciones = await prisma.opcionDeGrupo.count();
      const casos = [
        { grupoId: e.grupoMedidaId, nombre: "Sin tamaño", orden: 0, esNinguna: true, ancla: null, version: sinConsumos() },
        { grupoId: e.grupoIncluidaId, nombre: "Con recargo", orden: 0, esNinguna: false, ancla: null, version: sinConsumos(MONTO(10)) },
        { grupoId: e.grupoVarianteId, nombre: "Con factor", orden: 0, esNinguna: false, ancla: null, version: sinConsumos(MONTO(0), 1.5) },
        { grupoId: e.grupoAdicionalId, nombre: "Sin ancla", orden: 0, esNinguna: false, ancla: null, version: sinConsumos(MONTO(100)) },
      ];
      for (const c of casos) expect(await crearOpcionDeGrupoCasoDeUso(actor(), c, azarDelProceso), c.nombre).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(await crearOpcionDeGrupoCasoDeUso(actor(), { grupoId: e.grupoIncluidaId, nombre: "Sin azúcar", orden: 9, esNinguna: true, ancla: null, version: sinConsumos() }, azarDelProceso)).toMatchObject({ ok: true });
      expect(await crearOpcionDeGrupoCasoDeUso(actor(), { grupoId: e.grupoIncluidaId, nombre: "Nada", orden: 9, esNinguna: true, ancla: null, version: sinConsumos() }, azarDelProceso)).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(await prisma.opcionDeGrupo.count()).toBe(opciones + 1);
    });

    it("los insumos: uno que no es materia prima, uno que no existe o uno de OTRA empresa → REFERENCIA_NO_ENCONTRADA, sin escribir", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const u = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const ajeno = await testigo.producto.create({ data: { codigo: "MP_X", nombre: "Ajeno", tipo: "MP", unidadStockId: u.id } });
      const con = (insumo: string) => ({ grupoId: e.grupoVarianteId, nombre: `Con ${insumo}`, orden: 0, esNinguna: false, ancla: null, version: { diferencia: MONTO(0), factorEscala: null, consumos: [{ efecto: "SUMA" as const, insumoProductoId: insumo, reemplazaAProductoId: null, cantidad: 1, mermaPorcentaje: 0, escalaConLaMedida: false }] } });
      for (const insumo of [e.cafeId, "no-existe", ajeno.id]) {
        expect(await crearOpcionDeGrupoCasoDeUso(actor(), con(insumo), azarDelProceso), insumo).toMatchObject({ ok: false, codigo: "REFERENCIA_NO_ENCONTRADA" });
      }
      expect(await prisma.opcionDeGrupo.count({ where: { grupoId: e.grupoVarianteId } })).toBe(2);
    });

    it("D-3: los consumos exigen el módulo Recetas (apagado junto con Producción y Salón, que lo requieren); sin consumos, la opción se crea igual", async () => {
      // Salón exige Recetas desde la decisión del dueño del 2026-10-29: si quedara activo, Recetas quedaría efectivo («incluido por Salón»).
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, MODULOS_VENDIBLES.filter((m) => m !== "recetas" && m !== "produccion" && m !== "salon"));
      const conConsumo = { grupoId: e.grupoVarianteId, nombre: "Soja", orden: 5, esNinguna: false, ancla: null, version: { diferencia: MONTO(0), factorEscala: null, consumos: [{ efecto: "SUMA" as const, insumoProductoId: e.lecheId, reemplazaAProductoId: null, cantidad: 1, mermaPorcentaje: 0, escalaConLaMedida: false }] } };
      expect(await crearOpcionDeGrupoCasoDeUso(actor(), conConsumo, azarDelProceso)).toMatchObject({ ok: false, codigo: "MODULO_RECETAS_INACTIVO" });
      expect(await crearOpcionDeGrupoCasoDeUso(actor(), { ...conConsumo, version: sinConsumos() }, azarDelProceso)).toMatchObject({ ok: true });
    });

    it("GRUPO_NO_ENCONTRADO con un grupo que no existe o es de otra empresa", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const ajeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
      for (const grupoId of ["no-existe", ajeno.id]) {
        expect(await crearOpcionDeGrupoCasoDeUso(actor(), { grupoId, nombre: "X", orden: 0, esNinguna: false, ancla: null, version: sinConsumos() }, azarDelProceso)).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
      }
      expect(await prismaAdmin.opcionDeGrupo.count({ where: { grupoId: ajeno.id } })).toBe(0);
    });
  });

  describe("editar una opción", () => {
    it("nombre, orden y activa con la versión esperada: audita solo lo que cambia; sin cambios no escribe; con la versión vieja y otro cambio, VERSION_DESACTUALIZADA", async () => {
      const r = await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca entera", orden: 1, activa: true });
      expect(r).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true } });
      expect(await prisma.registroAuditoria.findMany({ where: { entidad: "OpcionDeGrupo", entidadId: e.vacaId }, select: { campo: true, valorAnterior: true, valorNuevo: true } })).toEqual([
        { campo: "nombre", valorAnterior: "De vaca", valorNuevo: "De vaca entera" },
      ]);
      expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca entera", orden: 1, activa: true })).toMatchObject({ ok: true, datos: { huboCambio: false, version: 2 } });
      expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "Vaca", orden: 1, activa: true })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 2, nombre: "almendras", orden: 1, activa: true })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: "no-existe", versionEsperada: 1, nombre: "X", orden: 0, activa: true })).toMatchObject({ ok: false, codigo: "OPCION_NO_ENCONTRADA" });
    });

    it("D-4: apagar la única opción de una INCLUIDA obligatoria avisa que el producto queda sin poder venderse (no se bloquea)", async () => {
      const r = await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.azucarId, versionEsperada: 1, nombre: "Azúcar", orden: 1, activa: false });
      expect(r).toMatchObject({ ok: true, datos: { productosAfectados: 1 } });
      expect(r.mensaje).toMatch(/1 producto que lo admite queda sin poder venderse/);
    });
  });

  describe("agregar una versión", () => {
    it("la vigente + 1, con el antes y el después contra la vigente anterior; rige desde que se carga (su creadoEn es la hora del pedido)", async () => {
      const despues = new Date(actor().ahora.getTime() + 3_600_000);
      const r = await agregarVersionDeOpcionCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA, despues), { opcionId: e.grandeId, numeroEsperado: 1, version: sinConsumos({ tipo: "PORCENTAJE", porcentaje: 12.5 } as never, 1.75) });
      expect(r).toMatchObject({ ok: true, datos: { numero: 2, yaExistia: false } });
      if (!r.ok) return;
      const v = await prisma.versionDeOpcion.findUniqueOrThrow({ where: { id: r.datos.versionDeOpcionId } });
      expect(v.creadoEn.getTime()).toBe(despues.getTime());
      expect((await prisma.versionDeOpcion.findMany({ where: { opcionId: e.grandeId }, orderBy: { numero: "asc" } })).map((x) => x.numero)).toEqual([1, 2]);
      const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "VersionDeOpcion", entidadId: r.datos.versionDeOpcionId }, orderBy: { campo: "asc" }, select: { campo: true, valorAnterior: true, valorNuevo: true } });
      expect(filas).toEqual([
        { campo: "diferenciaPrecio", valorAnterior: "100", valorNuevo: null },
        { campo: "factorEscala", valorAnterior: "1.5", valorNuevo: "1.75" },
        { campo: "numero", valorAnterior: "1", valorNuevo: "2" },
        { campo: "porcentaje", valorAnterior: null, valorNuevo: "12.5" },
        { campo: "tipoDeDiferencia", valorAnterior: "MONTO", valorNuevo: "PORCENTAJE" },
      ]);
    });

    it("idempotente: el MISMO pedido repetido no agrega otra versión; uno de otra persona o con otro contenido sobre la versión vieja da VERSION_DESACTUALIZADA", async () => {
      const comando = { opcionId: e.almendrasId, numeroEsperado: 1, version: sinConsumos(MONTO(175)) };
      const a = await agregarVersionDeOpcionCasoDeUso(actor(), comando);
      const auditoria = await prisma.registroAuditoria.count();
      const b = await agregarVersionDeOpcionCasoDeUso(actor(), comando);
      expect(b).toMatchObject({ ok: true, datos: { numero: 2, yaExistia: true } });
      expect(a.ok && b.ok && a.datos.versionDeOpcionId === b.datos.versionDeOpcionId).toBe(true);
      expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.almendrasId } })).toBe(2);
      expect(await prisma.registroAuditoria.count()).toBe(auditoria);
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { ...comando, version: sinConsumos(MONTO(180)) })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await agregarVersionDeOpcionCasoDeUso(actorDePrueba(operadorId, e.sucursalA), comando)).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      // Pedir una versión con el mismo contenido que la vigente no agrega una versión vacía.
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { ...comando, numeroEsperado: 2 })).toMatchObject({ ok: true, datos: { numero: 2, yaExistia: true } });
      expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.almendrasId } })).toBe(2);
    });

    it("las reglas del tipo sobre la versión nueva: INCLUIDA con recargo, ADICIONAL en porcentaje, ADICIONAL que reemplaza un insumo → CONFIGURACION_INVALIDA; OPCION_NO_ENCONTRADA", async () => {
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.azucarId, numeroEsperado: 1, version: sinConsumos(MONTO(5)) })).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.shotId, numeroEsperado: 1, version: sinConsumos({ tipo: "PORCENTAJE", porcentaje: 10 } as never) })).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.shotId, numeroEsperado: 1, version: { diferencia: MONTO(250), factorEscala: null, consumos: [{ efecto: "REEMPLAZA", insumoProductoId: e.lecheId, reemplazaAProductoId: e.lecheId, cantidad: 1, mermaPorcentaje: 0, escalaConLaMedida: false }] } })).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: "no-existe", numeroEsperado: 1, version: sinConsumos() })).toMatchObject({ ok: false, codigo: "OPCION_NO_ENCONTRADA" });
      expect(await prisma.versionDeOpcion.count({ where: { numero: 2 } })).toBe(0);
    });
  });

  describe("las Server Actions: la clave en el servidor y el guard", () => {
    it("el admin crea, edita y versiona; el operador (sin `opciones_definir`) recibe el rechazo y no se escribe nada", async () => {
      expect(await crearOpcionDeGrupo({ grupoId: e.grupoVarianteId, nombre: "Soja", orden: 3, esNinguna: false, ancla: null, version: { diferencia: { tipo: "MONTO", monto: "90,5" }, factorEscala: null, consumos: [] } })).toMatchObject({ ok: true });
      const soja = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { nombre: "Soja" }, include: { versiones: true } });
      expect(Number(soja.versiones[0]!.diferenciaPrecio)).toBe(90.5);
      expect(await editarOpcionDeGrupo({ opcionId: soja.id, versionEsperada: 1, nombre: "Soja", orden: 2, activa: true })).toMatchObject({ ok: true });
      expect(await agregarVersionDeOpcion({ opcionId: soja.id, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 95 }, factorEscala: null, consumos: [] } })).toMatchObject({ ok: true });

      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const versiones = await prisma.versionDeOpcion.count();
      for (const r of [
        await crearOpcionDeGrupo({ grupoId: e.grupoVarianteId, nombre: "Arroz", orden: 4, esNinguna: false, ancla: null, version: { diferencia: { tipo: "MONTO", monto: 0 }, factorEscala: null, consumos: [] } }),
        await editarOpcionDeGrupo({ opcionId: soja.id, versionEsperada: 2, nombre: "Pisada", orden: 2, activa: false }),
        await agregarVersionDeOpcion({ opcionId: soja.id, numeroEsperado: 2, version: { diferencia: { tipo: "MONTO", monto: 1 }, factorEscala: null, consumos: [] } }),
      ]) {
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/opciones_definir/);
      }
      expect(await prisma.versionDeOpcion.count()).toBe(versiones);
      expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: soja.id } })).nombre).toBe("Soja");
    });

    it("un monto con 3 decimales se rechaza en el guard (no se redondea) y no llega a la base", async () => {
      expect(await agregarVersionDeOpcion({ opcionId: e.almendrasId, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 150.005 }, factorEscala: null, consumos: [] } })).toEqual({
        ok: false,
        mensaje: "El monto de la diferencia de precio admite como máximo 2 decimales.",
      });
      expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.almendrasId } })).toBe(1);
    });
  });
});
