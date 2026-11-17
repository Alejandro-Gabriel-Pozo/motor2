import { describe, expect, it } from "vitest";
import { apagadoRechazadoPorComprasPendientes, MODULO_CON_GUARDA_DE_APAGADO, textoDeApagadoRechazado } from "@/core/modulos/guarda-de-apagado";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import { cambiarModulosDesdeLaConsola } from "../../plataforma/src/servidor/modulos";

/**
 * El reconocimiento del rechazo de la guarda de apagado (`src/core/modulos/guarda-de-apagado.ts`): por la marca del mensaje de la base, en el mensaje del error o en la causa del driver; nada más lo es. El texto es el mismo para la consola y el
 * script. El choque contra la base real lo prueba `test/persistencia/guarda-de-apagado-recepcion.test.ts`.
 */
const conMensaje = (mensaje: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(mensaje), extra);

describe("apagadoRechazadoPorComprasPendientes", () => {
  it("lee la cantidad y las sucursales del mensaje del error", () => {
    expect(apagadoRechazadoPorComprasPendientes(conMensaje("Database error. Code: `23514`. Message: `GUARDA_APAGADO_RECEPCION|3|Centro, Norte`"))).toEqual({ cantidad: 3, sucursales: ["Centro", "Norte"] });
  });
  it("lo lee también de la causa del driver (meta.driverAdapterError.cause)", () => {
    const e = conMensaje("raw query failed", { meta: { driverAdapterError: { cause: { originalMessage: "GUARDA_APAGADO_RECEPCION|1|Norte" } } } });
    expect(apagadoRechazadoPorComprasPendientes(e)).toEqual({ cantidad: 1, sucursales: ["Norte"] });
  });
  it("cantidad 0 = la base no pudo comprobarlo y cerró (sin sucursales)", () => {
    expect(apagadoRechazadoPorComprasPendientes(conMensaje("GUARDA_APAGADO_RECEPCION|0|no se puede comprobar si hay compras pendientes"))).toEqual({ cantidad: 0, sucursales: [] });
  });
  it("cualquier otro error, o una marca que no se puede leer entera, NO es el rechazo (sigue de largo)", () => {
    for (const e of [conMensaje("deadlock detected"), conMensaje("GUARDA_APAGADO_RECEPCION|x|Norte"), conMensaje("GUARDA_APAGADO_RECEPCION|1"), "GUARDA_APAGADO_RECEPCION|1|Norte", null, undefined, {}]) {
      expect(apagadoRechazadoPorComprasPendientes(e)).toBeNull();
    }
  });
});

describe("textoDeApagadoRechazado", () => {
  it("dice cuántas compras y de qué sucursales, y qué hacer", () => {
    expect(textoDeApagadoRechazado({ cantidad: 2, sucursales: ["Centro", "Norte"] })).toBe("No se puede apagar la recepción separada de compras: hay 2 compra(s) pendientes de recibir (sucursales: Centro, Norte). Recibilas o anulalas antes.");
  });
  it("con cantidad 0 dice que no se pudo comprobar (falla cerrado)", () => {
    expect(textoDeApagadoRechazado({ cantidad: 0, sucursales: [] })).toBe("No se puede apagar la recepción separada de compras: no se pudo comprobar si hay compras pendientes de recibir. Probá de nuevo.");
  });
});

describe("si no se puede escribir el rastro del intento rechazado, el rechazo igual se informa (y el texto lo dice)", () => {
  const TEXTO = "No se puede apagar la recepción separada de compras: hay 1 compra(s) pendientes de recibir (sucursales: Norte). Recibilas o anulalas antes.";
  const SIN_RASTRO = " No se pudo dejar el rastro del intento en la auditoría de plataforma.";
  const rechazoDeLaBase = () => conMensaje("Database error. Code: `23514`. Message: `GUARDA_APAGADO_RECEPCION|1|Norte`");
  const sinAuditoria = { create: async () => { throw new Error("la auditoría no responde"); } };

  it("consola: devuelve el resultado de error con el texto y el aviso", async () => {
    const db = { $transaction: async () => { throw rechazoDeLaBase(); }, auditoriaPlataforma: sinAuditoria } as never;
    expect(await cambiarModulosDesdeLaConsola(db, { adminId: "a", adminEmail: "a@x.com", instalacionId: "principal" }, "empresa-1", { desactivar: [MODULO_CON_GUARDA_DE_APAGADO] })).toEqual({ ok: false, mensaje: TEXTO + SIN_RASTRO });
  });

  it("script: lanza el error de negocio con el texto y el aviso", async () => {
    const tx = {
      $queryRaw: async () => [],
      $executeRaw: async () => 0,
      empresa: { findUnique: async () => ({ id: "empresa-1" }) },
      moduloEmpresa: { findMany: async () => [{ empresaId: "empresa-1", modulo: MODULO_CON_GUARDA_DE_APAGADO, estado: "ACTIVO" }], upsert: async () => { throw rechazoDeLaBase(); } },
    };
    const db = { $transaction: async (cuerpo: (t: typeof tx) => Promise<unknown>) => cuerpo(tx), auditoriaPlataforma: sinAuditoria } as never;
    await expect(cambiarModulosDeEmpresa(db, { slug: "principal", desactivar: [MODULO_CON_GUARDA_DE_APAGADO] }, { adminId: "a", adminEmail: "a@x.com", instalacionId: "principal", instalacionNombre: "principal" })).rejects.toThrow(TEXTO + SIN_RASTRO);
  });

  it("un error de la base que NO es el rechazo sigue de largo, sin rastro de rechazo", async () => {
    const db = { $transaction: async () => { throw new Error("deadlock detected"); }, auditoriaPlataforma: { create: async () => { throw new Error("no debería llamarse"); } } } as never;
    await expect(cambiarModulosDesdeLaConsola(db, { adminId: "a", adminEmail: "a@x.com", instalacionId: "principal" }, "empresa-1", { desactivar: [MODULO_CON_GUARDA_DE_APAGADO] })).rejects.toThrow("deadlock detected");
  });
});
