import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Migración 20261005120000_renombrar_boleta_a_ticket (tabla `EjemplarBoleta` → `EjemplarTicket` y dos claves de acción). Se corre acá contra la base
 * de pruebas, sentencia por sentencia y como DUEÑO (renombrar una tabla no lo puede hacer el rol de la app). Cada test termina con la base en el estado
 * NUEVO (el que espera el resto de la suite), pase lo que pase.
 */
const CARPETA = join(__dirname, "../../prisma/migrations/20261005120000_renombrar_boleta_a_ticket");

/** Parte un .sql en sentencias respetando los bloques `$$ … $$` (un DO tiene `;` adentro). */
function sentenciasDe(archivo: string): string[] {
  const sql = readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const salida: string[] = [];
  let actual = "";
  let dentroDeBloque = false;
  for (const linea of sql.split("\n")) {
    actual += linea + "\n";
    if ((linea.match(/\$\$/g) ?? []).length % 2 === 1) dentroDeBloque = !dentroDeBloque;
    if (!dentroDeBloque && linea.trimEnd().endsWith(";")) {
      salida.push(actual.trim());
      actual = "";
    }
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

const MIGRACION = sentenciasDe("migration.sql");
const REVERSA = sentenciasDe("down.sql");

async function correr(sentencias: string[]) {
  for (const s of sentencias) await prismaAdmin.$executeRawUnsafe(s);
}

async function nombresDeTabla(tabla: string): Promise<{ restricciones: string[]; indices: string[] }> {
  const r = await prismaAdmin.$queryRawUnsafe<{ n: string }[]>(
    `SELECT conname::text AS n FROM pg_constraint WHERE conrelid = to_regclass('public."${tabla}"') ORDER BY 1`
  );
  const i = await prismaAdmin.$queryRawUnsafe<{ n: string }[]>(
    `SELECT indexname::text AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${tabla}' ORDER BY 1`
  );
  return { restricciones: r.map((x) => x.n), indices: i.map((x) => x.n) };
}

const existe = async (tabla: string) => (await prismaAdmin.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('public."${tabla}"')::text AS t`))[0].t !== null;

describe("migración del renombre boleta → ticket", () => {
  let adminId: string;
  let operadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    adminId = (await prisma.rol.create({ data: { nombre: "admin" } })).id;
    operadorId = (await prisma.rol.create({ data: { nombre: "operador" } })).id;
  });

  afterEach(async () => {
    await correr(MIGRACION); // idempotente: deja el estado nuevo aunque el test haya vuelto al viejo
  });

  it("la tabla y sus 10 objetos pasan a llamarse «EjemplarTicket…», sin dejar nada con el nombre viejo, y la reversa los devuelve", async () => {
    await correr(REVERSA);
    expect(await existe("EjemplarBoleta")).toBe(true);
    expect(await existe("EjemplarTicket")).toBe(false);
    const viejos = await nombresDeTabla("EjemplarBoleta");
    expect(viejos.restricciones.length + viejos.indices.length).toBeGreaterThanOrEqual(10);

    await correr(MIGRACION);
    expect(await existe("EjemplarTicket")).toBe(true);
    expect(await existe("EjemplarBoleta")).toBe(false);
    const nuevos = await nombresDeTabla("EjemplarTicket");
    expect(nuevos.restricciones.every((n) => n.startsWith("EjemplarTicket_"))).toBe(true);
    expect(nuevos.indices.every((n) => n.startsWith("EjemplarTicket_"))).toBe(true);
    expect(nuevos.restricciones.map((n) => n.replace("EjemplarTicket_", "EjemplarBoleta_"))).toEqual(viejos.restricciones);
    expect(nuevos.indices.map((n) => n.replace("EjemplarTicket_", "EjemplarBoleta_"))).toEqual(viejos.indices);
  });

  it("el RLS viaja con la tabla: sigue habilitado tras el renombre", async () => {
    const [fila] = await prismaAdmin.$queryRawUnsafe<{ rls: boolean }[]>(
      `SELECT relrowsecurity AS rls FROM pg_class WHERE oid = to_regclass('public."EjemplarTicket"')`
    );
    expect(fila.rls).toBe(true);
  });

  it("las claves viejas pasan a las nuevas CONSERVANDO el id de cada permiso y capacidad (la auditoría vieja los referencia)", async () => {
    await prisma.accion.createMany({
      data: [
        { clave: "reporte_boletas", descripcion: "vieja" },
        { clave: "pos_emitir_boleta_corregida", descripcion: "vieja" },
      ],
    });
    await prisma.accion.deleteMany({ where: { clave: { in: ["reporte_tickets", "pos_emitir_ticket_corregido"] } } });
    const sucursal = await prisma.sucursal.create({ data: { nombre: "Central" } });
    const pAdmin = await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "reporte_boletas", puedeVer: true, puedeEditar: true } });
    const pOperador = await prisma.permisoRol.create({ data: { rolId: operadorId, accionClave: "pos_emitir_boleta_corregida", puedeVer: true, puedeEditar: false } });
    const cDefault = await prisma.capacidadSucursal.create({ data: { accionClave: "reporte_boletas", sucursalId: null, habilitado: false } });
    const cSucursal = await prisma.capacidadSucursal.create({ data: { accionClave: "pos_emitir_boleta_corregida", sucursalId: sucursal.id, habilitado: true } });

    await correr(MIGRACION);

    expect((await prisma.permisoRol.findUniqueOrThrow({ where: { id: pAdmin.id } })).accionClave).toBe("reporte_tickets");
    const op = await prisma.permisoRol.findUniqueOrThrow({ where: { id: pOperador.id } });
    expect([op.accionClave, op.puedeVer, op.puedeEditar]).toEqual(["pos_emitir_ticket_corregido", true, false]);
    const cd = await prisma.capacidadSucursal.findUniqueOrThrow({ where: { id: cDefault.id } });
    expect([cd.accionClave, cd.sucursalId, cd.habilitado]).toEqual(["reporte_tickets", null, false]);
    expect((await prisma.capacidadSucursal.findUniqueOrThrow({ where: { id: cSucursal.id } })).accionClave).toBe("pos_emitir_ticket_corregido");
    expect(await prisma.accion.count({ where: { clave: { in: ["reporte_boletas", "pos_emitir_boleta_corregida"] } } })).toBe(0);
    expect((await prisma.accion.findUniqueOrThrow({ where: { clave: "reporte_tickets" } })).descripcion).toBe("Ver el reporte «Tickets emitidos»");
  });

  it("si la clave nueva ya tenía fila para el mismo rol, la vieja se descarta y la nueva queda intacta (no choca con el único)", async () => {
    await prisma.accion.createMany({ data: [{ clave: "reporte_boletas", descripcion: "vieja" }, { clave: "reporte_tickets", descripcion: "nueva" }] });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "reporte_boletas", puedeVer: true, puedeEditar: true } });
    const nueva = await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "reporte_tickets", puedeVer: true, puedeEditar: false } });

    await correr(MIGRACION);

    const filas = await prisma.permisoRol.findMany({ where: { rolId: adminId, accionClave: { in: ["reporte_boletas", "reporte_tickets"] } } });
    expect(filas).toHaveLength(1);
    expect([filas[0].id, filas[0].puedeEditar]).toEqual([nueva.id, false]);
  });

  it("es idempotente: sobre una base ya migrada no falla ni cambia nada", async () => {
    const antes = await prisma.permisoRol.count();
    await correr(MIGRACION);
    await correr(MIGRACION);
    expect(await prisma.permisoRol.count()).toBe(antes);
    expect(await existe("EjemplarTicket")).toBe(true);
  });
});
