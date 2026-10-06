import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { ACCIONES } from "../../src/core/permisos/acciones";

/**
 * La migración de datos 20260926190200_permiso_pos_asignar_cliente agrega a cualquier base existente las acciones `clientes` y
 * `pos_asignar_cliente` (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D3 y punto 9). A diferencia del molde habitual
 * (migracion-permiso-pos-tomar-pedido.test.ts: la fila solo va a 'admin' por nombre de rol), `pos_asignar_cliente` se semillea
 * DINÁMICAMENTE a cualquier rol que YA edite `pos_tomar_pedido` — este test verifica las dos ramas: una base sin ningún «mozo»
 * armado (solo admin recibe la fila) y una con un «mozo» ya armado (también la recibe). Mismo molde que
 * migracion-permiso-pos-tomar-pedido.test.ts.
 */
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20260926190200_permiso_pos_asignar_cliente/migration.sql"), "utf8");
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

async function correrMigracion() {
  for (const sentencia of SENTENCIAS) await prisma.$executeRawUnsafe(sentencia);
}

describe("migración de datos del permiso pos_asignar_cliente (+ clientes)", () => {
  let adminId: string;
  let operadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    adminId = (await prisma.rol.create({ data: { nombre: "admin", clave: "admin" } })).id;
    operadorId = (await prisma.rol.create({ data: { nombre: "operador", clave: "operador" } })).id;
  });

  it("tiene las tres sentencias esperadas (las dos acciones, el permiso de 'clientes' y el dinámico de 'pos_asignar_cliente')", () => {
    expect(SENTENCIAS.length).toBe(3);
  });

  it("crea las dos acciones", async () => {
    await correrMigracion();
    expect(await prisma.accion.count({ where: { clave: "clientes" } })).toBe(1);
    expect(await prisma.accion.count({ where: { clave: "pos_asignar_cliente" } })).toBe(1);
  });

  it("'clientes' va solo a admin, mismo criterio que el resto del catálogo", async () => {
    await correrMigracion();
    const deAdmin = await prisma.permisoRol.findMany({ where: { rolId: adminId, accionClave: "clientes" } });
    expect(deAdmin).toHaveLength(1);
    expect(deAdmin[0].puedeVer && deAdmin[0].puedeEditar).toBe(true);
    expect(await prisma.permisoRol.count({ where: { rolId: operadorId, accionClave: "clientes" } })).toBe(0);
  });

  it("sin ningún «mozo» armado: 'pos_asignar_cliente' solo llega a admin (que ya edita pos_tomar_pedido de fábrica)", async () => {
    await prisma.accion.create({ data: { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "pos_tomar_pedido", puedeVer: true, puedeEditar: true } });

    await correrMigracion();

    const deAdmin = await prisma.permisoRol.findMany({ where: { rolId: adminId, accionClave: "pos_asignar_cliente" } });
    expect(deAdmin).toHaveLength(1);
    expect(deAdmin[0].puedeVer && deAdmin[0].puedeEditar).toBe(true);
    expect(await prisma.permisoRol.count({ where: { rolId: operadorId, accionClave: "pos_asignar_cliente" } })).toBe(0);
  });

  it("D3: con un rol «mozo» ya armado (Editar de pos_tomar_pedido), también recibe 'pos_asignar_cliente' — no solo admin", async () => {
    const mozoId = (await prisma.rol.create({ data: { nombre: "mozo" } })).id;
    await prisma.accion.create({ data: { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "pos_tomar_pedido", puedeVer: true, puedeEditar: true } });
    await prisma.permisoRol.create({ data: { rolId: mozoId, accionClave: "pos_tomar_pedido", puedeVer: true, puedeEditar: true } });

    await correrMigracion();

    for (const rolId of [adminId, mozoId]) {
      const permiso = await prisma.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId, accionClave: "pos_asignar_cliente" } } });
      expect(permiso.puedeVer && permiso.puedeEditar).toBe(true);
    }
  });

  it("un rol con solo VER de pos_tomar_pedido (sin Editar) NO recibe pos_asignar_cliente", async () => {
    const soloVerId = (await prisma.rol.create({ data: { nombre: "solo-ve-pedidos" } })).id;
    await prisma.accion.create({ data: { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos" } });
    await prisma.permisoRol.create({ data: { rolId: soloVerId, accionClave: "pos_tomar_pedido", puedeVer: true, puedeEditar: false } });

    await correrMigracion();

    expect(await prisma.permisoRol.count({ where: { rolId: soloVerId, accionClave: "pos_asignar_cliente" } })).toBe(0);
  });

  it("es idempotente: correrla dos veces no duplica ni falla", async () => {
    await prisma.accion.create({ data: { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "pos_tomar_pedido", puedeVer: true, puedeEditar: true } });

    await correrMigracion();
    await correrMigracion();

    expect(await prisma.accion.count({ where: { clave: "clientes" } })).toBe(1);
    expect(await prisma.accion.count({ where: { clave: "pos_asignar_cliente" } })).toBe(1);
    expect(await prisma.permisoRol.count({ where: { rolId: adminId, accionClave: "pos_asignar_cliente" } })).toBe(1);
  });

  it("no pisa un permiso que ya estaba configurado a mano", async () => {
    await prisma.accion.create({ data: { clave: "clientes", descripcion: "ya existía" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "clientes", puedeVer: true, puedeEditar: false } });

    await correrMigracion();

    const conservado = await prisma.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminId, accionClave: "clientes" } } });
    expect(conservado.puedeEditar).toBe(false);
    expect((await prisma.accion.findUniqueOrThrow({ where: { clave: "clientes" } })).descripcion).toBe("ya existía");
  });

  it("coincide con lo que declara la fuente única de acciones (descripción y rol semilla)", () => {
    for (const clave of ["clientes", "pos_asignar_cliente"] as const) {
      const accion = ACCIONES.find((a) => a.clave === clave);
      expect(accion, `${clave} tiene que estar en ACCIONES`).toBeDefined();
      expect(accion!.rolesEditarSemilla).toEqual(["admin"]);
      expect(SQL).toContain(`'${accion!.descripcion}'`);
    }
  });
});
