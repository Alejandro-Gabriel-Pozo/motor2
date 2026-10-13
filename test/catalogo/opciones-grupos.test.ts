import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { crearGrupoDeOpciones, editarGrupoDeOpciones } from "../../src/server/actions/catalogo/opciones-de-venta";
import { crearGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-opciones";
import { editarGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones";

/**
 * GO-2a, paso 6: los GRUPOS de opciones de venta (`opciones_definir`). Contra Postgres real, como `motor2_app`. Cada código de error, la auditoría por columna (con el antes y el
 * después, solo de lo que cambió), «sin cambios» no deja fila ni sube la versión, la clave en el servidor (el operador no la tiene), el id de otra empresa y el tipo inmutable.
 */
describe("grupos de opciones de venta (GO-2a)", () => {
  let adminId: string;
  let operadorId: string;
  let sucursalId: string;
  const actor = () => actorDePrueba(adminId, sucursalId);
  const auditoria = (entidadId: string) => prisma.registroAuditoria.findMany({ where: { entidad: "GrupoDeOpciones", entidadId }, orderBy: { campo: "asc" }, select: { campo: true, valorAnterior: true, valorNuevo: true, actorId: true, sucursalId: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
  });

  describe("crear", () => {
    it("crea el grupo y audita el alta por columna (de null al valor), sin sucursal (es de la empresa)", async () => {
      const r = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 });
      expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
      if (!r.ok) return;
      const g = await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: r.datos.grupoId } });
      expect(g).toMatchObject({ nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, activo: true, version: 1 });
      expect(g.creadoEn.getTime()).toBe(actor().ahora.getTime());
      expect(await auditoria(g.id)).toEqual([
        { campo: "cantidadMaxima", valorAnterior: null, valorNuevo: "1", actorId: adminId, sucursalId: null },
        { campo: "cantidadMinima", valorAnterior: null, valorNuevo: "1", actorId: adminId, sucursalId: null },
        { campo: "nombre", valorAnterior: null, valorNuevo: "Tamaño", actorId: adminId, sucursalId: null },
        { campo: "tipo", valorAnterior: null, valorNuevo: "MEDIDA", actorId: adminId, sucursalId: null },
      ]);
    });

    it("las cantidades según el tipo: CONFIGURACION_INVALIDA sin escribir nada", async () => {
      for (const comando of [
        { nombre: "M", tipo: "MEDIDA", cantidadMinima: 0, cantidadMaxima: 1 },
        { nombre: "I", tipo: "INCLUIDA", cantidadMinima: 0, cantidadMaxima: 2 },
        { nombre: "V", tipo: "VARIANTE", cantidadMinima: 3, cantidadMaxima: 2 },
      ] as const) {
        expect(await crearGrupoDeOpcionesCasoDeUso(actor(), comando), comando.nombre).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      }
      expect(await prisma.grupoDeOpciones.count()).toBe(0);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("idempotente por estado: repetir el alta (aunque cambien las mayúsculas) devuelve el MISMO grupo, sin otra fila ni otra auditoría; con otro tipo o cantidades, NOMBRE_REPETIDO", async () => {
      const a = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Leche", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 });
      const b = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "LECHE", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 });
      expect(b).toMatchObject({ ok: true, datos: { yaExistia: true } });
      expect(a.ok && b.ok && a.datos.grupoId === b.datos.grupoId).toBe(true);
      expect(await prisma.grupoDeOpciones.count()).toBe(1);
      expect(await prisma.registroAuditoria.count()).toBe(4);
      expect(await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "leche", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1 })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "leche", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 2 })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await prisma.grupoDeOpciones.count()).toBe(1);
    });
  });

  describe("editar", () => {
    let grupoId: string;
    beforeEach(async () => {
      const r = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 });
      grupoId = r.ok ? r.datos.grupoId : "";
    });

    it("cambia el nombre, las cantidades y si está activo; sube la versión en 1 y audita SOLO lo que cambió, con el antes y el después", async () => {
      const despues = new Date(actor().ahora.getTime() + 60_000);
      const r = await editarGrupoDeOpcionesCasoDeUso(actorDePrueba(adminId, sucursalId, despues), { grupoId, versionEsperada: 1, nombre: "Agregados", cantidadMinima: 0, cantidadMaxima: 2, activo: true });
      expect(r).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true, productosAfectados: 0 } });
      const g = await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } });
      expect(g).toMatchObject({ nombre: "Agregados", cantidadMaxima: 2, version: 2, tipo: "ADICIONAL" });
      expect(g.actualizadoEn.getTime()).toBe(despues.getTime());
      const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "GrupoDeOpciones", entidadId: grupoId, valorAnterior: { not: null } }, orderBy: { campo: "asc" }, select: { campo: true, valorAnterior: true, valorNuevo: true } });
      expect(filas).toEqual([
        { campo: "cantidadMaxima", valorAnterior: "3", valorNuevo: "2" },
        { campo: "nombre", valorAnterior: "Extras", valorNuevo: "Agregados" },
      ]);
    });

    it("sin cambios no escribe, no sube la versión ni audita", async () => {
      const antes = await prisma.registroAuditoria.count();
      const r = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 0, cantidadMaxima: 3, activo: true });
      expect(r).toMatchObject({ ok: true, datos: { version: 1, huboCambio: false } });
      expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } })).version).toBe(1);
      expect(await prisma.registroAuditoria.count()).toBe(antes);
    });

    it("VERSION_DESACTUALIZADA con la versión vieja (otra persona guardó en el medio), sin escribir nada", async () => {
      await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 0, cantidadMaxima: 2, activo: true });
      const antes = await prisma.registroAuditoria.count();
      const r = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 1, cantidadMaxima: 3, activo: true });
      expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } })).toMatchObject({ cantidadMinima: 0, cantidadMaxima: 2, version: 2 });
      expect(await prisma.registroAuditoria.count()).toBe(antes);
    });

    it("GRUPO_NO_ENCONTRADO, NOMBRE_REPETIDO y CONFIGURACION_INVALIDA (el tipo manda: un ADICIONAL no puede pasar a máximo 0)", async () => {
      expect(await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId: "no-existe", versionEsperada: 1, nombre: "X", cantidadMinima: 0, cantidadMaxima: 1, activo: true })).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
      await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Salsas", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 });
      expect(await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "SALSAS", cantidadMinima: 0, cantidadMaxima: 3, activo: true })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 4, cantidadMaxima: 3, activo: true })).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      // Cambiar solo las mayúsculas del propio nombre no choca consigo mismo.
      expect(await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "EXTRAS", cantidadMinima: 0, cantidadMaxima: 3, activo: true })).toMatchObject({ ok: true });
    });

    it("no deja a un producto con cantidades incoherentes: con un mínimo propio de 2, el máximo del grupo no baja a 1 (se lee la admisión dentro de la transacción)", async () => {
      const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
      const cafe = await prisma.producto.create({ data: { codigo: "PV_CAFE", nombre: "Café", tipo: "PV", unidadStockId: unidadId, precioVenta: "1000.00" } });
      await prisma.productoAdmiteGrupo.create({ data: { productoId: cafe.id, grupoId, cantidadMinima: 2 } });
      const r = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 0, cantidadMaxima: 1, activo: true });
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(r.mensaje).toMatch(/«Café»/);
    });

    it("D-4: apagar un grupo que un producto necesita NO se bloquea, pero el mensaje avisa a cuántos productos deja sin poder venderse", async () => {
      const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
      for (const nombre of ["Café", "Té"]) {
        const p = await prisma.producto.create({ data: { codigo: `PV_${nombre}`, nombre, tipo: "PV", unidadStockId: unidadId } });
        await prisma.productoAdmiteGrupo.create({ data: { productoId: p.id, grupoId, cantidadMinima: nombre === "Café" ? 1 : null } });
      }
      const r = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Extras", cantidadMinima: 0, cantidadMaxima: 3, activo: false });
      expect(r).toMatchObject({ ok: true, datos: { productosAfectados: 1 } });
      expect(r.mensaje).toMatch(/1 producto que lo admite queda sin poder venderse/);
    });

    it("un grupo de OTRA empresa no se ve: GRUPO_NO_ENCONTRADO, y la fila ajena no cambia", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const ajeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
      expect(await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId: ajeno.id, versionEsperada: 1, nombre: "Pisado", cantidadMinima: 0, cantidadMaxima: 1, activo: false })).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
      expect(await testigo.grupoDeOpciones.findUniqueOrThrow({ where: { id: ajeno.id } })).toMatchObject({ nombre: "Ajeno", activo: true, version: 1 });
    });
  });

  describe("la Server Action: la clave en el servidor y el guard", () => {
    it("el admin crea y edita; el operador (sin `opciones_definir`) recibe el rechazo del gate y no se escribe nada", async () => {
      expect(await crearGrupoDeOpciones({ nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 })).toEqual({ ok: true, mensaje: "Grupo «Tamaño» creado." });
      const grupoId = (await prisma.grupoDeOpciones.findFirstOrThrow()).id;
      expect(await editarGrupoDeOpciones({ grupoId, versionEsperada: 1, nombre: "Tamaños", cantidadMinima: 1, cantidadMaxima: 1, activo: true })).toMatchObject({ ok: true });

      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const r = await crearGrupoDeOpciones({ nombre: "Leche", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/opciones_definir/);
      expect(await editarGrupoDeOpciones({ grupoId, versionEsperada: 2, nombre: "Pisado", cantidadMinima: 1, cantidadMaxima: 1, activo: false })).toMatchObject({ ok: false });
      expect(await prisma.grupoDeOpciones.count()).toBe(1);
      expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } })).nombre).toBe("Tamaños");
    });

    it("lo que llega de la red pasa por el guard antes de tocar la base (un número que no es entero, un tipo inventado), y a la pantalla solo llegan ok y mensaje", async () => {
      expect(await crearGrupoDeOpciones({ nombre: "X", tipo: "VARIANTE", cantidadMinima: Number.NaN, cantidadMaxima: 1 })).toEqual({ ok: false, mensaje: "El mínimo de opciones no es un número válido." });
      expect(await crearGrupoDeOpciones({ nombre: "X", tipo: "TALLE", cantidadMinima: 0, cantidadMaxima: 1 })).toEqual({ ok: false, mensaje: "El tipo de grupo no es válido." });
      expect(await prisma.grupoDeOpciones.count()).toBe(0);
    });
  });
});
