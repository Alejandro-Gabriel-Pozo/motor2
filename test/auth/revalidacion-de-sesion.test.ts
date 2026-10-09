import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { sesionSigueVigente } from "../../src/server/sesion/acceso";
import { crearRegistroDeRevalidacion, MAXIMO_DE_SESIONES_REVALIDADAS, REVALIDAR_SESION_CADA_MS } from "../../src/core/auth/revalidacion-de-sesion";
import * as base from "../../src/core/auth/base";

/**
 * M-20 (decidido por el dueño: «5 minutos»): quien pierde la membresía conservaba la sesión hasta 12 horas porque el callback `session` solo miraba `User.activoGlobal`.
 * Ahora la sesión se revalida contra la membresía a lo sumo cada 5 minutos por sesión.
 */
const T0 = AHORA_DE_LA_CORRIDA;
const en = (ms: number) => new Date(T0.getTime() + ms);

describe("revalidación de la sesión (M-20)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("el tope es de 5 minutos", () => {
    expect(REVALIDAR_SESION_CADA_MS).toBe(5 * 60 * 1000);
  });

  it("EL ATAQUE: la membresía se da de baja y la sesión, antes de 5 minutos, sigue; a los 5 minutos cae", async () => {
    const b = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "baja@gmail.com", sucursalId: b.sucursal.id, rolId: b.admin.id });
    const registro = crearRegistroDeRevalidacion();
    const entrada = (ms: number) => ({ sessionToken: "tok-baja", usuarioId: usuario.id, ahora: en(ms) });

    expect(await sesionSigueVigente(entrada(0), registro)).toBe(true); // revalidó: hay membresía

    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } }); // la baja

    expect(await sesionSigueVigente(entrada(REVALIDAR_SESION_CADA_MS - 1), registro)).toBe(true); // antes del tope no se mira la base
    expect(await sesionSigueVigente(entrada(REVALIDAR_SESION_CADA_MS), registro)).toBe(false); // al tope se relee y cae
    expect(await sesionSigueVigente(entrada(REVALIDAR_SESION_CADA_MS + 1000), registro)).toBe(false); // y el veredicto se recuerda
  });

  it("la baja de la pertenencia a la EMPRESA (UsuarioEmpresa.activo=false) también la corta", async () => {
    const b = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "baja-empresa@gmail.com", sucursalId: b.sucursal.id, rolId: b.admin.id });
    const registro = crearRegistroDeRevalidacion();
    expect(await sesionSigueVigente({ sessionToken: "tok-emp", usuarioId: usuario.id, ahora: T0 }, registro)).toBe(true);
    await prisma.usuarioEmpresa.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    expect(await sesionSigueVigente({ sessionToken: "tok-emp", usuarioId: usuario.id, ahora: en(REVALIDAR_SESION_CADA_MS) }, registro)).toBe(false);
  });

  it("dentro de la ventana NO se consulta la base (una consulta por sesión cada 5 minutos, no una por pedido)", async () => {
    const b = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "cache@gmail.com", sucursalId: b.sucursal.id, rolId: b.admin.id });
    const registro = crearRegistroDeRevalidacion();
    expect(await sesionSigueVigente({ sessionToken: "tok-cache", usuarioId: usuario.id, ahora: T0 }, registro)).toBe(true);
    const espia = vi.spyOn(base, "dbDeUsuario");
    for (let i = 1; i <= 20; i++) expect(await sesionSigueVigente({ sessionToken: "tok-cache", usuarioId: usuario.id, ahora: en(i * 1000) }, registro)).toBe(true);
    expect(espia).not.toHaveBeenCalled();
  });

  it("falla CERRADO con la base caída y no anota nada: el pedido siguiente reintenta", async () => {
    const b = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "caida@gmail.com", sucursalId: b.sucursal.id, rolId: b.admin.id });
    const registro = crearRegistroDeRevalidacion();
    const espia = vi.spyOn(base, "dbDeUsuario").mockImplementation(() => {
      throw new Error("connection refused");
    });
    expect(await sesionSigueVigente({ sessionToken: "tok-caida", usuarioId: usuario.id, ahora: T0 }, registro)).toBe(false);
    espia.mockRestore();
    expect(await sesionSigueVigente({ sessionToken: "tok-caida", usuarioId: usuario.id, ahora: en(1000) }, registro)).toBe(true); // se recuperó y revalidó
  });

  it("el invitado que todavía no aceptó (nunca tuvo pertenencia) conserva la sesión", async () => {
    const invitado = await prisma.user.create({ data: { email: "invitado@gmail.com" } });
    const registro = crearRegistroDeRevalidacion();
    expect(await sesionSigueVigente({ sessionToken: "tok-invitado", usuarioId: invitado.id, ahora: T0 }, registro)).toBe(true);
    expect(await sesionSigueVigente({ sessionToken: "tok-invitado", usuarioId: invitado.id, ahora: en(REVALIDAR_SESION_CADA_MS * 3) }, registro)).toBe(true);
  });

  it("el registro no crece sin límite", () => {
    const registro = crearRegistroDeRevalidacion(REVALIDAR_SESION_CADA_MS, 10);
    for (let i = 0; i < 100; i++) registro.anotar(`t${i}`, T0.getTime(), true);
    expect(registro.recordadas()).toBeLessThanOrEqual(10);
    expect(MAXIMO_DE_SESIONES_REVALIDADAS).toBeGreaterThan(0);
  });

  it("el callback `session` de lib/auth.ts pasa por sesionSigueVigente y sin token de sesión no hay sesión", () => {
    const auth = readFileSync(join(__dirname, "../../src/lib/auth.ts"), "utf8");
    expect(auth).toMatch(/async session\(\{ session, user \}\)[\s\S]*user\.activoGlobal && sessionToken && \(await sesionSigueVigente\(/);
  });
});
