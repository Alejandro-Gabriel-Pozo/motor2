import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSeccion, listarSeccionesParaPanel } from "../../src/server/actions/movimientos/secciones";
import { ACCIONES } from "../../src/core/permisos/acciones";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i): crear una sección eligiendo su USO por la Server Action real (permiso `secciones`), contra Postgres.
 * Valida con lista de permitidos (nada fuera de normal / cuarentena / rechazo), se niega a quien no llega al piso, y el uso no se edita después.
 */
describe("Crear una sección con su uso", () => {
  let sucursalId: string;
  let admin: { id: string; email: string };
  let operador: { id: string; email: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    const rolOperador = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: rolOperador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("la acción `secciones` es de la sucursal (su piso hoy es operario: ver «Implementación» del diseño; si cambia, este test avisa)", () => {
    expect(ACCIONES.find((a) => a.clave === "secciones")).toMatchObject({ modulo: "stock", contexto: "sucursal", nivelMinimo: "operario" });
  });

  it.each(["NORMAL", "CUARENTENA", "RECHAZO"])("crea con el uso %s y queda guardado y visible en el panel", async (uso) => {
    const r = await crearSeccion(`Depósito ${uso}`, uso);
    expect(r).toMatchObject({ ok: true, nombre: `Depósito ${uso}` });
    expect((await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: `Depósito ${uso}` } })).uso).toBe(uso);
    expect((await listarSeccionesParaPanel(sucursalId)).find((s) => s.nombre === `Depósito ${uso}`)?.uso).toBe(uso);
  });

  it("sin decir el uso, nace NORMAL", async () => {
    expect((await crearSeccion("Cocina")).ok).toBe(true);
    expect((await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Cocina" } })).uso).toBe("NORMAL");
  });

  it.each(["rechazo", "RECHAZO ", "CALIDAD", "", "normal", "NORMAL; DROP TABLE", "Cuarentena"])("rechaza el uso %j (lista de permitidos) y no crea nada", async (malo) => {
    const r = await crearSeccion("Depósito raro", malo);
    expect(r).toEqual({ ok: false, mensaje: "Valor inválido." });
    expect(await prisma.seccion.count({ where: { sucursalId, nombre: "Depósito raro" } })).toBe(0);
  });

  it("rechaza un valor que ni siquiera es texto (llamada directa a la acción con un tipo equivocado)", async () => {
    expect((await crearSeccion("Depósito raro", 5 as unknown as string)).ok).toBe(false);
    expect((await crearSeccion("Depósito raro", null as unknown as string)).ok).toBe(false);
    expect(await prisma.seccion.count({ where: { sucursalId, nombre: "Depósito raro" } })).toBe(0);
  });

  it("autorización en el servidor: quien no llega al piso (operador) no crea una sección con uso, aunque mande un uso válido", async () => {
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await crearSeccion("Rechazo del operador", "RECHAZO");
    expect(r.ok).toBe(false);
    expect(await prisma.seccion.count({ where: { sucursalId, nombre: "Rechazo del operador" } })).toBe(0);
  });

  it("el uso es de la sucursal activa: una sección de rechazo creada acá no aparece en otra sucursal", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    expect((await crearSeccion("Rechazo", "RECHAZO")).ok).toBe(true);
    expect(await prisma.seccion.count({ where: { sucursalId: otra.id } })).toBe(0);
  });
});
