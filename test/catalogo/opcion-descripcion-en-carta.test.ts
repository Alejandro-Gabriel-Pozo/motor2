import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { azarDelProceso } from "../../src/lib/azar";
import { crearOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo";
import { editarOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo";
import { guardComandoCrearOpcionDeGrupo, guardComandoEditarOpcionDeGrupo } from "../../src/core/features/catalogo/opciones-de-venta.guard";

/**
 * Carta «B», E3: la descripción de la opción (`OpcionDeGrupo.descripcionEnCarta`). Contra Postgres real, como `motor2_app`. Fija: el guard (ausente / vacío / costados / saltos / largo / caracteres), crear con descripción
 * (auditada, idempotente por estado), editar (patrón `prefijoEnCarta`: ausente = queda, vacío = NULL; auditoría por columna con el antes y el después; sin cambios no escribe ni audita; control de versión) y la
 * CONCURRENCIA REAL (dos ediciones a la vez con la misma versión: una sola gana, nada se escribe sin dejar rastro).
 */
describe("descripción de la opción: guard", () => {
  const base = { opcionId: "o1", versionEsperada: 1, nombre: "Ensalada" };
  const editar = (descripcionEnCarta?: unknown) => guardComandoEditarOpcionDeGrupo({ ...base, ...(descripcionEnCarta === undefined ? {} : { descripcionEnCarta }) });

  it("ausente: la clave no viaja (editar otra cosa no la toca); null, vacío o solo espacios: «sin descripción» (null)", () => {
    expect(editar()).toEqual({ ok: true, valor: { opcionId: "o1", versionEsperada: 1, nombre: "Ensalada" } });
    for (const vacio of [null, "", "   "]) expect(editar(vacio), JSON.stringify(vacio)).toEqual({ ok: true, valor: { ...base, descripcionEnCarta: null } });
  });

  it("un texto válido pasa tal cual (hasta 120 caracteres, con tildes, comas y paréntesis)", () => {
    for (const bueno of ["lechuga, tomate, cebolla", "x".repeat(120), "Ñandú (a la parrilla) y más", "tomate 100% natural"]) expect(editar(bueno), bueno).toEqual({ ok: true, valor: { ...base, descripcionEnCarta: bueno } });
  });

  it("rechaza: 121 caracteres, espacios a los costados, saltos de línea, HTML, empezar con «-» y lo que no es texto", () => {
    for (const malo of ["x".repeat(121), " lechuga", "lechuga ", "lechuga\ntomate", "lechuga\r\ntomate", "<script>alert(1)</script>", "<b>hola</b>", "=1+1", "-A1", 5, {}, []]) {
      expect(editar(malo as unknown).ok, JSON.stringify(malo)).toBe(false);
    }
  });

  it("el alta lleva la misma regla", () => {
    const alta = (descripcionEnCarta?: unknown) => guardComandoCrearOpcionDeGrupo({ grupoId: "g1", nombre: "Ensalada", orden: 0, esNinguna: false, version: { diferencia: { tipo: "MONTO", monto: 0 }, factorEscala: null, consumos: [] }, ancla: null, ...(descripcionEnCarta === undefined ? {} : { descripcionEnCarta }) });
    const sinDescripcion = alta();
    expect(sinDescripcion.ok && "descripcionEnCarta" in sinDescripcion.valor).toBe(false);
    expect(alta("lechuga, tomate")).toMatchObject({ ok: true, valor: { descripcionEnCarta: "lechuga, tomate" } });
    expect(alta("a\nb").ok).toBe(false);
  });
});

describe("descripción de la opción: casos de uso (Postgres real)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const descripcionDe = async (id: string) => (await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id }, select: { descripcionEnCarta: true, version: true } }));
  const auditoriaDe = (id: string) => prisma.registroAuditoria.findMany({ where: { entidad: "OpcionDeGrupo", entidadId: id, campo: "descripcionEnCarta" }, orderBy: { creadoEn: "asc" }, select: { valorAnterior: true, valorNuevo: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
  });

  it("editar: escribe la descripción, la audita con el antes y el después y sube la versión; el MISMO pedido repetido no escribe ni audita", async () => {
    expect((await descripcionDe(e.vacaId)).descripcionEnCarta).toBeNull();
    const r = await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca", descripcionEnCarta: "leche entera de tambo" });
    expect(r).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true } });
    expect(await descripcionDe(e.vacaId)).toEqual({ descripcionEnCarta: "leche entera de tambo", version: 2 });
    expect(await auditoriaDe(e.vacaId)).toEqual([{ valorAnterior: null, valorNuevo: "leche entera de tambo" }]);
    // Idempotencia: repetirlo (clic doble, reintento) no escribe, no audita y no sube la versión.
    expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca", descripcionEnCarta: "leche entera de tambo" })).toMatchObject({ ok: true, datos: { huboCambio: false, version: 2 } });
    expect(await descripcionDe(e.vacaId)).toEqual({ descripcionEnCarta: "leche entera de tambo", version: 2 });
    expect(await auditoriaDe(e.vacaId)).toHaveLength(1);
  });

  it("ausente = la descripción queda (renombrar no la borra); null = se vacía y queda auditado; no cambia el precio ni crea una versión de precio", async () => {
    await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca", descripcionEnCarta: "leche entera" });
    const versionesDePrecioAntes = await prisma.versionDeOpcion.count({ where: { opcionId: e.vacaId } });
    expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 2, nombre: "De vaca entera" })).toMatchObject({ ok: true, datos: { version: 3, huboCambio: true } });
    expect((await descripcionDe(e.vacaId)).descripcionEnCarta).toBe("leche entera");
    expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 3, nombre: "De vaca entera", descripcionEnCarta: null })).toMatchObject({ ok: true, datos: { version: 4 } });
    expect((await descripcionDe(e.vacaId)).descripcionEnCarta).toBeNull();
    expect(await auditoriaDe(e.vacaId)).toEqual([
      { valorAnterior: null, valorNuevo: "leche entera" },
      { valorAnterior: "leche entera", valorNuevo: null },
    ]);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.vacaId } })).toBe(versionesDePrecioAntes);
  });

  it("control de versión: con la versión vieja y otro cambio de por medio, VERSION_DESACTUALIZADA y la descripción no cambia", async () => {
    await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca", descripcionEnCarta: "primera" });
    expect(await editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.vacaId, versionEsperada: 1, nombre: "De vaca", descripcionEnCarta: "segunda" })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect((await descripcionDe(e.vacaId)).descripcionEnCarta).toBe("primera");
  });

  it("CONCURRENCIA: dos ediciones a la vez con la misma versión: una sola gana, la otra VERSION_DESACTUALIZADA; el estado final es el de la ganadora y queda UNA fila de auditoría por cambio efectivo", async () => {
    for (let i = 0; i < 10; i++) {
      const antes = await descripcionDe(e.almendrasId);
      const nombre = (await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.almendrasId }, select: { nombre: true } })).nombre;
      const filasAntes = (await auditoriaDe(e.almendrasId)).length;
      const resultados = await Promise.allSettled([
        editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.almendrasId, versionEsperada: antes.version, nombre, descripcionEnCarta: `A${i}` }),
        editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.almendrasId, versionEsperada: antes.version, nombre, descripcionEnCarta: `B${i}` }),
      ]);
      expect(resultados.every((r) => r.status === "fulfilled"), `vuelta ${i}`).toBe(true);
      const v = resultados.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof editarOpcionDeGrupoCasoDeUso>>>).value);
      expect(v.filter((r) => r.ok), `vuelta ${i}`).toHaveLength(1);
      expect(v.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo)), `vuelta ${i}`).toEqual(["VERSION_DESACTUALIZADA"]);
      const despues = await descripcionDe(e.almendrasId);
      expect(despues.version, `vuelta ${i}`).toBe(antes.version + 1);
      expect([`A${i}`, `B${i}`]).toContain(despues.descripcionEnCarta);
      const filas = await auditoriaDe(e.almendrasId);
      expect(filas, `vuelta ${i}`).toHaveLength(filasAntes + 1);
      expect(filas.at(-1)!.valorNuevo).toBe(despues.descripcionEnCarta);
    }
  });

  it("crear con descripción: queda guardada y auditada en el alta; repetir el alta idéntica devuelve la misma opción sin otra auditoría; con otra descripción, NOMBRE_REPETIDO", async () => {
    const comando = { grupoId: e.grupoVarianteId, nombre: "Coco", orden: 4, esNinguna: false, ancla: null, version: { diferencia: { tipo: "MONTO" as const, monto: 80 }, factorEscala: null, consumos: [] }, descripcionEnCarta: "coco rallado y leche de coco" };
    const a = await crearOpcionDeGrupoCasoDeUso(actor(), comando, azarDelProceso);
    expect(a).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!a.ok) return;
    expect((await descripcionDe(a.datos.opcionId)).descripcionEnCarta).toBe("coco rallado y leche de coco");
    expect(await auditoriaDe(a.datos.opcionId)).toEqual([{ valorAnterior: null, valorNuevo: "coco rallado y leche de coco" }]);
    const auditoria = await prisma.registroAuditoria.count();
    const b = await crearOpcionDeGrupoCasoDeUso(actor(), comando, azarDelProceso);
    expect(b).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(b.ok && b.datos.opcionId === a.datos.opcionId).toBe(true);
    expect(await prisma.registroAuditoria.count()).toBe(auditoria);
    expect(await crearOpcionDeGrupoCasoDeUso(actor(), { ...comando, descripcionEnCarta: "otra cosa" }, azarDelProceso)).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
    // Sin descripción: queda NULL y no se audita la columna.
    const sin = await crearOpcionDeGrupoCasoDeUso(actor(), { ...comando, nombre: "Soja", descripcionEnCarta: undefined }, azarDelProceso);
    expect(sin.ok && (await descripcionDe(sin.datos.opcionId)).descripcionEnCarta).toBeNull();
    expect(sin.ok && (await auditoriaDe(sin.datos.opcionId)).length).toBe(0);
  });
});
