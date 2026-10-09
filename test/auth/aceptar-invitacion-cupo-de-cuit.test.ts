import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __limpiarCookiesDeTest, __setCookieDeTest } from "../setup/next-headers-stub";
import { aceptarMiInvitacion } from "../../src/server/actions/auth/invitacion";
import { MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION, MENSAJE_DEMASIADAS_CONSULTAS_DE_CUIT } from "../../src/server/actions/limitador-anonimo";
import { nombreCookieInvitacion } from "../../src/core/auth/invitacion";
import { validarCuit } from "../../src/core/fiscal/public";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * S-18 (T8 del endurecimiento; B-A11): al aceptar la invitación del primer gerente, el invitado todavía no tiene empresa pero SÍ puede probar CUITs a voluntad: «Ya hay una empresa con ese
 * CUIT» contra «sigue» le decía, por cada CUIT, si ese CUIT es cliente de la instalación (y de ahí, qué empresas la usan). Ahora la prueba de un CUIT que llega a mirar la tabla de empresas
 * tiene cupo por usuario e invitación (best effort, en memoria, como el resto de los cupos de la app): pasado el cupo, la respuesta es la misma exista o no el CUIT, y sin consultar `Empresa`.
 * Contra Postgres real, por la Server Action `aceptarMiInvitacion` (la que lleva el cupo); el comportamiento del caso de uso sin cupo lo fijan las huellas de aceptación.
 */
const EMPRESA_EN_ALTA = "en-alta-s18";

/** `n` CUITs válidos y distintos (prefijo 30, dígito verificador calculado por el mismo validador que usa el sistema). */
function cuitsValidos(n: number, desde = 51_000_000): string[] {
  const salida: string[] = [];
  for (let cuerpo = desde; salida.length < n; cuerpo++) {
    for (let dv = 0; dv <= 9; dv++) {
      const candidato = `30${cuerpo}${dv}`;
      const r = validarCuit(candidato);
      if (r.ok && r.valor) {
        salida.push(candidato);
        break;
      }
    }
  }
  return salida;
}

async function empresaEnAlta(id: string) {
  await prismaAdmin.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
    await sembrarEmpresa(tx, id, "Central");
  });
}

/** Un invitado a gerente con su sesión y la cookie de la invitación puestas: lo que tiene quien abrió el enlace y volvió de Google. */
async function invitadoComo(email: string, empresaId = EMPRESA_EN_ALTA) {
  const token = generarTokenOpaco(azarDelProceso);
  await prismaAdmin.invitacion.create({ data: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn: new Date(Date.now() + 3_600_000) } });
  const usuario = await prismaAdmin.user.upsert({ where: { email }, update: {}, create: { email } });
  await mockearUsuarioActual({ id: usuario.id, email, nombre: null });
  __setCookieDeTest(nombreCookieInvitacion(process.env), token);
  return { token, usuario };
}

const probar = (cuit: string) => {
  const f = new FormData();
  f.set("cuit", cuit);
  return aceptarMiInvitacion(f);
};

beforeEach(async () => {
  __limpiarCookiesDeTest();
  await limpiarBaseDeTest();
  await empresaEnAlta(EMPRESA_EN_ALTA);
});

describe("aceptarMiInvitacion: cupo de pruebas de CUIT (S-18)", () => {
  it("EL ATAQUE: el invitado prueba CUITs de clientes → pasado el cupo, la respuesta no cambia exista o no el CUIT, y la invitación sigue intacta", async () => {
    const clientes = cuitsValidos(MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION + 2);
    for (const [i, cuit] of clientes.entries()) {
      await prismaAdmin.empresa.create({ data: { id: `cliente-${i}`, nombre: `Cliente ${i}`, slug: `cliente-${i}`, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit } });
    }
    const { token } = await invitadoComo("sondeador@gmail.com");

    const respuestas = [];
    for (const cuit of clientes) respuestas.push(await probar(cuit));
    // Dentro del cupo, el aviso de siempre; después del cupo, el del cupo (igual para todo CUIT).
    expect(respuestas.slice(0, MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION).every((r) => !r.ok && /Ya hay una empresa con ese CUIT/.test(r.mensaje))).toBe(true);
    expect(respuestas.slice(MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION).every((r) => !r.ok && r.mensaje === MENSAJE_DEMASIADAS_CONSULTAS_DE_CUIT)).toBe(true);

    // Un CUIT que NO es de ningún cliente recibe EXACTAMENTE la misma respuesta que uno que sí lo es: ya no se puede distinguir. Y ni siquiera acepta la invitación.
    const [libre] = cuitsValidos(1, 52_000_000);
    expect(await probar(libre!)).toEqual(respuestas.at(-1));
    const inv = await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } });
    expect(inv.estado).toBe("PENDIENTE");
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: EMPRESA_EN_ALTA } })).toBe(0);
  });

  it("el cupo es de cada usuario e invitación: otro invitado sigue pudiendo probar", async () => {
    const [cuit] = cuitsValidos(1);
    await prismaAdmin.empresa.create({ data: { id: "cliente-unico", nombre: "Cliente", slug: "cliente-unico", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit } });
    await invitadoComo("agotado@gmail.com");
    for (let i = 0; i < MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION + 1; i++) await probar(cuit!);
    expect((await probar(cuit!)).mensaje).toBe(MENSAJE_DEMASIADAS_CONSULTAS_DE_CUIT);

    await empresaEnAlta("otra-en-alta-s18");
    await invitadoComo("otro@gmail.com", "otra-en-alta-s18");
    expect((await probar(cuit!)).mensaje).toMatch(/Ya hay una empresa con ese CUIT/);
  });

  it("lo que no llega a mirar la tabla de empresas no gasta cupo: un CUIT mal escrito no cuenta (el que se equivoca de tecla no se queda sin intentos)", async () => {
    const [cuit] = cuitsValidos(1);
    await prismaAdmin.empresa.create({ data: { id: "cliente-unico", nombre: "Cliente", slug: "cliente-unico", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit } });
    await invitadoComo("torpe@gmail.com");
    for (let i = 0; i < 3 * MAXIMO_DE_CONSULTAS_DE_CUIT_POR_INVITACION; i++) expect((await probar("123")).mensaje).toMatch(/formato válido/);
    expect((await probar(cuit!)).mensaje).toMatch(/Ya hay una empresa con ese CUIT/);
  });
});
