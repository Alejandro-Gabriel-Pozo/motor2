import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { prisma } from "../../../src/lib/db";
import { crearMembresias } from "../../setup/membresia";

/** Un usuario nuevo con membresía en «Central» (rol `rolCentral`) y en una sucursal nueva (rol `rolSegunda`), con su sesión. */
export async function usuarioConDosSucursales(browser: Browser, baseURL: string | undefined, sucursalId: string, rolCentral: string, rolSegunda: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const segunda = await prisma.sucursal.create({ data: { nombre: `E2E Cambio Sucursal ${marca}` } });
  const [central, enSegunda] = await Promise.all([prisma.rol.findFirstOrThrow({ where: { nombre: rolCentral } }), prisma.rol.findFirstOrThrow({ where: { nombre: rolSegunda } })]);
  const usuario = await prisma.user.create({ data: { email: `e2e-cambio-sucursal-${marca}@local.test`, activoGlobal: true } });
  await crearMembresias([
    { usuarioId: usuario.id, sucursalId, rolId: central.id, activo: true },
    { usuarioId: usuario.id, sucursalId: segunda.id, rolId: enSegunda.id, activo: true },
  ]);
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  return {
    page,
    segunda,
    limpiar: async () => {
      await contexto.close();
      await prisma.capacidadSucursal.deleteMany({ where: { sucursalId: segunda.id } });
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await prisma.sucursal.deleteMany({ where: { id: segunda.id } });
    },
  };
}
