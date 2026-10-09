import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { cifrarSecreto } from "../../../src/core/plataforma/cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigo, hashDeCodigoDeRecuperacion } from "../../../src/core/plataforma/codigos";
import { COOKIE_DE_PEDIDO_HTTP, COOKIE_DE_PEDIDO_HTTPS, leerPedidoDeIngreso } from "../../../src/core/plataforma/pedido-de-ingreso";
import { codigoTotp, generarSecretoTotp, pasoDeTotp } from "../../../src/core/plataforma/totp";
import { crearPrismaE2E, resolverUrlE2E, resolverUrlE2EB } from "./base-e2e";
import { azarDelProceso } from "../../../src/lib/azar";

/**
 * La consola de plataforma en los E2E (E4, ADR-019): sus dos secretos son valores FIJOS y descartables (la base E2E se vacía en cada corrida), compartidos entre
 * `playwright.config.ts` (que se los pasa al servidor de la consola) y los specs (que siembran un administrador cifrado con ellos y firman un código de ingreso
 * conocido, porque el mail de la consola no se puede leer desde otro proceso). Nunca se usan fuera de esta suite.
 */
export const SECRETO_DE_CODIGOS_E2E = "e2e-consola-secreto-de-codigos-descartable-0123456789";
export const CLAVE_TOTP_E2E = Buffer.alloc(32, 7).toString("base64");

export interface AdminSembrado {
  id: string;
  email: string;
  secretoTotp: string;
  codigosDeRecuperacion: string[];
}

/** Siembra un administrador activo con TOTP y códigos de recuperación, con la conexión del DUEÑO (la consola, con su rol, no puede crear administradores). */
export async function sembrarAdminDePlataforma(email: string): Promise<AdminSembrado> {
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    const id = randomUUID();
    const secretoTotp = generarSecretoTotp(azarDelProceso);
    await prisma.adminPlataforma.create({ data: { id, email, nombre: "Admin E2E", secretoTotp: cifrarSecreto(secretoTotp, CLAVE_TOTP_E2E, id, azarDelProceso) } });
    const codigosDeRecuperacion = generarCodigosDeRecuperacion(azarDelProceso, 3);
    await prisma.codigoDeRecuperacionPlataforma.createMany({
      data: codigosDeRecuperacion.map((codigo) => ({ adminId: id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, SECRETO_DE_CODIGOS_E2E, id) })),
    });
    return { id, email, secretoTotp, codigosDeRecuperacion };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reemplaza el código que la consola acaba de generar para el pedido de ESTE navegador (el real solo viaja por mail) por uno que el spec conoce, firmado como lo
 * firma la consola (S-08): el código es de la cookie del pedido —`codigoId` + `nonce`, que el spec lee del contexto del navegador— y la consola lo prepara DESPUÉS de
 * responder (`after()`), así que se espera a que aparezca (hasta 10 s). Devuelve cuántos códigos fijó (1 si el pedido ya se procesó, 0 si nunca apareció).
 */
export async function fijarCodigoDeIngreso(page: Page, adminId: string, codigo: string): Promise<number> {
  const cookies = await page.context().cookies();
  const cookie = cookies.find((c) => c.name === COOKIE_DE_PEDIDO_HTTP || c.name === COOKIE_DE_PEDIDO_HTTPS);
  const pedido = leerPedidoDeIngreso(cookie?.value);
  if (!pedido) return 0;
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    for (let intento = 0; intento < 50; intento++) {
      const fila = await prisma.codigoDeIngresoPlataforma.findFirst({ where: { id: pedido.codigoId, adminId, usadoEn: null, invalidadoEn: null }, select: { id: true } });
      if (fila) {
        const hashCodigo = hashDeCodigo(codigo, SECRETO_DE_CODIGOS_E2E, `ingreso:${adminId}:${pedido.codigoId}:${pedido.nonce}`);
        await prisma.codigoDeIngresoPlataforma.update({ where: { id: fila.id }, data: { hashCodigo } });
        return 1;
      }
      await new Promise((resolver) => setTimeout(resolver, 200));
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

export async function leerDeLaBase<T>(consulta: (prisma: ReturnType<typeof crearPrismaE2E>) => Promise<T>): Promise<T> {
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    return await consulta(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const CODIGO_DE_INGRESO_CONOCIDO = "482915";

/**
 * Ingresa a la consola como un administrador recién sembrado: email, código del mail (reemplazado por uno conocido) y TOTP. Termina en la pantalla de inicio.
 * `consola` es la dirección de la consola (`MOTOR2_E2E_URL_PLATAFORMA`).
 */
export async function ingresarALaConsola(page: Page, consola: string): Promise<AdminSembrado> {
  const admin = await sembrarAdminDePlataforma(`admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@plataforma.test`);
  await page.goto(`${consola}/login`);
  await page.locator("#email").fill(admin.email);
  await page.getByRole("button", { name: "Pedir código" }).click();
  await expect(page.locator("#codigo")).toBeVisible();
  expect(await fijarCodigoDeIngreso(page, admin.id, CODIGO_DE_INGRESO_CONOCIDO)).toBe(1);
  await page.locator("#codigo").fill(CODIGO_DE_INGRESO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#factor")).toBeVisible();
  await page.locator("#factor").fill(codigoTotp(admin.secretoTotp, pasoDeTotp(Date.now())));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(`${consola}/`);
  return admin;
}

/** Los ids de las dos instalaciones de la consola en los E2E (ADR-025): A es la principal (la base de siempre) y B la segunda base. */
export const INSTALACION_A = "e2ea";
export const INSTALACION_B = "e2eb";

/** Lo mismo que `leerDeLaBase`, pero sobre la base de la SEGUNDA instalación (como dueño). */
export async function leerDeLaBaseB<T>(consulta: (prisma: ReturnType<typeof crearPrismaE2E>) => Promise<T>): Promise<T> {
  const base = resolverUrlE2EB(process.env);
  if (!base) throw new Error("No hay segunda base E2E (MOTOR2_E2E_B_DATABASE_URL).");
  const prisma = crearPrismaE2E(base);
  try {
    return await consulta(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
