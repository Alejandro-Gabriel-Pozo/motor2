import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261001100000_particion_permisos_reportes: cada reporte pasa a tener su propia clave `reporte_*`, y a cada rol y a
 * cada capacidad de sucursal se le copia lo que ya tenía en la acción padre. Corre como dueño (sin RLS), así que copia con el `empresaId`
 * de la fila de origen: acá hay DOS empresas para comprobar que cada una conserva lo suyo y que nada cruza de una a la otra.
 */
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20261001100000_particion_permisos_reportes/migration.sql"), "utf8");
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

const NUEVAS = ACCIONES.map((a) => a.clave).filter((c) => c.startsWith("reporte_"));
const PADRES = ["ver_reportes_dinero", "ver_reportes_control", "ver_reportes_operativos", "ver_reportes_catalogo", "proceso_control", "insumos_mezclados"];

// Padre → hijas, leído del propio SQL: el test no repite el mapa, comprueba lo que la migración hace con él.
const HIJAS_DE: Record<string, string[]> = {};
for (const m of SQL.matchAll(/\('([a-z_]+)', '(reporte_[a-z_]+)'\)/g)) {
  const hijas = (HIJAS_DE[m[1]] ??= []);
  if (!hijas.includes(m[2])) hijas.push(m[2]); // el mapa aparece en dos sentencias
}

async function correrMigracion() {
  for (const sentencia of SENTENCIAS) await prismaAdmin.$executeRawUnsafe(sentencia);
}

const NORTE = "norte";

describe("migración de datos: partición de las claves de permisos de los reportes", () => {
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

  it("tiene las tres sentencias esperadas (acciones, permisos de rol y capacidades de sucursal)", () => {
    expect(SENTENCIAS.length).toBe(3);
  });

  it("el mapa de la migración cubre las 26 claves nuevas, cada una con UN padre, y los padres son los esperados", () => {
    const hijas = Object.values(HIJAS_DE).flat();
    expect(hijas.sort()).toEqual([...NUEVAS].sort());
    expect(Object.keys(HIJAS_DE).sort()).toEqual([...PADRES].sort());
  });

  it("las acciones que crea tienen la misma descripción que el catálogo del código", async () => {
    await correrMigracion();
    const creadas = await prismaAdmin.accion.findMany({ where: { clave: { in: NUEVAS } } });
    expect(creadas.length).toBe(NUEVAS.length);
    const delCodigo = new Map(ACCIONES.map((a) => [a.clave as string, a.descripcion]));
    for (const a of creadas) expect(a.descripcion, a.clave).toBe(delCodigo.get(a.clave));
  });

  it("cada empresa conserva lo suyo: cada rol hereda, en cada reporte, lo que tenía en el padre; nada cruza de empresa", async () => {
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "ver_reportes_dinero", true, true);
    await permiso(EMPRESA_POR_DEFECTO_ID, operadorCentral, "ver_reportes_dinero", true, false);
    await permiso(EMPRESA_POR_DEFECTO_ID, operadorCentral, "proceso_control", true, true);
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "ver_reportes_control", true, true);
    await permiso(NORTE, adminNorte, "ver_reportes_dinero", false, false);
    await permiso(NORTE, adminNorte, "insumos_mezclados", true, true);

    await correrMigracion();

    for (const hija of HIJAS_DE.ver_reportes_dinero) {
      const central = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: operadorCentral, accionClave: hija } } });
      expect([central.empresaId, central.puedeVer, central.puedeEditar], hija).toEqual([EMPRESA_POR_DEFECTO_ID, true, false]);
      const norte = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminNorte, accionClave: hija } } });
      expect([norte.empresaId, norte.puedeVer, norte.puedeEditar], hija).toEqual([NORTE, false, false]);
    }
    for (const hija of HIJAS_DE.ver_reportes_control) {
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminCentral, accionClave: hija } }), hija).toBe(1);
      expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminNorte, accionClave: hija } }), hija).toBe(0);
    }
    const conteos = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: operadorCentral, accionClave: "reporte_conteos" } } });
    expect([conteos.puedeVer, conteos.puedeEditar]).toEqual([true, true]);
    const huecos = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminNorte, accionClave: "reporte_huecos_catalogo" } } });
    expect([huecos.empresaId, huecos.puedeVer, huecos.puedeEditar]).toEqual([NORTE, true, true]);
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminCentral, accionClave: "reporte_huecos_catalogo" } })).toBe(0);
  });

  it("los reportes nuevos sin padre configurado quedan sin asignar (ni Ver ni Editar), no abiertos", async () => {
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "ver_reportes_dinero", true, true);
    await correrMigracion();
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: operadorCentral } })).toBe(0);
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: adminNorte } })).toBe(0);
  });

  it("copia las capacidades de sucursal del padre (la fila por defecto y la de cada sucursal), cada una con su empresa", async () => {
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: "ver_reportes_control", sucursalId: sucCentral, habilitado: false } });
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: "ver_reportes_control", sucursalId: null, habilitado: false } });
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: "ver_reportes_operativos", sucursalId: sucNorte, habilitado: true } });

    await correrMigracion();

    for (const hija of HIJAS_DE.ver_reportes_control) {
      const c = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: sucCentral } });
      expect([c.empresaId, c.habilitado], hija).toEqual([EMPRESA_POR_DEFECTO_ID, false]);
      const n = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija, sucursalId: null } });
      expect([n.empresaId, n.habilitado], hija).toEqual([NORTE, false]);
    }
    for (const hija of HIJAS_DE.ver_reportes_operativos) {
      const o = await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: hija } });
      expect([o.empresaId, o.sucursalId, o.habilitado], hija).toEqual([NORTE, sucNorte, true]);
    }
    expect(await prismaAdmin.capacidadSucursal.count({ where: { accionClave: "reporte_resumen" } })).toBe(0);
  });

  it("es idempotente: correrla dos veces no duplica ni falla", async () => {
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "ver_reportes_dinero", true, true);
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: NORTE, accionClave: "ver_reportes_control", sucursalId: null, habilitado: false } });
    await correrMigracion();
    const permisos = await prismaAdmin.permisoRol.count();
    const capacidades = await prismaAdmin.capacidadSucursal.count();
    await correrMigracion();
    expect(await prismaAdmin.permisoRol.count()).toBe(permisos);
    expect(await prismaAdmin.capacidadSucursal.count()).toBe(capacidades);
    expect(await prismaAdmin.accion.count({ where: { clave: { in: NUEVAS } } })).toBe(NUEVAS.length);
  });

  it("no pisa lo que ya estaba configurado en un reporte (ni el permiso ni la capacidad ni la descripción)", async () => {
    await prismaAdmin.accion.create({ data: { clave: "reporte_resumen", descripcion: "ya existía" } });
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "ver_reportes_dinero", true, true);
    await permiso(EMPRESA_POR_DEFECTO_ID, adminCentral, "reporte_resumen", false, false);
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: "ver_reportes_dinero", sucursalId: sucCentral, habilitado: false } });
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: "reporte_resumen", sucursalId: sucCentral, habilitado: true } });

    await correrMigracion();

    const p = await prismaAdmin.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminCentral, accionClave: "reporte_resumen" } } });
    expect([p.puedeVer, p.puedeEditar]).toEqual([false, false]);
    expect((await prismaAdmin.capacidadSucursal.findFirstOrThrow({ where: { accionClave: "reporte_resumen", sucursalId: sucCentral } })).habilitado).toBe(true);
    expect((await prismaAdmin.accion.findUniqueOrThrow({ where: { clave: "reporte_resumen" } })).descripcion).toBe("ya existía");
  });
});
