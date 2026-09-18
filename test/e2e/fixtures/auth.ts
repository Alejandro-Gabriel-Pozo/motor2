import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test as base, type Page } from "@playwright/test";
import { prisma } from "../../../src/lib/db";
import { ACCIONES } from "../../../src/core/permisos/acciones";

const SUCURSAL_NOMBRE = "Central";
const SECCION_NOMBRE = "Depósito E2E";
const EMAIL_ADMIN_E2E = "e2e-admin@local.test";

/** Mismas 5 unidades base que prisma/seed.ts — duplicado a propósito (ese
 * script no exporta nada, es un entry point, no un módulo para importar). */
const UNIDADES_BASE: Array<{ nombre: string; magnitud: "PESO" | "VOLUMEN" | "CANTIDAD"; decimales: number }> = [
  { nombre: "kg", magnitud: "PESO", decimales: 2 },
  { nombre: "g", magnitud: "PESO", decimales: 0 },
  { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
  { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
  { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
];

/**
 * Auth de verdad para E2E sin pasar por Google OAuth (no hay credenciales
 * reales disponibles en un entorno sandboxeado/CI): crea una fila `Session`
 * real (misma tabla que usa el adapter de Auth.js, estrategia "database")
 * y la manda como cookie `authjs.session-token` — el server la valida
 * exactamente igual que una sesión real, porque ES una sesión real, solo
 * que el login se saltea.
 *
 * Descubierto necesario probando el wizard de Compra a mano (sesión
 * 2026-09-17, fix de QuickCrearProducto/QuickCrear): sin esto, cualquier
 * spec de Playwright contra una página protegida solo ve el redirect a
 * /login.
 */
async function asegurarBaseSeed() {
  const [admin, operador] = await Promise.all([
    prisma.rol.upsert({ where: { nombre: "admin" }, update: {}, create: { nombre: "admin" } }),
    prisma.rol.upsert({ where: { nombre: "operador" }, update: {}, create: { nombre: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await prisma.accion.upsert({ where: { clave: accion.clave }, update: { descripcion: accion.descripcion }, create: { clave: accion.clave, descripcion: accion.descripcion } });
    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = accion.rolesEditarSemilla.includes(nombreRol);
      await prisma.permisoRol.upsert({
        where: { rolId_accionClave: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave } },
        update: {},
        create: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave, puedeEditar, puedeVer: puedeEditar },
      });
    }
  }

  const sucursal = await prisma.sucursal.upsert({ where: { nombre: SUCURSAL_NOMBRE }, update: {}, create: { nombre: SUCURSAL_NOMBRE } });

  for (const u of UNIDADES_BASE) await prisma.unidad.upsert({ where: { nombre: u.nombre }, update: {}, create: u });

  let seccion = await prisma.seccion.findFirst({ where: { sucursalId: sucursal.id, nombre: SECCION_NOMBRE } });
  if (!seccion) seccion = await prisma.seccion.create({ data: { sucursalId: sucursal.id, nombre: SECCION_NOMBRE } });

  return { sucursal, seccion, admin };
}

async function crearSesionAdmin() {
  const { sucursal, seccion, admin } = await asegurarBaseSeed();

  const user = await prisma.user.upsert({
    where: { email: EMAIL_ADMIN_E2E },
    update: { activoGlobal: true },
    create: { email: EMAIL_ADMIN_E2E, activoGlobal: true },
  });

  const membresia = await prisma.usuarioSucursal.findFirst({ where: { usuarioId: user.id, sucursalId: sucursal.id } });
  if (!membresia) await prisma.usuarioSucursal.create({ data: { usuarioId: user.id, sucursalId: sucursal.id, rolId: admin.id, activo: true } });

  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

  return { sessionToken, sucursalId: sucursal.id, seccionId: seccion.id };
}

interface Fixtures {
  /** Page ya con la cookie de sesión real puesta — navegar directo a cualquier ruta protegida. */
  paginaAutenticada: Page;
  sucursalId: string;
  /** Sección "Depósito E2E" en la sucursal Central — para specs que necesitan una sin crear la suya. */
  seccionId: string;
}

export const test = base.extend<Fixtures>({
  sucursalId: async ({}, use) => {
    const { sucursalId } = await crearSesionAdmin();
    await use(sucursalId);
  },
  seccionId: async ({}, use) => {
    const { seccionId } = await crearSesionAdmin(); // idempotente — reusa la misma sección
    await use(seccionId);
  },
  paginaAutenticada: async ({ browser, baseURL }, use) => {
    const { sessionToken } = await crearSesionAdmin();
    const context = await browser.newContext();
    const host = new URL(baseURL ?? "http://localhost:3000").hostname;
    await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
