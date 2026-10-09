import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { MENSAJE_SIN_ADMIN_ACTIVO } from "../../src/core/permisos/invariantes";
import { actualizarActivoSucursal } from "../../src/server/actions/auth/sucursales";

/**
 * Hito 3, Fase I, I.4: `actualizarActivoSucursal` pasó a un caso de uso que corre en `conGobierno` con la forma nueva (`siSeViola`), que devuelve la invariante
 * violada como `fracaso("INVARIANTE_DE_GOBIERNO", …)` y la Server Action la traduce con `aResultadoAccion`. Ese camino ningún test lo recorría POR LA ACCIÓN
 * (`gobierno-g2-sucursales` prueba D9 llamando a `conGobierno` a mano): quien es admin solo en una sucursal y está parado en otra, donde es operador, apaga la
 * suya de admin. El permiso de empresa lo deja pasar (vale con cualquier membresía), no es la sucursal en la que está, no hay gerente, y la empresa se quedaría
 * sin ningún admin efectivo: la escritura se deshace y vuelve EXACTAMENTE el mensaje de la invariante, con la forma de siempre (`{ ok, mensaje }`).
 */
describe("actualizarActivoSucursal: la invariante de gobierno violada vuelve por la acción con su mensaje", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  it("apagar la sucursal del único admin efectivo (parado en otra donde es operador): se rechaza con el mensaje de la invariante y no se apaga", async () => {
    const base = await sembrarBase();
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const unico = await crearUsuarioConMembresia({ email: "unico-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: unico.id, sucursalId: otra.id, rolId: base.operador.id } });
    __setCookieDeTestParaSucursal(otra.id);
    await mockearUsuarioActual({ id: unico.id, email: unico.email, nombre: null });

    const r = await actualizarActivoSucursal(base.sucursal.id, false);

    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_ADMIN_ACTIVO });
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: base.sucursal.id } })).activo).toBe(true);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Sucursal", entidadId: base.sucursal.id } })).toBe(0);
  });
});
