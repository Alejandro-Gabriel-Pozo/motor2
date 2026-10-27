import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { procesosVisiblesDelSelector } from "../../src/server/acceso/menu";
import { PROCESOS_DEL_SELECTOR } from "../../src/core/movimientos/ui-config";
import type { ContextoUsuario } from "../../src/server/sesion/contexto";

/**
 * Fase 7, P4: lo que ofrece la fila «Qué movimiento registrar» se filtra en el SERVIDOR por lo que el rol puede VER (Q2 del dueño): el selector no ofrece un proceso cuya pantalla el rol no abre.
 * Contra Postgres real, con la misma lectura que el menú.
 */
const ctxDe = (usuarioId: string, sucursalId: string) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, db: prisma }) as unknown as ContextoUsuario;

describe("procesosVisiblesDelSelector", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un administrador ve los 8, en el orden del selector", async () => {
    const base = await sembrarBase();
    await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const procesos = await procesosVisiblesDelSelector(ctxDe(admin.id, base.sucursal.id));
    expect(procesos.map((p) => p.href)).toEqual(PROCESOS_DEL_SELECTOR.map((p) => p.href));
  });

  it("un rol con solo algunas claves ve solo esos procesos (Reclasificar incluido o no), y uno sin ninguna, nada", async () => {
    const base = await sembrarBase();
    await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const poner = async (conVer: string[]) => {
      for (const p of PROCESOS_DEL_SELECTOR) {
        const tiene = conVer.includes(p.accion);
        await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: base.operador.id, accionClave: p.accion } }, data: { puedeVer: tiene, puedeEditar: tiene } });
      }
    };
    await poner(["proceso_consumo", "stock_reclasificar"]);
    expect((await procesosVisiblesDelSelector(ctxDe(operador.id, base.sucursal.id))).map((p) => p.etiquetaCorta)).toEqual(["Consumo", "Reclasificar"]);
    await poner(["stock_reclasificar"]);
    expect((await procesosVisiblesDelSelector(ctxDe(operador.id, base.sucursal.id))).map((p) => p.etiquetaCorta)).toEqual(["Reclasificar"]);
    await poner([]);
    expect(await procesosVisiblesDelSelector(ctxDe(operador.id, base.sucursal.id))).toEqual([]);
  });

  it("con el conjunto que ya calculó la página no vuelve a leer, y filtra igual", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const procesos = await procesosVisiblesDelSelector(ctxDe(admin.id, base.sucursal.id), new Set(["proceso_ajuste"]));
    expect(procesos.map((p) => p.etiquetaCorta)).toEqual(["Ajuste"]);
  });
});
