import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, prisma } from "../setup/test-db";
import { guardarPermisosCasoDeUso } from "../../src/server/actions/permisos/casos-de-uso/guardar-permisos";
import { MENSAJE_GUARDADO_EN_CONFLICTO, SIN_PERMISO } from "../../src/core/permisos/matriz";

/**
 * Hito 3, Fase I, I.3: el `.catch(esConflictoDeEscritura)` de `guardarPermisos` pasó de la Server Action al caso de uso (`casos-de-uso/guardar-permisos.ts`).
 * Ningún test lo cubría: agotar los reintentos de SERIALIZABLE (la transacción ya hizo rollback, no se guardó nada) tiene que volver como el mensaje de negocio
 * `MENSAJE_GUARDADO_EN_CONFLICTO` —la pantalla lo reconoce para ofrecer reintentar sin perder el borrador—, y cualquier OTRO error tiene que seguir de largo
 * (no se disfraza de conflicto). Se prueba el caso de uso con una transacción armada a mano que falla en cada intento (desde O35-C las lecturas de roles y
 * acciones también van dentro de la transacción, así que el actor no necesita `db`).
 */
const conflictoDeEscritura = () => new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "test" });

describe("guardarPermisosCasoDeUso: reintentos agotados y otros errores", () => {
  let operadorRolId: string;
  const cambio = () => [{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } }];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    operadorRolId = (await sembrarBase()).operador.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un conflicto de escritura en cada intento: reintenta 5 veces y devuelve «justo ahora había otro guardado», sin guardar nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const foto = async () => ({ matriz: await prisma.permisoRol.findMany({ orderBy: { id: "asc" } }), auditoria: await prisma.registroAuditoria.count() });
    const antes = await foto();
    const transaccion = vi.fn(async () => {
      throw conflictoDeEscritura();
    });
    const r = await guardarPermisosCasoDeUso({ usuarioId: "u-prueba", empresaId: EMPRESA_POR_DEFECTO_ID, transaccion }, cambio());
    expect(r).toEqual({ ok: false, codigo: "GUARDADO_EN_CONFLICTO", mensaje: MENSAJE_GUARDADO_EN_CONFLICTO });
    expect(transaccion).toHaveBeenCalledTimes(5);
    expect(await foto()).toEqual(antes);
  });

  it("cualquier otro error sigue de largo, sin reintentar ni disfrazarse de conflicto", async () => {
    const otro = new Error("se cortó la conexión");
    const transaccion = vi.fn(async () => {
      throw otro;
    });
    await expect(guardarPermisosCasoDeUso({ usuarioId: "u-prueba", empresaId: EMPRESA_POR_DEFECTO_ID, transaccion }, cambio())).rejects.toBe(otro);
    expect(transaccion).toHaveBeenCalledTimes(1);
  });
});
