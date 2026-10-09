import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { hashDeToken } from "../../src/core/seguridad/tokens";
import { AHORA_DE_LA_CORRIDA, DIA_MS } from "../setup/tiempo";
import { anotarInvitacionEnviada } from "../../src/server/persistencia/invitaciones/anotar-invitacion-enviada";

/**
 * Hito 3, I.5f: la marca de envío de una invitación (`enviadaEn`), que `enviarInvitacionYAnotar` escribe DESPUÉS de mandar el mail, fuera de toda transacción. Es
 * condicional a que la invitación siga PENDIENTE: si entre el commit y el envío la aceptaron o la revocaron, no se toca (ningún test lo recorría: el camino de la acción
 * lee la invitación pendiente justo antes y la carrera no se puede provocar desde afuera). Postgres real.
 */
const E = "empresa_principal";
const AHORA = AHORA_DE_LA_CORRIDA;

let invitador: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  invitador = (await prismaAdmin.user.create({ data: { email: "gestor@ejemplo.com" } })).id;
});

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

const invitacion = (estado: "PENDIENTE" | "REVOCADA" | "ACEPTADA", email: string) =>
  prismaAdmin.invitacion.create({
    data: {
      empresaId: E, email, rolEmpresa: "usuario", hashToken: hashDeToken(`${email}${"z".repeat(40)}`), venceEn: new Date(AHORA.getTime() + 7 * DIA_MS), invitadoPorId: invitador, estado,
      // Los CHECK de coherencia de la tabla: una revocada lleva su hora; una aceptada, la suya y quién la aceptó.
      ...(estado === "REVOCADA" && { revocadaEn: AHORA }),
      ...(estado === "ACEPTADA" && { aceptadaEn: AHORA, aceptadaPorId: invitador }),
    },
  });

describe("anotarInvitacionEnviada", () => {
  it("anota la hora del pedido en una invitación pendiente", async () => {
    const inv = await invitacion("PENDIENTE", "pendiente@ejemplo.com");
    await anotarInvitacionEnviada(prismaAdmin, { invitacionId: inv.id, ahora: AHORA });
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).enviadaEn).toEqual(AHORA);
  });

  it.each(["REVOCADA", "ACEPTADA"] as const)("no toca una invitación %s (la aceptaron o la revocaron entre el commit y el envío)", async (estado) => {
    const inv = await invitacion(estado, `${estado.toLowerCase()}@ejemplo.com`);
    await anotarInvitacionEnviada(prismaAdmin, { invitacionId: inv.id, ahora: AHORA });
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).enviadaEn).toBeNull();
  });
});
