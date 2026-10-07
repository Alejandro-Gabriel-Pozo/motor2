import { describe, expect, it } from "vitest";
import { decidirSobreLaInvitacionPendiente, mensajeSiSeReenviaMuyPronto } from "../../../../src/core/features/empresa/invitacion";

/**
 * Hito 3, I.5e2: la decisión sobre la invitación pendiente de un email (otro tipo / vigente / vencida / ninguna), que `asegurarInvitacionDeUsuario` y
 * `asegurarInvitacionDeVinculacion` hacían en línea, es una función pura de `core/features/empresa/invitacion.ts`. Mismo orden y mismos textos; el comportamiento lo
 * siguen fijando la huella de gobierno y `test/persistencia/invitacion-de-usuario.test.ts`, que dan idéntico. Acá la tabla, con el borde exacto del vencimiento.
 */
const AHORA = new Date(Date.UTC(2026, 0, 15, 12));
const EMAIL = "nueva@ejemplo.com";
const pendiente = (tipo: string, venceEnMs: number) => ({ tipo, venceEn: new Date(AHORA.getTime() + venceEnMs) });

describe("decidirSobreLaInvitacionPendiente", () => {
  it.each([
    ["sin pendiente: crear", null, "usuario", { accion: "crear" }],
    ["de usuario vigente: extender", pendiente("usuario", 1), "usuario", { accion: "extender" }],
    ["de usuario que vence justo ahora: ya está vencida, rotar", pendiente("usuario", 0), "usuario", { accion: "rotar" }],
    ["de usuario vencida: rotar", pendiente("usuario", -1), "usuario", { accion: "rotar" }],
    ["de vinculación vigente: extender", pendiente("vinculacion", 1), "vinculacion", { accion: "extender" }],
    ["de vinculación vencida: rotar", pendiente("vinculacion", -1), "vinculacion", { accion: "rotar" }],
    ["sin pendiente, vinculación: crear", null, "vinculacion", { accion: "crear" }],
  ] as const)("%s", (_caso, p, pedida, esperado) => {
    expect(decidirSobreLaInvitacionPendiente(p, pedida, EMAIL, AHORA)).toEqual(esperado);
  });

  it("otro tipo pendiente (vigente o vencida) se rechaza ANTES de mirar el vencimiento, con el texto de cada tipo pedido", () => {
    for (const venceEn of [1, -1]) {
      expect(decidirSobreLaInvitacionPendiente(pendiente("gerente", venceEn), "usuario", EMAIL, AHORA)).toEqual({
        accion: "rechazar",
        mensaje: `Ya hay una invitación pendiente para ${EMAIL} que no es de usuario. Revocala o esperá a que se acepte.`,
      });
      expect(decidirSobreLaInvitacionPendiente(pendiente("usuario", venceEn), "vinculacion", EMAIL, AHORA)).toEqual({
        accion: "rechazar",
        mensaje: `Ya hay una invitación pendiente para ${EMAIL} que no es de vinculación.`,
      });
    }
  });
});

describe("mensajeSiSeReenviaMuyPronto (I.5h: el freno de un minuto de reenviar e invitar a vincular)", () => {
  const ESPERAR = "Esa invitación se envió hace menos de un minuto. Esperá un momento antes de reenviarla.";
  it.each([
    ["nunca salió (null)", null, null],
    ["sin invitación previa (undefined)", undefined, null],
    ["salió hace 59,999 s: frena", new Date(AHORA.getTime() - 59_999), ESPERAR],
    ["salió hace exactamente un minuto: ya deja", new Date(AHORA.getTime() - 60_000), null],
    ["salió hace una hora: deja", new Date(AHORA.getTime() - 3_600_000), null],
  ] as const)("%s", (_caso, enviadaEn, esperado) => {
    expect(mensajeSiSeReenviaMuyPronto(enviadaEn, AHORA)).toBe(esperado);
  });
});
