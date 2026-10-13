import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa, sembrarBase } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { crearGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-opciones";
import { editarGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones";

/**
 * GO-2a, paso 6: CONCURRENCIA REAL de los grupos de opciones (Promise.allSettled contra Postgres, como `motor2_app`, sin mocks de base). En loop porque el cruce depende del timing, y
 * con una guarda contra el falso verde: si en ninguna iteración hubo un reintento (más de una transacción por llamada), el test no ejercitó el conflicto.
 *  - Dos ediciones a la vez con la MISMA versión esperada: gana una, la otra recibe `VERSION_DESACTUALIZADA`; la versión sube de a 1 y solo queda la auditoría de la ganadora.
 *  - Dos altas a la vez con el mismo nombre en distinta capitalización: UNA sola fila (el único `lower(nombre)` y el reintento), las dos terminan bien.
 */
const ITERACIONES = 10;

describe("grupos de opciones — concurrencia real (GO-2a)", () => {
  let adminId: string;
  let sucursalId: string;
  const actor = () => actorDePrueba(adminId, sucursalId);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  });

  it("dos ediciones simultáneas con la misma versión: una gana y la otra recibe VERSION_DESACTUALIZADA; la versión sube de a una y la auditoría es solo de la ganadora", async () => {
    const r = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 5 });
    const grupoId = r.ok ? r.datos.grupoId : "";
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();

    for (let i = 0; i < ITERACIONES; i++) {
      const version = i + 1;
      const auditoriaAntes = await prisma.registroAuditoria.count({ where: { entidadId: grupoId } });
      const resultados = await Promise.allSettled([
        editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: version, nombre: `Extras ${i}`, cantidadMinima: 0, cantidadMaxima: 5, activo: true }),
        editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: version, nombre: "Extras", cantidadMinima: 1, cantidadMaxima: i % 2 === 0 ? 4 : 5, activo: true }),
      ]);
      expect(resultados.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó (el conflicto no se absorbió)`).toBe(true);
      const valores = resultados.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof editarGrupoDeOpcionesCasoDeUso>>>).value);
      const ganadoras = valores.filter((v) => v.ok);
      const perdedoras = valores.filter((v) => !v.ok);
      expect(ganadoras, `iteración ${i}: ${valores.map((v) => v.mensaje).join(" | ")}`).toHaveLength(1);
      expect(perdedoras.map((v) => (v.ok ? "" : v.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);

      const g = await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } });
      expect(g.version, `iteración ${i}`).toBe(version + 1);
      const ganoLaPrimera = valores[0]!.ok;
      // La fila quedó EXACTAMENTE como la dejó la ganadora (no una mezcla de las dos).
      if (ganoLaPrimera) expect(g).toMatchObject({ nombre: `Extras ${i}`, cantidadMinima: 0, cantidadMaxima: 5 });
      else expect(g).toMatchObject({ nombre: "Extras", cantidadMinima: 1, cantidadMaxima: i % 2 === 0 ? 4 : 5 });
      // Auditoría: solo las columnas que cambió la ganadora, nunca las de la perdedora.
      const nuevas = await prisma.registroAuditoria.findMany({ where: { entidadId: grupoId }, orderBy: { creadoEn: "asc" }, skip: auditoriaAntes, select: { campo: true } });
      expect(nuevas.length, `iteración ${i}: ${nuevas.map((n) => n.campo).join(",")}`).toBeGreaterThan(0);
      if (ganoLaPrimera) expect(nuevas.every((n) => n.campo === "nombre" || n.campo === "cantidadMinima" || n.campo === "cantidadMaxima")).toBe(true);
    }

    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración hubo un conflicto: el test no ejercitó el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("dos altas simultáneas con el mismo nombre en distinta capitalización: una sola fila, las dos terminan bien (una «ya existía») y una sola auditoría del alta", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Salsa ${i}`;
      const resultados = await Promise.allSettled([
        crearGrupoDeOpcionesCasoDeUso(actor(), { nombre, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 }),
        crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: nombre.toUpperCase(), tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 }),
      ]);
      expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `iteración ${i}: ${JSON.stringify(resultados)}`).toBe(true);
      const ids = resultados.map((s) => (s.status === "fulfilled" && s.value.ok ? s.value.datos.grupoId : ""));
      expect(ids[0]).toBe(ids[1]);
      expect(await prisma.grupoDeOpciones.count({ where: { nombre: { equals: nombre, mode: "insensitive" } } })).toBe(1);
      expect(await prisma.registroAuditoria.count({ where: { entidadId: ids[0]!, campo: "nombre" } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron las dos altas: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("doble clic en serie (Next despacha las Server Actions de un cliente de a una): la segunda edición idéntica no escribe ni audita", async () => {
    const r = await crearGrupoDeOpcionesCasoDeUso(actor(), { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 });
    const grupoId = r.ok ? r.datos.grupoId : "";
    const primera = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Tamaños", cantidadMinima: 1, cantidadMaxima: 1, activo: true });
    const auditoria = await prisma.registroAuditoria.count();
    const segunda = await editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId, versionEsperada: 1, nombre: "Tamaños", cantidadMinima: 1, cantidadMaxima: 1, activo: true });
    expect(primera).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true } });
    expect(segunda).toMatchObject({ ok: true, datos: { version: 2, huboCambio: false } });
    expect(await prisma.registroAuditoria.count()).toBe(auditoria);
    expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupoId } })).version).toBe(2);
  });
});
