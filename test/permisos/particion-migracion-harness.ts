import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Banco de pruebas de las migraciones de DATOS de la partición de claves de permisos (una clave por acción). Todas tienen la misma forma:
 * INSERT de las acciones nuevas, copia de `PermisoRol` y de `CapacidadSucursal` desde la clave padre y UPDATE de las descripciones de los
 * padres que se achicaron. Corren como dueño (sin RLS): copian con el `empresaId` de la fila de origen, así que acá hay DOS empresas para
 * comprobar que cada una conserva lo suyo y que nada cruza. El mapa padre → hijas se lee del propio SQL: el test no lo repite, comprueba lo
 * que la migración hace con él y que coincide con el catálogo del código.
 */
export function probarMigracionDeParticion(opciones: {
  directorio: string;
  titulo: string;
  sentenciasEsperadas: number;
  /** Padres que ya no están en `ACCIONES` (se retiraron del código en la misma partición): su contexto, que el catálogo ya no puede dar. */
  contextoDePadresRetirados?: Record<string, "empresa" | "sucursal">;
}) {
  const SQL = readFileSync(join(__dirname, "../../prisma/migrations", opciones.directorio, "migration.sql"), "utf8");
  const SENTENCIAS = SQL.replace(/\r\n/g, "\n")
    .split(";\n")
    .map((s) =>
      s
        .split("\n")
        .filter((linea) => !linea.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  const NUEVAS = [...SENTENCIAS[0].matchAll(/^ {2}\('([a-z_]+)', /gm)].map((m) => m[1]);
  const HIJAS_DE: Record<string, string[]> = {};
  for (const m of SQL.matchAll(/^ {2}\('([a-z_]+)', '([a-z_]+)'\),?$/gm)) {
    const hijas = (HIJAS_DE[m[1]] ??= []);
    if (!hijas.includes(m[2])) hijas.push(m[2]); // el mapa aparece en dos sentencias
  }
  const PADRES = Object.keys(HIJAS_DE);
  const CATALOGO = new Map(ACCIONES.map((a) => [a.clave as string, a]));
  const NORTE = "norte";

  const correrMigracion = async () => {
    for (const sentencia of SENTENCIAS) await prismaAdmin.$executeRawUnsafe(sentencia);
  };

  describe(`migración de datos: ${opciones.titulo}`, () => {
    let sucCentral: string;
    let sucNorte: string;
    let adminCentral: string;
    let operadorCentral: string;
    let adminNorte: string;

    beforeEach(async () => {
      await limpiarBaseDeTest();
      await prismaAdmin.empresa.create({
        data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
      });
      sucCentral = (await prismaAdmin.sucursal.create({ data: { nombre: "Central", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
      sucNorte = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: NORTE } })).id;
      adminCentral = (await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
      operadorCentral = (await prismaAdmin.rol.create({ data: { nombre: "operador", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
      adminNorte = (await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: NORTE } })).id;
      await prismaAdmin.accion.createMany({ data: PADRES.map((clave) => ({ clave, descripcion: clave })) });
    });

    const permiso = (empresaId: string, rolId: string, accionClave: string, puedeVer: boolean, puedeEditar: boolean) =>
      prismaAdmin.permisoRol.create({ data: { empresaId, rolId, accionClave, puedeVer, puedeEditar } });

    it("tiene las sentencias esperadas (acciones, permisos de rol, capacidades de sucursal y descripciones de los padres)", () => {
      expect(SENTENCIAS.length).toBe(opciones.sentenciasEsperadas);
    });

    it("el mapa cubre exactamente las acciones nuevas, cada una con UN padre, y todas existen en el catálogo del código", () => {
      const hijas = Object.values(HIJAS_DE).flat();
      expect(hijas.length).toBeGreaterThan(0);
      expect([...hijas].sort()).toEqual([...NUEVAS].sort());
      expect(new Set(hijas).size).toBe(hijas.length);
      for (const hija of hijas) expect(CATALOGO.has(hija), `${hija} tiene que estar en ACCIONES`).toBe(true);
    });

    it("cada hija tiene el mismo contexto que su padre (la copia de filas no mezcla alcances)", () => {
      for (const [padre, hijas] of Object.entries(HIJAS_DE)) {
        const contextoPadre = CATALOGO.get(padre)?.contexto ?? opciones.contextoDePadresRetirados?.[padre];
        expect(contextoPadre, `${padre} está en el catálogo o declarado como retirado`).toBeDefined();
        for (const hija of hijas) expect(CATALOGO.get(hija)?.contexto, `${hija} ← ${padre}`).toBe(contextoPadre);
      }
    });

    it("las acciones que crea tienen la misma descripción que el catálogo del código", async () => {
      await correrMigracion();
      const creadas = await prismaAdmin.accion.findMany({ where: { clave: { in: NUEVAS } } });
      expect(creadas.length).toBe(NUEVAS.length);
      for (const a of creadas) expect(a.descripcion, a.clave).toBe(CATALOGO.get(a.clave)?.descripcion);
    });

    it("las descripciones que reescribe de los padres coinciden con el catálogo del código", async () => {
      const cambios = [...SQL.matchAll(/UPDATE "Accion" SET "descripcion" = '([^\n]*)' WHERE "clave" = '([a-z_]+)'/g)];
      for (const m of cambios) expect(CATALOGO.get(m[2])?.descripcion, m[2]).toBe(m[1].replace(/''/g, "'"));
      await correrMigracion();
      for (const m of cambios) expect((await prismaAdmin.accion.findUniqueOrThrow({ where: { clave: m[2] } })).descripcion, m[2]).toBe(CATALOGO.get(m[2])?.descripcion);
    });

    it("cada empresa conserva lo suyo: cada rol hereda, en cada hija, lo que tenía en el padre; nada cruza de empresa", async () => {
      for (const padre of PADRES) {
        await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, padre, true, true);
        await permiso(EMPRESA_POR_DEFECTO_ID, operadorCentral, padre, true, false);
      }
      const primero = PADRES[0];
      await prismaAdmin.permisoRol.deleteMany({ where: { rolId: adminCentral, accionClave: primero } });
      await permiso(NORTE, adminNorte, PADRES[PADRES.length - 1], false, false);

      await correrMigracion();

      for (const padre of PADRES) {
        for (const hija of HIJAS_DE[padre]) {
          const op = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: operadorCentral, accionClave: hija } } });
          expect([op.empresaId, op.puedeVer, op.puedeEditar], hija).toEqual([EMPRESA_POR_DEFECTO_ID, true, false]);
          const adminFilas = await prismaAdmin.permisoRol.findMany({ where: { rolId: adminCentral, accionClave: hija } });
          expect(adminFilas.map((f) => [f.empresaId, f.puedeVer, f.puedeEditar]), hija).toEqual(padre === primero ? [] : [[EMPRESA_POR_DEFECTO_ID, true, true]]);
          const norteTieneFila = await prismaAdmin.permisoRol.findMany({ where: { rolId: adminNorte, accionClave: hija } });
          if (padre === PADRES[PADRES.length - 1]) {
            expect(norteTieneFila.map((f) => [f.empresaId, f.puedeVer, f.puedeEditar]), hija).toEqual([[NORTE, false, false]]);
          } else {
            expect(norteTieneFila, hija).toEqual([]);
          }
        }
      }
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminNorte, empresaId: EMPRESA_POR_DEFECTO_ID } })).toBe(0);
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: { in: [adminCentral, operadorCentral] }, empresaId: NORTE } })).toBe(0);
    });

    it("las acciones nuevas sin padre configurado quedan sin asignar (ni Ver ni Editar), no abiertas", async () => {
      await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, PADRES[0], true, true);
      await correrMigracion();
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: operadorCentral } })).toBe(0);
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminNorte } })).toBe(0);
    });

    it("copia las capacidades de sucursal del padre (la fila por defecto y la de cada sucursal), cada una con su empresa", async () => {
      const padre = PADRES[0];
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: padre, sucursalId: sucCentral, habilitado: false } });
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: padre, sucursalId: null, habilitado: false } });
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: padre, sucursalId: sucNorte, habilitado: true } });

      await correrMigracion();

      for (const hija of HIJAS_DE[padre]) {
        const c = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: sucCentral } });
        expect([c.empresaId, c.habilitado], hija).toEqual([EMPRESA_POR_DEFECTO_ID, false]);
        const defecto = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: null } });
        expect([defecto.empresaId, defecto.habilitado], hija).toEqual([NORTE, false]);
        const n = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: sucNorte } });
        expect([n.empresaId, n.habilitado], hija).toEqual([NORTE, true]);
      }
      for (const otro of PADRES.slice(1)) for (const hija of HIJAS_DE[otro]) expect(await prismaAdmin.capacidadSucursal.count({ where: { accionClave: hija } }), hija).toBe(0);
    });

    it("es idempotente: correrla dos veces no duplica ni falla", async () => {
      await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, PADRES[0], true, true);
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: PADRES[0], sucursalId: null, habilitado: false } });
      await correrMigracion();
      const permisos = await prismaAdmin.permisoRol.count();
      const capacidades = await prismaAdmin.capacidadSucursal.count();
      await correrMigracion();
      expect(await prismaAdmin.permisoRol.count()).toBe(permisos);
      expect(await prismaAdmin.capacidadSucursal.count()).toBe(capacidades);
      expect(await prismaAdmin.accion.count({ where: { clave: { in: NUEVAS } } })).toBe(NUEVAS.length);
    });

    it("no pisa lo que ya estaba configurado en una hija (ni el permiso ni la capacidad ni la descripción)", async () => {
      const padre = PADRES[0];
      const hija = HIJAS_DE[padre][0];
      await prismaAdmin.accion.create({ data: { clave: hija, descripcion: "ya existía" } });
      await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, padre, true, true);
      await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, hija, false, false);
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: padre, sucursalId: sucCentral, habilitado: false } });
      await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: hija, sucursalId: sucCentral, habilitado: true } });

      await correrMigracion();

      const p = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminCentral, accionClave: hija } } });
      expect([p.puedeVer, p.puedeEditar]).toEqual([false, false]);
      expect((await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: sucCentral } })).habilitado).toBe(true);
      expect((await prismaAdmin.accion.findUniqueOrThrow({ where: { clave: hija } })).descripcion).toBe("ya existía");
    });
  });
}
