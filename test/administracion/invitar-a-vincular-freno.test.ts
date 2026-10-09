import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import { invitarAVincular } from "../../src/server/actions/auth/usuarios";

/**
 * Hito 3, I.5i: «invitar a vincular» respeta el freno de un minuto desde el último envío de la invitación de vinculación pendiente (el mismo que reenviar). Ningún test
 * lo recorría por esta acción (`invitacion-de-usuario` y `usuarios-hora-del-pedido` lo miran en reenviar): sacarlo del caso de uso no ponía nada en rojo. Postgres
 * real, por la Server Action (sesión mockeada, mail en memoria).
 */
const correo = enviadorEnMemoriaDelCanal("avisos");

beforeEach(async () => {
  vi.stubEnv("AUTH_URL", "https://app.ejemplo.test");
  correo.vaciar();
  await limpiarBaseDeTest();
});

afterEach(() => vi.unstubAllEnvs());

describe("invitarAVincular: freno de un minuto", () => {
  it("dos pedidos seguidos: el primero manda el mail, el segundo se frena con el mensaje y no manda otro", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const precargado = await crearUsuarioConMembresia({ email: "precargado@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: precargado.id } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const primero = await invitarAVincular(membresia.id);
    expect(primero.ok, primero.mensaje).toBe(true);
    expect(correo.enviados).toHaveLength(1);

    const segundo = await invitarAVincular(membresia.id);
    expect(segundo).toEqual({ ok: false, mensaje: "Esa invitación se envió hace menos de un minuto. Esperá un momento antes de reenviarla." });
    expect(correo.enviados).toHaveLength(1);
    expect(await prismaAdmin.invitacion.count({ where: { email: "precargado@test.com", rolEmpresa: "vinculacion" } })).toBe(1);
  });
});
