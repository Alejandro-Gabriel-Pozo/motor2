import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { MENSAJE_SIN_ADMIN_ACTIVO } from "../../src/core/permisos/invariantes";
import { actualizarActivoMembresia, actualizarActivoUsuarioEnEmpresa, agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";

/**
 * Hito 3, Fase I, I.5: las mutaciones de `usuarios.ts` pasan a casos de uso que corren en `conGobierno` con la forma `siSeViola`, que devuelve la invariante
 * violada como `fracaso("INVARIANTE_DE_GOBIERNO", …)` y la Server Action la traduce con `aResultadoAccion`. Ese camino ningún test lo recorría POR LA ACCIÓN con
 * el mensaje exacto (las salvaguardas de `gobierno-g2-usuarios` miran `ok` o llaman a `conGobierno` a mano): acá, el único admin de la empresa (sin gerente) se
 * apaga a sí mismo. El techo lo deja (un admin puede tocar a un admin) y la empresa se quedaría sin ningún admin efectivo: la escritura se deshace y vuelve
 * EXACTAMENTE el mensaje de la invariante, con la forma de siempre (`{ ok, mensaje }`), sin fila de auditoría. Verde también contra el código previo a I.5.
 */
describe("usuarios: la invariante de gobierno violada vuelve por la acción con su mensaje", () => {
  let unicoId: string;
  let membresiaId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    rolOperadorId = base.operador.id;
    const unico = await crearUsuarioConMembresia({ email: "unico-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    unicoId = unico.id;
    membresiaId = (await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: unico.id } })).id;
    await mockearUsuarioActual({ id: unico.id, email: unico.email, nombre: null });
  });

  it("actualizarActivoMembresia: el único admin desactiva su propia membresía → el mensaje de la invariante, sin escribir ni auditar", async () => {
    const r = await actualizarActivoMembresia(membresiaId, false);

    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_ADMIN_ACTIVO });
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaId } })).activo).toBe(true);
    expect(await prismaAdmin.registroAuditoria.count({ where: { actorId: unicoId } })).toBe(0);
  });

  it("actualizarActivoUsuarioEnEmpresa: el único admin apaga su propia cuenta en la empresa → el mensaje de la invariante, sin escribir ni auditar", async () => {
    const r = await actualizarActivoUsuarioEnEmpresa(unicoId, false);

    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_ADMIN_ACTIVO });
    expect((await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: unicoId } })).activo).toBe(true);
    expect(await prismaAdmin.registroAuditoria.count({ where: { actorId: unicoId } })).toBe(0);
  });

  it("agregarOActualizarUsuario: el único admin se baja a sí mismo a operador → el mensaje de la invariante, sin escribir ni auditar", async () => {
    const membresia = await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaId } });
    const r = await agregarOActualizarUsuario({ email: "unico-admin@test.com", sucursalId: membresia.sucursalId, rolId: rolOperadorId });

    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_ADMIN_ACTIVO });
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaId } })).rolId).toBe(membresia.rolId);
    expect(await prismaAdmin.registroAuditoria.count({ where: { actorId: unicoId } })).toBe(0);
  });

  it("actualizarActivoUsuarioEnEmpresa: el gerente que apaga su propia cuenta recibe el rechazo PROPIO (antes que la invariante, que también lo frenaría con otro texto)", async () => {
    // El mismo único admin, ahora gerente: la invariante (b) también lo frenaría, pero con «no puede quedarse sin ninguna sucursal activa»; `gerente-unico`
    // solo mira /traspas/, que matchea las dos. Este fija cuál de los dos gana, y con eso que el chequeo propio sigue en su lugar.
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: unicoId }, data: { rolEmpresa: "gerente" } });

    const r = await actualizarActivoUsuarioEnEmpresa(unicoId, false);

    expect(r).toEqual({ ok: false, mensaje: "El gerente no puede desactivar su propia cuenta: traspasá la gerencia antes." });
    expect((await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: unicoId } })).activo).toBe(true);
  });
});
