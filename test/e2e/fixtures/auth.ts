import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test as base, type Page } from "@playwright/test";
import { prisma } from "../../../src/lib/db";
import { ACCIONES } from "../../../src/core/permisos/acciones";
import { MOTIVOS_MERMA_SEMILLA, DESTINOS_CONSUMO_SEMILLA } from "../../../src/core/movimientos/motivos-semilla";
import { crearMembresia } from "../../setup/membresia";

const EMPRESA_E2E_ID = "empresa_principal";
const SLUG_EMPRESA_E2E = "e2e";
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
export async function asegurarBaseSeed() {
  // resetearBaseE2E trunca TODO (Empresa incluida) y `empresaId` tiene default `app_empresa_actual()` (la única empresa ACTIVE):
  // sin la empresa por defecto, ninguna fila de dominio se puede crear. Mismo id que la migración multiempresa_estructura; el slug es
  // `e2e` porque los specs de la carta pública navegan a /carta-publica/e2e/... (ADR-007, A3: la empresa sale de la base, no del env).
  const { id: empresaId } = await prisma.empresa.upsert({
    where: { id: EMPRESA_E2E_ID },
    update: { estado: "ACTIVE", slug: SLUG_EMPRESA_E2E },
    create: { id: EMPRESA_E2E_ID, nombre: "Empresa principal", slug: SLUG_EMPRESA_E2E, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
  });
  const [admin, operador] = await Promise.all([
    prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "admin" } }, update: {}, create: { nombre: "admin" } }),
    prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "operador" } }, update: {}, create: { nombre: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await prisma.accion.upsert({ where: { clave: accion.clave }, update: { descripcion: accion.descripcion }, create: { clave: accion.clave, descripcion: accion.descripcion } });
    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = accion.rolesEditarSemilla.includes(nombreRol);
      await prisma.permisoRol.upsert({
        where: { rolId_accionClave: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave } },
        // El admin de las pruebas tiene que poder abrir todo, pase lo que pase con una base que traiga restos de otros tests
        // (por ejemplo, uno de Vitest que deja un permiso de admin en falso). Los demás roles conservan lo que tengan.
        update: nombreRol === "admin" ? { puedeVer: true, puedeEditar: true } : {},
        create: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave, puedeEditar, puedeVer: puedeEditar },
      });
    }
  }

  const sucursal = await prisma.sucursal.upsert({ where: { empresaId_nombre: { empresaId, nombre: SUCURSAL_NOMBRE } }, update: {}, create: { nombre: SUCURSAL_NOMBRE } });

  for (const u of UNIDADES_BASE) await prisma.unidad.upsert({ where: { empresaId_nombre: { empresaId, nombre: u.nombre } }, update: {}, create: u });

  // El catálogo Motivo de Merma / Destino de Consumo (plan "motivos de Consumo/Merma como catálogo administrable",
  // 2026-09-23) SÍ lo siembra la migración expand (P3), pero resetearBaseE2E (base-e2e.ts) trunca TODAS las tablas
  // antes de cada corrida — sin esto, cualquier spec que registre una Merma/Consumo por UI no encuentra ninguna
  // opción en el <select>. Mismo dato que sembrarMotivosYDestinos() (test/setup/test-db.ts) para Vitest.
  for (const m of MOTIVOS_MERMA_SEMILLA) {
    await prisma.motivoMerma.upsert({ where: { empresaId_nombre: { empresaId, nombre: m.nombre } }, update: {}, create: { nombre: m.nombre, descripcion: m.descripcion ?? null } });
  }
  for (const d of DESTINOS_CONSUMO_SEMILLA) {
    await prisma.destinoConsumo.upsert({ where: { empresaId_nombre: { empresaId, nombre: d.nombre } }, update: {}, create: { nombre: d.nombre, descripcion: d.descripcion ?? null } });
  }

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
  await prisma.usuarioEmpresa.upsert({ where: { usuarioId_empresaId: { usuarioId: user.id, empresaId: sucursal.empresaId } }, update: { activo: true }, create: { usuarioId: user.id, empresaId: sucursal.empresaId } });
  if (!membresia) await crearMembresia({ usuarioId: user.id, sucursalId: sucursal.id, rolId: admin.id, activo: true });

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
