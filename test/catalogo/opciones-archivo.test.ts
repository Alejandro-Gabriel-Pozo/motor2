import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, sembrarLineaConOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { archivarOpciones, editarOpcionDeGrupo } from "../../src/server/actions/catalogo/opciones-de-venta";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";
import { guardComandoArchivarOpciones } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import { listarGruposDeOpciones } from "../../src/server/lecturas/catalogo/opciones-de-venta";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";

/**
 * OPCIONES-LIMPIEZA (decisión del dueño, 2026-10-14): ARCHIVAR y RESTAURAR grupos y opciones de venta (`archivarOpciones`, clave `opciones_definir`). Contra Postgres real, como
 * `motor2_app` (con la RLS). Fija: lo archivado deja de ofrecerse en la venta y en el catálogo activo por la vía que ya existe y vuelve con «Restaurar»; una auditoría por elemento con
 * el antes y el después; idempotencia por estado (dos veces no duplica ni falla); el lote es TODO O NADA (un id ajeno o inexistente no deja nada a medias); D-4 (avisa a cuántos
 * productos deja sin vender, sin bloquear); lo YA VENDIDO no cambia nunca; la clave en el servidor y el guard.
 */
describe("archivar y restaurar grupos y opciones (OPCIONES-LIMPIEZA)", () => {
  let e: EscenarioDeOpciones;
  let operadorId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const archivar = (grupoIds: string[], opcionIds: string[], valor = true) => archivarOpcionesCasoDeUso(actor(), { grupoIds, opcionIds, archivar: valor });
  const auditoriaDe = (entidadId: string) =>
    prisma.registroAuditoria.findMany({ where: { entidadId }, orderBy: { creadoEn: "asc" }, select: { entidad: true, campo: true, valorAnterior: true, valorNuevo: true, actorId: true, sucursalId: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  it("archivar un grupo: deja de ofrecerse en la venta y en el catálogo activo, sube la versión y deja una auditoría; restaurar lo deja como estaba", async () => {
    const r = await archivar([e.grupoVarianteId], []);
    expect(r).toMatchObject({ ok: true, datos: { cambiados: 1, productosAfectados: 0 } });
    expect(r.mensaje).toBe("Grupo «Leche» archivado. Se puede restaurar desde «Archivados».");
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId }, select: { activo: true, version: true } })).toEqual({ activo: false, version: 2 });
    expect(await auditoriaDe(e.grupoVarianteId)).toEqual([{ entidad: "GrupoDeOpciones", campo: "activo", valorAnterior: "true", valorNuevo: "false", actorId: e.usuarioId, sucursalId: null }]);

    // La venta (la misma lectura del POS) ya no lo ofrece, y el catálogo activo tampoco lo lista. Las opciones del grupo siguen intactas.
    const paraVender = await cargarOpcionesParaVender(actor().db, { sucursalId: e.sucursalA, productoIds: [e.cafeId] });
    expect(paraVender.get(e.cafeId)!.grupos.find((g) => g.grupoId === e.grupoVarianteId)).toMatchObject({ activo: false });
    expect((await listarGruposDeOpciones(actor().db, { incluirInactivos: false })).map((g) => g.id)).not.toContain(e.grupoVarianteId);
    expect(await prisma.opcionDeGrupo.count({ where: { grupoId: e.grupoVarianteId, activa: true } })).toBe(2);

    const restaurado = await archivar([e.grupoVarianteId], [], false);
    expect(restaurado).toMatchObject({ ok: true, mensaje: "Grupo «Leche» restaurado.", datos: { cambiados: 1 } });
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId }, select: { activo: true, version: true } })).toEqual({ activo: true, version: 3 });
    expect((await auditoriaDe(e.grupoVarianteId)).map((a) => [a.valorAnterior, a.valorNuevo])).toEqual([
      ["true", "false"],
      ["false", "true"],
    ]);
    expect((await cargarOpcionesParaVender(actor().db, { sucursalId: e.sucursalA, productoIds: [e.cafeId] })).get(e.cafeId)!.grupos.find((g) => g.grupoId === e.grupoVarianteId)).toMatchObject({ activo: true });
  });

  it("idempotente por estado: archivar dos veces (o restaurar dos veces) no escribe, no sube la versión ni audita la segunda vez", async () => {
    await archivar([], [e.almendrasId]);
    const auditorias = await prisma.registroAuditoria.count();
    const segunda = await archivar([], [e.almendrasId]);
    expect(segunda).toEqual({ ok: true, mensaje: "La opción «Almendras» ya estaba archivada.", datos: { cambiados: 0, productosAfectados: 0 } });
    expect(await prisma.registroAuditoria.count()).toBe(auditorias);
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.almendrasId } })).version).toBe(2);

    await archivar([], [e.almendrasId], false);
    const otraVez = await archivar([], [e.almendrasId], false);
    expect(otraVez).toMatchObject({ ok: true, mensaje: "La opción «Almendras» ya estaba en uso.", datos: { cambiados: 0 } });
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.almendrasId } })).version).toBe(3);
    // Un lote donde algunos ya estaban: solo cambian (y se auditan) los que faltaban.
    await archivar([], [e.vacaId]);
    const mixto = await archivar([], [e.vacaId, e.almendrasId]);
    expect(mixto).toMatchObject({ ok: true, mensaje: "Opción «Almendras» archivada. Se puede restaurar desde «Archivados».", datos: { cambiados: 1 } });
  });

  it("un lote es TODO O NADA: con un id inexistente o de OTRA empresa no se toca ninguno (ni el propio), y la fila ajena queda igual", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const antes = await prisma.registroAuditoria.count();
    for (const comando of [
      { grupoIds: [e.grupoVarianteId, ajeno.id], opcionIds: [e.chicoId] },
      { grupoIds: [e.grupoVarianteId], opcionIds: [e.chicoId, "cl-no-existe-00000000000"] },
    ]) {
      const r = await archivarOpcionesCasoDeUso(actor(), { ...comando, archivar: true });
      expect(r).toMatchObject({ ok: false, codigo: "NO_ENCONTRADO" });
      if (!r.ok) expect(r.mensaje).toMatch(/^No se encontró alguno de los grupos u opciones elegidos: recargá la pantalla\. No se cambió nada\.$/);
    }
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId }, select: { activo: true, version: true } })).toEqual({ activo: true, version: 1 });
    expect(await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.chicoId }, select: { activa: true, version: true } })).toEqual({ activa: true, version: 1 });
    expect(await testigo.grupoDeOpciones.findUniqueOrThrow({ where: { id: ajeno.id } })).toMatchObject({ activo: true, version: 1 });
    expect(await prisma.registroAuditoria.count()).toBe(antes);
  });

  it("un lote mixto (grupos y opciones de varios grupos) archiva todo junto, con UNA auditoría por elemento, y se deshace con el mismo pedido", async () => {
    const r = await archivar([e.grupoAdicionalId], [e.vacaId, e.azucarId]);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/^Archivados: 1 grupo y 2 opciones\./), datos: { cambiados: 3 } });
    const filas = await prisma.registroAuditoria.findMany({ where: { entidadId: { in: [e.grupoAdicionalId, e.vacaId, e.azucarId] } }, select: { entidad: true, entidadId: true, campo: true } });
    expect(filas.map((f) => `${f.entidad}.${f.campo}`).sort()).toEqual(["GrupoDeOpciones.activo", "OpcionDeGrupo.activa", "OpcionDeGrupo.activa"]);
    const deshecho = await archivar([e.grupoAdicionalId], [e.vacaId, e.azucarId], false);
    expect(deshecho).toMatchObject({ ok: true, mensaje: "Restaurados: 1 grupo y 2 opciones.", datos: { cambiados: 3 } });
    expect(await prisma.opcionDeGrupo.count({ where: { id: { in: [e.vacaId, e.azucarId] }, activa: true } })).toBe(2);
    expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoAdicionalId } })).activo).toBe(true);
  });

  it("D-4: archivar el tamaño (obligatorio) o todas sus opciones no se bloquea: avisa que el café queda sin poder venderse, contándolo UNA vez", async () => {
    const grupo = await archivar([e.grupoMedidaId], []);
    expect(grupo).toMatchObject({ ok: true, datos: { productosAfectados: 1 } });
    expect(grupo.mensaje).toContain("Atención: 1 producto que lo admite queda sin poder venderse");
    await archivar([e.grupoMedidaId], [], false);
    const opciones = await archivar([e.grupoMedidaId], [e.chicoId, e.medianoId, e.grandeId]);
    expect(opciones).toMatchObject({ ok: true, datos: { cambiados: 4, productosAfectados: 1 } });
    // Una opcional (la leche) no deja a nadie sin vender.
    expect(await archivar([e.grupoVarianteId], [])).toMatchObject({ ok: true, datos: { productosAfectados: 0 } });
  });

  it("restaurar una opción de un grupo que sigue archivado avisa que el grupo también hay que restaurarlo", async () => {
    await archivar([e.grupoVarianteId], [e.almendrasId]);
    const r = await archivar([], [e.almendrasId], false);
    expect(r).toMatchObject({ ok: true, mensaje: "Opción «Almendras» restaurada. Ojo: «Leche» sigue archivado; restauralo para que se vuelva a ofrecer." });
  });

  it("lo YA VENDIDO no cambia: la foto de la línea (nombre, versión e importe) y la versión de la opción quedan como se vendieron", async () => {
    const linea = await sembrarLineaConOpciones(e.cuentaAId, e);
    const foto = await prisma.opcionElegidaEnLinea.create({
      data: {
        cuentaItemId: linea.id,
        grupoId: e.grupoVarianteId,
        opcionId: e.almendrasId,
        versionDeOpcionId: e.versionDe[e.almendrasId]!,
        tipoGrupo: "VARIANTE",
        nombreGrupo: "Leche",
        nombreOpcion: "Almendras",
        tipoDeDiferencia: "MONTO",
        importeUnitario: "150.00",
      },
    });
    const version = await prisma.versionDeOpcion.findUniqueOrThrow({ where: { id: e.versionDe[e.almendrasId]! } });
    expect(await archivar([e.grupoVarianteId], [e.almendrasId])).toMatchObject({ ok: true, datos: { cambiados: 2 } });
    expect(await prisma.opcionElegidaEnLinea.findUniqueOrThrow({ where: { id: foto.id } })).toEqual(foto);
    expect(await prisma.versionDeOpcion.findUniqueOrThrow({ where: { id: version.id } })).toEqual(version);
    expect(await prisma.cuentaItem.findUniqueOrThrow({ where: { id: linea.id } })).toEqual(linea);
  });

  it("archivar sube la versión: una edición abierta antes (otra pestaña) recibe «cambió mientras la editabas» y no pisa el archivo", async () => {
    await archivar([], [e.grandeId]);
    const r = await editarOpcionDeGrupo({ opcionId: e.grandeId, versionEsperada: 1, nombre: "Gigante", orden: 3, activa: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toMatch(/cambió mientras la editabas/);
    expect(await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.grandeId }, select: { nombre: true, activa: true } })).toEqual({ nombre: "Grande", activa: false });
  });

  describe("la Server Action: la clave en el servidor y el guard", () => {
    it("el operador (sin `opciones_definir`) recibe el rechazo del gate y no cambia nada; el admin archiva y a la pantalla solo llegan ok y mensaje", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const r = await archivarOpciones({ grupoIds: [e.grupoVarianteId], opcionIds: [], archivar: true });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/opciones_definir/);
      expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId } })).activo).toBe(true);
      expect(await prisma.registroAuditoria.count({ where: { entidadId: e.grupoVarianteId } })).toBe(0);

      await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
      expect(await archivarOpciones({ grupoIds: [e.grupoVarianteId], opcionIds: [], archivar: true })).toEqual({ ok: true, mensaje: "Grupo «Leche» archivado. Se puede restaurar desde «Archivados»." });
    });

    it("el guard: al menos un elemento, ids de forma válida, sin repetidos, hasta 200 por vez y `archivar` sí o no", async () => {
      expect(guardComandoArchivarOpciones({ grupoIds: [], opcionIds: [], archivar: true })).toMatchObject({ ok: false, mensaje: "Elegí al menos un grupo o una opción." });
      expect(guardComandoArchivarOpciones({ grupoIds: "todos", opcionIds: [], archivar: true }).ok).toBe(false);
      expect(guardComandoArchivarOpciones({ grupoIds: [42], opcionIds: [], archivar: true }).ok).toBe(false);
      expect(guardComandoArchivarOpciones({ grupoIds: ["g1"], opcionIds: [], archivar: "sí" }).ok).toBe(false);
      expect(guardComandoArchivarOpciones({ grupoIds: ["g1", "g1"], opcionIds: undefined, archivar: false })).toEqual({ ok: true, valor: { grupoIds: ["g1"], opcionIds: [], archivar: false } });
      const muchos = Array.from({ length: 201 }, (_, i) => `o${i}`);
      expect(guardComandoArchivarOpciones({ grupoIds: [], opcionIds: muchos, archivar: true }).ok).toBe(false);
      expect(guardComandoArchivarOpciones({ grupoIds: muchos.slice(0, 100), opcionIds: muchos.slice(100, 200).map((x) => `${x}b`), archivar: true }).ok).toBe(true);
      expect(guardComandoArchivarOpciones({ grupoIds: muchos.slice(0, 100), opcionIds: muchos.slice(100, 201).map((x) => `${x}b`), archivar: true }).ok).toBe(false);
      expect(await archivarOpciones({ grupoIds: [], opcionIds: [], archivar: true })).toEqual({ ok: false, mensaje: "Elegí al menos un grupo o una opción." });
    });
  });
});
