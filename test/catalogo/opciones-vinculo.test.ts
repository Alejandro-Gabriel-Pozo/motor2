import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { vincularGrupoEnProducto } from "../../src/server/actions/catalogo/opciones-de-venta";
import { vincularGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/vincular-grupo-en-producto";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";
import { guardComandoVincularGrupoEnProducto } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";

/**
 * OPCIONES-LIMPIEZA: QUITAR un grupo de un producto y VOLVER A VINCULARLO (`vincularGrupoEnProducto`, clave `producto_opciones_admitidas`). Contra Postgres real, como `motor2_app`.
 * Quitar no borra nada (la base no tiene DELETE para la app): `activo = false`, con lo que el producto admitía de cada opción intacto; volver a vincular lo deja como estaba, con las
 * mismas reglas que guardar el formulario (un grupo archivado no se vuelve a vincular). Por estado (dos veces no duplica), auditado, aislado por empresa, con la clave en el servidor y
 * en concurrencia real (loop de 10).
 */
const ITERACIONES = 10;

describe("quitar un grupo de un producto y volver a vincularlo (OPCIONES-LIMPIEZA)", () => {
  let e: EscenarioDeOpciones;
  let operadorId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const vincular = (vinculado: boolean, grupoId = e.grupoVarianteId, productoId = e.cafeId) => vincularGrupoEnProductoCasoDeUso(actor(), { productoId, grupoId, vinculado });
  const fila = () => prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoVarianteId } }, select: { id: true, activo: true, version: true, orden: true } });
  const filasDeOpciones = () =>
    prisma.productoAdmiteOpcion.findMany({ where: { productoId: e.cafeId, opcionId: { in: [e.vacaId, e.almendrasId] } }, orderBy: { opcionId: "asc" }, select: { opcionId: true, activo: true, version: true, cantidadMaxima: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  it("quitar: el producto deja de ofrecer el grupo, lo que admitía de cada opción queda intacto y una auditoría; volver a vincular lo deja como estaba", async () => {
    const opcionesAntes = await filasDeOpciones();
    const quitado = await vincular(false);
    expect(quitado).toEqual({ ok: true, mensaje: "«Leche» se quitó de «Café». No se borró nada: lo que admitía queda guardado.", datos: { huboCambio: true } });
    expect(await fila()).toMatchObject({ activo: false, version: 2 });
    expect(await filasDeOpciones()).toEqual(opcionesAntes);
    const { id } = await fila();
    expect(await prisma.registroAuditoria.findMany({ where: { entidadId: id }, select: { entidad: true, campo: true, valorAnterior: true, valorNuevo: true, actorId: true } })).toEqual([
      { entidad: "ProductoAdmiteGrupo", campo: "activo", valorAnterior: "true", valorNuevo: "false", actorId: e.usuarioId },
    ]);
    const paraVender = await cargarOpcionesParaVender(actor().db, { sucursalId: e.sucursalA, productoIds: [e.cafeId] });
    expect(paraVender.get(e.cafeId)!.grupos.find((g) => g.grupoId === e.grupoVarianteId)).toMatchObject({ admitido: false });

    const vuelto = await vincular(true);
    expect(vuelto).toEqual({ ok: true, mensaje: "«Leche» volvió a «Café», como estaba.", datos: { huboCambio: true } });
    expect(await fila()).toMatchObject({ activo: true, version: 3 });
    expect(await filasDeOpciones()).toEqual(opcionesAntes);
    expect((await prisma.registroAuditoria.findMany({ where: { entidadId: id }, orderBy: { creadoEn: "asc" }, select: { campo: true, valorNuevo: true } })).map((a) => [a.campo, a.valorNuevo])).toEqual([
      ["activo", "false"],
      ["activo", "true"],
    ]);
  });

  it("por estado: quitar dos veces (o volver a vincular dos veces) no escribe ni audita la segunda", async () => {
    await vincular(false);
    const auditorias = await prisma.registroAuditoria.count();
    expect(await vincular(false)).toEqual({ ok: true, mensaje: "«Leche» ya estaba quitado de «Café».", datos: { huboCambio: false } });
    await vincular(true);
    const despues = await prisma.registroAuditoria.count();
    expect(despues).toBeGreaterThan(auditorias);
    expect(await vincular(true)).toEqual({ ok: true, mensaje: "«Leche» ya estaba en «Café».", datos: { huboCambio: false } });
    expect(await prisma.registroAuditoria.count()).toBe(despues);
    expect((await fila()).version).toBe(3);
  });

  it("un grupo archivado no se vuelve a vincular (mismas reglas que el formulario): queda quitado y el mensaje dice cómo restaurarlo", async () => {
    await vincular(false);
    await archivarOpcionesCasoDeUso(actor(), { grupoIds: [e.grupoVarianteId], opcionIds: [], archivar: true });
    const r = await vincular(true);
    expect(r).toMatchObject({ ok: false, codigo: "GRUPO_INACTIVO" });
    expect(r.mensaje).toMatch(/está archivado: restauralo/);
    expect((await fila()).activo).toBe(false);
  });

  it("sin fila no hay nada que quitar: un grupo que el producto nunca tuvo, o un producto de OTRA empresa, se rechazan sin escribir", async () => {
    const nuevo = await prisma.grupoDeOpciones.create({ data: { nombre: "Salsas", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const r = await vincular(false, nuevo.id);
    expect(r).toMatchObject({ ok: false, codigo: "NO_VINCULADO", mensaje: "No se encontró ese grupo en este producto: si nunca lo tuvo, agregalo desde «Agregar grupo»." });

    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const ajeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidad.id } });
    const grupoAjeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const admision = await testigo.productoAdmiteGrupo.create({ data: { productoId: ajeno.id, grupoId: grupoAjeno.id } });
    expect(await vincular(false, grupoAjeno.id, ajeno.id)).toMatchObject({ ok: false, codigo: "NO_VINCULADO" });
    expect(await testigo.productoAdmiteGrupo.findUniqueOrThrow({ where: { id: admision.id } })).toMatchObject({ activo: true, version: 1 });
  });

  it("la Server Action: el operador (sin `producto_opciones_admitidas`) recibe el rechazo y no cambia nada; el guard rechaza lo mal formado", async () => {
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const r = await vincularGrupoEnProducto({ productoId: e.cafeId, grupoId: e.grupoVarianteId, vinculado: false });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/producto_opciones_admitidas/);
    expect((await fila()).activo).toBe(true);
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
    expect(await vincularGrupoEnProducto({ productoId: e.cafeId, grupoId: e.grupoVarianteId, vinculado: false })).toMatchObject({ ok: true });
    expect(guardComandoVincularGrupoEnProducto({ productoId: e.cafeId, grupoId: e.grupoVarianteId, vinculado: "no" }).ok).toBe(false);
    expect(guardComandoVincularGrupoEnProducto({ productoId: "", grupoId: e.grupoVarianteId, vinculado: true }).ok).toBe(false);
    expect(await vincularGrupoEnProducto({ productoId: e.cafeId, grupoId: 7, vinculado: true })).toEqual({ ok: false, mensaje: "No se encontró el grupo de opciones." });
  });

  describe("concurrencia real (Promise.allSettled, loop de 10)", () => {
    it("dos «quitar» a la vez: uno cambia y el otro ve que ya estaba; UNA auditoría por vuelta y la versión sube de a una", async () => {
      const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
      intentos.mockClear();
      const { id } = await fila();
      for (let i = 0; i < ITERACIONES; i++) {
        const vinculado = i % 2 === 1;
        const antes = await prisma.registroAuditoria.count({ where: { entidadId: id } });
        const resultados = await Promise.allSettled([vincular(vinculado), vincular(vinculado)]);
        expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `vuelta ${i}: ${JSON.stringify(resultados)}`).toBe(true);
        const cambios = resultados.map((s) => (s.status === "fulfilled" && s.value.ok ? s.value.datos.huboCambio : null));
        expect(cambios.sort()).toEqual([false, true]);
        expect(await fila()).toMatchObject({ activo: vinculado, version: i + 2 });
        expect(await prisma.registroAuditoria.count({ where: { entidadId: id, campo: "activo" } })).toBe(antes + 1);
      }
      const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
      expect(transacciones, "en ninguna vuelta chocaron: el test no ejercitó el reintento").toBeGreaterThan(2 * ITERACIONES);
      intentos.mockRestore();
    });

    it("«quitar» contra guardar el formulario del grupo con la versión de antes: el quitar NUNCA se pierde (o el formulario entra antes, o se rechaza por la versión)", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await vincular(true);
        const vista = await fila();
        const [quitar, formulario] = await Promise.allSettled([
          vincular(false),
          fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), {
            productoId: e.cafeId,
            grupoId: e.grupoVarianteId,
            versionEsperada: vista.version,
            orden: vista.orden + i + 1,
            cantidadMinima: null,
            cantidadMaxima: null,
            modoPrecio: null,
            activo: true,
            opciones: [],
          }),
        ]);
        expect(quitar.status === "fulfilled" && quitar.value.ok, `vuelta ${i}`).toBe(true);
        expect(formulario.status, `vuelta ${i}`).toBe("fulfilled");
        if (formulario.status === "fulfilled" && !formulario.value.ok) expect(formulario.value.codigo).toBe("VERSION_DESACTUALIZADA");
        const final = await fila();
        expect(final.activo, `vuelta ${i}: el formulario pisó el «quitar»`).toBe(false);
        expect(final.version).toBe(vista.version + (formulario.status === "fulfilled" && formulario.value.ok ? 2 : 1));
      }
    });
  });
});
