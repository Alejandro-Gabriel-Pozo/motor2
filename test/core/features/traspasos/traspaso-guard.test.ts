import { describe, expect, it } from "vitest";
import type { EstadoTraspaso } from "@prisma/client";
import { guardTransicionTraspaso } from "../../../../src/core/features/traspasos/traspaso.guard";
import type { OperacionTraspaso } from "../../../../src/core/features/traspasos/traspaso.schema";

/**
 * Guard de transición de un Traspaso (src/core/features/traspasos/traspaso.guard.ts): puro. Tabla EXHAUSTIVA — 6 operaciones × 7
 * estados × {origen, destino, ajena} — contra una tabla esperada escrita acá a mano (no se deriva de la del guard: si alguien cambia
 * una transición o un mensaje allá, este test lo marca). Los mensajes son los que ya devolvían las Server Actions antes de extraer
 * el guard; test/traspasos/*.test.ts y test/auditoria/traspasos-en-transito.test.ts los comparan con regex.
 */

const ESTADOS: EstadoTraspaso[] = ["SOLICITADA", "ENVIADA", "ACEPTADA", "RECHAZADA_ORIGEN", "RECHAZADA_DESTINO", "CERRADA", "CANCELADA"];
const OPERACIONES: OperacionTraspaso[] = ["aprobar", "rechazar_solicitud", "cancelar_solicitud", "aceptar", "rechazar_envio", "confirmar_reingreso"];

const ORIGEN = "suc-origen";
const DESTINO = "suc-destino";
const AJENA = "suc-ajena";

const NO_ES_ORIGEN = "Este traspaso no está dirigido a esta sucursal como origen.";
const NO_ES_DESTINO = "Este traspaso no está dirigido a esta sucursal como destino.";

const ESPERADO: Record<OperacionTraspaso, { lado: string; desde: EstadoTraspaso; hacia: EstadoTraspaso; mensajeLado: string; mensajeEstado: (e: string) => string }> = {
  aprobar: { lado: ORIGEN, desde: "SOLICITADA", hacia: "ENVIADA", mensajeLado: NO_ES_ORIGEN, mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede aprobar de nuevo.` },
  rechazar_solicitud: { lado: ORIGEN, desde: "SOLICITADA", hacia: "RECHAZADA_ORIGEN", mensajeLado: NO_ES_ORIGEN, mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede rechazar desde acá.` },
  cancelar_solicitud: { lado: DESTINO, desde: "SOLICITADA", hacia: "CANCELADA", mensajeLado: "Esta solicitud no la creó esta sucursal.", mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede cancelar desde acá.` },
  aceptar: { lado: DESTINO, desde: "ENVIADA", hacia: "ACEPTADA", mensajeLado: NO_ES_DESTINO, mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no se puede aceptar.` },
  rechazar_envio: { lado: DESTINO, desde: "ENVIADA", hacia: "RECHAZADA_DESTINO", mensajeLado: NO_ES_DESTINO, mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no se puede rechazar desde acá.` },
  confirmar_reingreso: { lado: ORIGEN, desde: "RECHAZADA_DESTINO", hacia: "CERRADA", mensajeLado: NO_ES_ORIGEN, mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no hay ningún reingreso pendiente.` },
};

const CASOS = OPERACIONES.flatMap((operacion) =>
  ESTADOS.flatMap((estado) => [ORIGEN, DESTINO, AJENA].map((sucursalId) => ({ operacion, estado, sucursalId })))
);

describe("guardTransicionTraspaso", () => {
  it("la tabla cubre las 6 operaciones × 7 estados × 3 lados", () => {
    expect(CASOS).toHaveLength(6 * 7 * 3);
  });

  it.each(CASOS)("$operacion desde $estado, actuando $sucursalId", ({ operacion, estado, sucursalId }) => {
    const e = ESPERADO[operacion];
    const r = guardTransicionTraspaso({ estado, origenSucursalId: ORIGEN, destinoSucursalId: DESTINO }, operacion, sucursalId);
    if (sucursalId !== e.lado) {
      // El lado se chequea ANTES que el estado: una sucursal equivocada nunca se entera del estado del traspaso.
      expect(r).toEqual({ ok: false, motivo: "LADO", mensaje: e.mensajeLado });
    } else if (estado !== e.desde) {
      expect(r).toEqual({ ok: false, motivo: "ESTADO", mensaje: e.mensajeEstado(estado) });
    } else {
      expect(r).toEqual({ ok: true, estadoNuevo: e.hacia });
    }
  });

  it("cada operación tiene exactamente UNA combinación válida (su estado de partida, desde su lado)", () => {
    for (const operacion of OPERACIONES) {
      const validas = CASOS.filter((c) => c.operacion === operacion).filter(
        (c) => guardTransicionTraspaso({ estado: c.estado, origenSucursalId: ORIGEN, destinoSucursalId: DESTINO }, c.operacion, c.sucursalId).ok
      );
      expect(validas, operacion).toHaveLength(1);
    }
  });

  it("ningún estado terminal (ACEPTADA, RECHAZADA_ORIGEN, CERRADA, CANCELADA) admite ninguna operación, desde ningún lado", () => {
    const terminales: EstadoTraspaso[] = ["ACEPTADA", "RECHAZADA_ORIGEN", "CERRADA", "CANCELADA"];
    for (const c of CASOS.filter((x) => terminales.includes(x.estado))) {
      expect(guardTransicionTraspaso({ estado: c.estado, origenSucursalId: ORIGEN, destinoSucursalId: DESTINO }, c.operacion, c.sucursalId).ok).toBe(false);
    }
  });

  it("los mensajes siguen matcheando las regex que ya usan los tests de las Server Actions", () => {
    const t = (estado: EstadoTraspaso, op: OperacionTraspaso, suc: string) =>
      guardTransicionTraspaso({ estado, origenSucursalId: ORIGEN, destinoSucursalId: DESTINO }, op, suc);
    expect(t("RECHAZADA_DESTINO", "rechazar_envio", DESTINO)).toMatchObject({ mensaje: expect.stringMatching(/no se puede rechazar desde acá/) });
    expect(t("ACEPTADA", "aceptar", DESTINO)).toMatchObject({ mensaje: expect.stringMatching(/no se puede aceptar/i) });
    expect(t("CERRADA", "confirmar_reingreso", ORIGEN)).toMatchObject({ mensaje: expect.stringMatching(/no hay ningún reingreso pendiente/) });
  });
});
