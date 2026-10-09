import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA } from "../../src/core/features/empresa/cupo-de-correo";
import { conCupoDeCorreo } from "../../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";

/**
 * M-14 (T16): bajo SERIALIZABLE lo que frena la reserva simultánea del cupo de correo es la detección de conflictos de Postgres (P2034) y el reintento de `conTransaccionSerializable`, no el
 * cerrojo. Con mucha concurrencia sobre la misma empresa los reintentos se agotan y el conflicto sale del caso de uso: el usuario recibía un error crudo en lugar del mensaje del cupo.
 * `conCupoDeCorreo` (que envuelve los tres casos de uso que mandan mails de invitación) ahora lo vuelve el mensaje del cupo: falla CERRADO, sin mail.
 */
const conflicto = () => new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock", { code: "P2034", clientVersion: "test" });
/** El conflicto de escritura que el adaptador `pg` deja pasar crudo (no es un PrismaClientKnownRequestError): `DriverAdapterError` con `cause.kind === "TransactionWriteConflict"`. */
const conflictoDelDriver = () => Object.assign(new Error("write conflict"), { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } });
const comoFracaso = (mensaje: string) => ({ ok: false as const, mensaje });

describe("conCupoDeCorreo: reintentos agotados por concurrencia (M-14)", () => {
  it("EL DEFECTO: un conflicto de escritura (P2034) que sale del caso de uso se vuelve el mensaje del cupo, no un error", async () => {
    const r = await conCupoDeCorreo(async () => {
      throw conflicto();
    }, comoFracaso);
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA });
    expect(MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA).toMatch(/cupo de mails de invitación/);
  });

  it("lo mismo con el conflicto crudo del driver", async () => {
    const r = await conCupoDeCorreo(async () => {
      throw conflictoDelDriver();
    }, comoFracaso);
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA });
  });

  it("cualquier otro error sigue de largo (no se enmascara una falla real como si fuera el cupo)", async () => {
    await expect(
      conCupoDeCorreo(async () => {
        throw new Error("la base no responde");
      }, comoFracaso),
    ).rejects.toThrow("la base no responde");
  });

  it("sin error devuelve lo que devuelve el caso de uso", async () => {
    expect(await conCupoDeCorreo(async () => ({ ok: true as const }), comoFracaso)).toEqual({ ok: true });
  });
});
