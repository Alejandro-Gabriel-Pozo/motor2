import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { prismaSinEmpresa } from "./db";
import { crearEmpresa } from "../../setup/crear-empresa";
import { prismaAdmin } from "../../setup/cliente-duenio";
import { crearMembresia } from "../../setup/membresia";
import { activarTodosLosModulos } from "../../setup/modulos";
import { asegurarBaseSeed } from "./auth";
import { conOrigenPropio } from "./origen";

/**
 * Fixtures de los specs `multiempresa-*` (ADR-007, A7): una SEGUNDA empresa activa creada con el `crearEmpresa` real, mientras dura el spec.
 *
 * Con dos empresas ACTIVE no hay empresa por defecto (`app_empresa_actual()` es NULL sin contexto): la fixture `paginaAutenticada` de
 * auth.ts (que siembra sin contexto) no sirve acá, así que las filas se siembran como dueño (`prismaAdmin`) con `empresaId` explícito.
 * `suspenderEmpresaB` en `afterAll` es obligatorio: devuelve la base a UNA sola empresa activa para el resto de la suite.
 */
export interface EmpresasDeLaPrueba {
  marca: string;
  a: { empresaId: string; slug: string; nombre: string; sucursalId: string; rolAdminId: string };
  b: { empresaId: string; slug: string; nombre: string; sucursalId: string; sucursalNombre: string; rolAdminId: string; adminUsuarioId: string };
}

/**
 * `previa`: una llamada anterior de este mismo spec. Con una empresa B ya activa, `asegurarBaseSeed` (que siembra sin contexto) ya no
 * puede correr —no hay empresa por defecto—, así que las empresas extra reusan la A de la primera llamada.
 */
export async function activarEmpresaB(previa?: EmpresasDeLaPrueba): Promise<EmpresasDeLaPrueba> {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // Con una sola empresa activa, antes de crear la segunda.
  const { sucursal, admin } = previa
    ? { sucursal: { id: previa.a.sucursalId, empresaId: previa.a.empresaId }, admin: { id: previa.a.rolAdminId } }
    : await asegurarBaseSeed();
  const slug = `norte-${marca}`;
  const nombre = `E2E Norte ${marca}`;
  const sucursalNombre = `Sucursal Norte ${marca}`;
  const creada = await crearEmpresa(prismaSinEmpresa, {
    nombre,
    slug,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailPrimerAdmin: `gerente-${marca}@local.test`,
    nombreSucursal: sucursalNombre,
  }, []);
  // El alta no siembra el registro de módulos (la activa la plataforma): la empresa B arranca con todos, como la A.
  await activarTodosLosModulos(creada.empresaId);
  const rolB = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: creada.empresaId, clave: "admin" } });
  const empresaA = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: sucursal.empresaId } });
  return {
    marca,
    a: { empresaId: empresaA.id, slug: empresaA.slug, nombre: empresaA.nombre, sucursalId: sucursal.id, rolAdminId: admin.id },
    b: { empresaId: creada.empresaId, slug, nombre, sucursalId: creada.sucursalId, sucursalNombre, rolAdminId: rolB.id, adminUsuarioId: creada.usuarioId },
  };
}

export async function suspenderEmpresaB(empresaId: string) {
  await prismaAdmin.empresa.update({ where: { id: empresaId }, data: { estado: "SUSPENDED" } });
}

/** Un proveedor en la empresa dada (como dueño, `empresaId` explícito): el dato que distingue una empresa de la otra en las pantallas. */
export async function sembrarProveedor(empresaId: string, nombre: string) {
  return prismaAdmin.proveedor.create({ data: { empresaId, codigo: `E2E_${randomUUID().slice(0, 8)}`, nombre } });
}

/** Un usuario nuevo que trabaja en las empresas indicadas (pertenencia + membresía de sucursal con rol admin), con una sesión real. */
export async function crearUsuarioEn(email: string, lugares: Array<{ sucursalId: string; rolId: string }>) {
  const user = await prismaAdmin.user.create({ data: { email, activoGlobal: true } });
  for (const l of lugares) await crearMembresia({ usuarioId: user.id, sucursalId: l.sucursalId, rolId: l.rolId, activo: true });
  return { usuarioId: user.id, sessionToken: await crearSesion(user.id) };
}

export async function crearSesion(usuarioId: string) {
  const sessionToken = randomUUID();
  await prismaAdmin.session.create({ data: { sessionToken, userId: usuarioId, expires: new Date(Date.now() + 1000 * 60 * 60 * 24) } });
  return sessionToken;
}

export async function paginaConSesion(browser: Browser, baseURL: string | undefined, sessionToken: string): Promise<Page> {
  const context = await browser.newContext();
  await conOrigenPropio(context);
  const host = new URL(baseURL ?? "http://localhost:3000").hostname;
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}
