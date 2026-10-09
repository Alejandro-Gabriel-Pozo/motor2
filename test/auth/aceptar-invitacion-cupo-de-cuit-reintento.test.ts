import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * M-23 (T16): el cupo de pruebas de CUIT (S-18) se descontaba DENTRO del cuerpo de la transacción SERIALIZABLE, y esa transacción se reintenta ante un conflicto de escritura (P2034): un solo
 * intento lógico del invitado gastaba dos (o más) pruebas del cupo de cinco. El descuento tiene que ocurrir UNA vez por intento lógico, aunque la transacción corra de nuevo.
 * Se fuerza el reintento haciendo fallar con P2034 la primera marca de «aceptada» (la que corre justo antes de incorporar al gerente), y el resto pasa por el código real.
 */
const marcas = vi.hoisted(() => ({ llamadas: 0, fallarLasPrimeras: 1 }));
vi.mock("../../src/server/persistencia/invitaciones/marcar-invitacion-aceptada", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/persistencia/invitaciones/marcar-invitacion-aceptada")>();
  return {
    ...real,
    marcarInvitacionAceptada: async (...args: Parameters<typeof real.marcarInvitacionAceptada>) => {
      marcas.llamadas++;
      if (marcas.llamadas <= marcas.fallarLasPrimeras) {
        throw new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock", { code: "P2034", clientVersion: "test" });
      }
      return real.marcarInvitacionAceptada(...args);
    },
  };
});

import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { aceptarInvitacionDeGerenteCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente";
import { validarCuit } from "../../src/core/fiscal/public";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

const EMPRESA_EN_ALTA = "en-alta-m23";

function cuitValido(desde = 53_000_000): string {
  for (let cuerpo = desde; ; cuerpo++) {
    for (let dv = 0; dv <= 9; dv++) {
      const candidato = `30${cuerpo}${dv}`;
      if (validarCuit(candidato).ok) return candidato;
    }
  }
}

async function invitado() {
  await prismaAdmin.empresa.create({ data: { id: EMPRESA_EN_ALTA, nombre: "Empresa en alta", slug: EMPRESA_EN_ALTA, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${EMPRESA_EN_ALTA}, true)`;
    await sembrarEmpresa(tx, EMPRESA_EN_ALTA, "Central");
  });
  const token = generarTokenOpaco(azarDelProceso);
  const email = "invitado-m23@gmail.com";
  await prismaAdmin.invitacion.create({ data: { empresaId: EMPRESA_EN_ALTA, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn: new Date(AHORA_DE_LA_CORRIDA.getTime() + 3_600_000) } });
  const usuario = await prismaAdmin.user.create({ data: { email } });
  return { token, usuario: { id: usuario.id, email } };
}

beforeEach(async () => {
  marcas.llamadas = 0;
  marcas.fallarLasPrimeras = 1;
  await limpiarBaseDeTest();
});

describe("aceptar la invitación del primer gerente: el cupo de CUIT y el reintento serializable (M-23)", () => {
  it("EL DEFECTO: un reintento por conflicto de escritura (P2034) descuenta UNA sola prueba de CUIT, no una por intento de la transacción", async () => {
    const { token, usuario } = await invitado();
    const descuentos = vi.fn(() => false);
    const r = await aceptarInvitacionDeGerenteCasoDeUso({ token, usuario, cuit: cuitValido(), ahora: AHORA_DE_LA_CORRIDA, consultaDeCuitSinCupo: descuentos });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(marcas.llamadas, "la transacción corrió dos veces: el reintento ocurrió de verdad").toBe(2);
    expect(descuentos).toHaveBeenCalledTimes(1);
  });

  it("sin reintento sigue descontando una vez (el comportamiento de siempre)", async () => {
    marcas.fallarLasPrimeras = 0;
    const { token, usuario } = await invitado();
    const descuentos = vi.fn(() => false);
    const r = await aceptarInvitacionDeGerenteCasoDeUso({ token, usuario, cuit: cuitValido(), ahora: AHORA_DE_LA_CORRIDA, consultaDeCuitSinCupo: descuentos });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(marcas.llamadas).toBe(1);
    expect(descuentos).toHaveBeenCalledTimes(1);
  });

  it("dos intentos lógicos SEPARADOS (dos pedidos del invitado) siguen descontando una prueba cada uno", async () => {
    marcas.fallarLasPrimeras = 0;
    const { token, usuario } = await invitado();
    const descuentos = vi.fn(() => false);
    const cuit = cuitValido();
    // El CUIT ya es de otra empresa: el pedido llega a mirar la tabla (cuenta) y se rechaza sin aceptar nada.
    await prismaAdmin.empresa.create({ data: { id: "cliente-m23", nombre: "Cliente", slug: "cliente-m23", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit } });
    for (let i = 0; i < 3; i++) {
      const r = await aceptarInvitacionDeGerenteCasoDeUso({ token, usuario, cuit, ahora: AHORA_DE_LA_CORRIDA, consultaDeCuitSinCupo: descuentos });
      expect(r.ok).toBe(false);
    }
    expect(descuentos).toHaveBeenCalledTimes(3);
  });
});
