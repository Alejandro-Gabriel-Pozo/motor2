import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { guardComandoCrearGrupoDeOpciones, guardComandoEditarGrupoDeOpciones } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import { crearGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-opciones";
import { editarGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones";
import { MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA } from "../../src/core/opciones/public";

/**
 * Fase 4 de la ola «precio y carta», C8 (ADR-035, DEC-34): «se lee en la carta como» (`GrupoDeOpciones.prefijoEnCarta`) en el alta y la edición de un grupo, contra Postgres:
 *  - el formato (guard): vacío o solo espacios → NULL; 21 caracteres y espacios a los costados se RECHAZAN (no se recortan), con su mensaje;
 *  - solo VARIANTE y MEDIDA: en INCLUIDA y ADICIONAL, `CONFIGURACION_INVALIDA` sin escribir;
 *  - cada cambio deja su fila de auditoría por columna (`prefijoEnCarta`, del antes al después) y sube la versión; repetir el mismo guardado no escribe ni audita;
 *  - DOS PANTALLAS: la segunda, abierta con la versión vieja, cambia el nombre y arrastra el prefijo viejo → `VERSION_DESACTUALIZADA` y el prefijo nuevo queda;
 *  - un pedido que no manda el prefijo lo deja como estaba.
 */
describe("C8: «se lee en la carta como» del grupo", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
  const crear = async (entrada: { nombre: string; tipo: string; prefijoEnCarta?: unknown }) => {
    const c = guardComandoCrearGrupoDeOpciones({ cantidadMinima: entrada.tipo === "MEDIDA" || entrada.tipo === "INCLUIDA" ? 1 : 0, cantidadMaxima: 1, ...entrada });
    if (!c.ok) return c;
    return crearGrupoDeOpcionesCasoDeUso(actor(), c.valor);
  };
  const grupo = (id: string) => prismaAdmin.grupoDeOpciones.findUniqueOrThrow({ where: { id }, select: { nombre: true, prefijoEnCarta: true, version: true } });
  const auditorias = (id: string) => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "GrupoDeOpciones", entidadId: id, campo: "prefijoEnCarta" }, select: { valorAnterior: true, valorNuevo: true }, orderBy: { creadoEn: "asc" } });
  /** Lo que manda el formulario del grupo con la versión que vio y los cambios encima. */
  const editar = async (id: string, vio: { nombre: string; version: number; prefijoEnCarta?: unknown }) => {
    const c = guardComandoEditarGrupoDeOpciones({ grupoId: id, versionEsperada: vio.version, nombre: vio.nombre, cantidadMinima: 0, cantidadMaxima: 1, activo: true, ...("prefijoEnCarta" in vio ? { prefijoEnCarta: vio.prefijoEnCarta } : {}) });
    if (!c.ok) return c;
    return editarGrupoDeOpcionesCasoDeUso(actor(), c.valor);
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  it("el alta de una VARIANTE con «De» lo guarda y lo audita; repetir el alta igual no crea otro, con otro prefijo es NOMBRE_REPETIDO", async () => {
    const r = await crear({ nombre: "Milanesas de", tipo: "VARIANTE", prefijoEnCarta: "De" });
    expect(r).toMatchObject({ ok: true });
    const id = r.ok && "datos" in r ? r.datos.grupoId : "";
    expect(await grupo(id)).toMatchObject({ prefijoEnCarta: "De", version: 1 });
    expect(await auditorias(id)).toEqual([{ valorAnterior: null, valorNuevo: "De" }]);
    expect(await crear({ nombre: "Milanesas de", tipo: "VARIANTE", prefijoEnCarta: "De" })).toMatchObject({ ok: true, datos: { grupoId: id, yaExistia: true } });
    expect(await crear({ nombre: "milanesas de", tipo: "VARIANTE", prefijoEnCarta: "Con" })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
    // Sin prefijo: NULL, sin fila de auditoría del prefijo.
    const sin = await crear({ nombre: "Tamaño", tipo: "MEDIDA" });
    expect(await grupo(sin.ok && "datos" in sin ? sin.datos.grupoId : "")).toMatchObject({ prefijoEnCarta: null });
  });

  it("solo VARIANTE y MEDIDA: en INCLUIDA y ADICIONAL se rechaza sin escribir (alta y edición)", async () => {
    for (const tipo of ["INCLUIDA", "ADICIONAL"]) {
      expect(await crear({ nombre: `G ${tipo}`, tipo, prefijoEnCarta: "Con" })).toEqual({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA });
    }
    expect(await prisma.grupoDeOpciones.count()).toBe(0);
    const inc = await crear({ nombre: "Guarnición", tipo: "INCLUIDA" });
    const id = inc.ok && "datos" in inc ? inc.datos.grupoId : "";
    const c = guardComandoEditarGrupoDeOpciones({ grupoId: id, versionEsperada: 1, nombre: "Guarnición", cantidadMinima: 1, cantidadMaxima: 1, activo: true, prefijoEnCarta: "Con" });
    expect(c.ok && (await editarGrupoDeOpcionesCasoDeUso(actor(), c.valor))).toEqual({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA });
    expect(await grupo(id)).toMatchObject({ prefijoEnCarta: null, version: 1 });
  });

  it("el formato: vacío o solo espacios → NULL; 21 caracteres o espacios a los costados se rechazan con su mensaje (no se recortan)", async () => {
    const base = { grupoId: "g", versionEsperada: 1, nombre: "G", cantidadMinima: 0, cantidadMaxima: 1, activo: true };
    expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: "" })).toMatchObject({ ok: true, valor: { prefijoEnCarta: null } });
    expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: "   " })).toMatchObject({ ok: true, valor: { prefijoEnCarta: null } });
    expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: "x".repeat(20) })).toMatchObject({ ok: true, valor: { prefijoEnCarta: "x".repeat(20) } });
    expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: "x".repeat(21) })).toMatchObject({ ok: false, mensaje: "«Se lee en la carta como» tiene hasta 20 caracteres: acortalo (por ejemplo «De» o «Con»)." });
    for (const conEspacios of [" De", "De ", "\tCon"]) {
      expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: conEspacios }), JSON.stringify(conEspacios)).toMatchObject({ ok: false, mensaje: "«Se lee en la carta como» no puede empezar ni terminar con espacios: borralos y volvé a guardar." });
    }
    expect(guardComandoEditarGrupoDeOpciones({ ...base, prefijoEnCarta: 7 })).toMatchObject({ ok: false });
    expect(guardComandoEditarGrupoDeOpciones(base)).toMatchObject({ ok: true });
    expect("prefijoEnCarta" in (guardComandoEditarGrupoDeOpciones(base) as { valor: object }).valor, "no viene = queda como estaba").toBe(false);
  });

  it("editar: fijar, repetir (sin escribir ni auditar), vaciar a NULL; cada cambio sube la versión y deja su fila; no mandarlo lo deja como estaba", async () => {
    const r = await crear({ nombre: "Con", tipo: "VARIANTE" });
    const id = r.ok && "datos" in r ? r.datos.grupoId : "";
    expect(await editar(id, { nombre: "Con", version: 1, prefijoEnCarta: "Con" })).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true } });
    expect(await editar(id, { nombre: "Con", version: 2, prefijoEnCarta: "Con" })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await grupo(id)).toMatchObject({ prefijoEnCarta: "Con", version: 2 });
    expect(await editar(id, { nombre: "Wok con", version: 2 })).toMatchObject({ ok: true, datos: { version: 3 } });
    expect(await grupo(id)).toMatchObject({ nombre: "Wok con", prefijoEnCarta: "Con" });
    expect(await editar(id, { nombre: "Wok con", version: 3, prefijoEnCarta: "" })).toMatchObject({ ok: true, datos: { version: 4 } });
    expect(await grupo(id)).toMatchObject({ prefijoEnCarta: null, version: 4 });
    expect(await auditorias(id)).toEqual([
      { valorAnterior: null, valorNuevo: "Con" },
      { valorAnterior: "Con", valorNuevo: null },
    ]);
  });

  it("DOS PANTALLAS: la segunda (versión vieja) cambia el nombre y arrastra el prefijo viejo → VERSION_DESACTUALIZADA; el prefijo de la primera queda", async () => {
    const r = await crear({ nombre: "Milanesas de", tipo: "VARIANTE" });
    const id = r.ok && "datos" in r ? r.datos.grupoId : "";
    const vista = { nombre: "Milanesas de", version: 1, prefijoEnCarta: null };
    expect(await editar(id, { ...vista, prefijoEnCarta: "De" })).toMatchObject({ ok: true });
    const segunda = await editar(id, { ...vista, nombre: "Tipo de milanesa" });
    expect(segunda).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await grupo(id)).toEqual({ nombre: "Milanesas de", prefijoEnCarta: "De", version: 2 });
    expect(await auditorias(id)).toHaveLength(1);
  });
});
