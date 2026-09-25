import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { prisma } from "../../../src/lib/db";
import type { AccionClave } from "../../../src/core/permisos/acciones";

/** Nivel de un permiso del rol: "ver" = solo Ver; "editar" = Ver y Editar. Una clave ausente queda «sin asignar» (sin fila). */
export type NivelPermiso = "ver" | "editar";

/**
 * Una página con la sesión de un usuario NUEVO con un rol propio, armado con las claves dadas (así se arma el «mozo» desde la matriz
 * de permisos: `{ pos_mesas: "ver", pos_tomar_pedido: "editar" }`). Sesión real de Auth.js (fila `Session` + cookie), igual que
 * fixtures/auth.ts. `limpiar()` borra lo creado; si el usuario abrió cuentas o cargó ítems, quien llama las borra ANTES (las cuentas
 * referencian al usuario).
 */
export async function abrirComoRol(browser: Browser, baseURL: string | undefined, sucursalId: string, permisos: Partial<Record<AccionClave, NivelPermiso>>) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const claves = Object.keys(permisos) as AccionClave[];
  const rol = await prisma.rol.create({ data: { nombre: `e2e-pos-${marca}` } });
  for (const clave of claves) {
    await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: clave, puedeVer: true, puedeEditar: permisos[clave] === "editar" } });
  }
  const usuario = await prisma.user.create({ data: { email: `e2e-pos-${marca}@local.test`, activoGlobal: true } });
  await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true } });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  return {
    page,
    usuario,
    limpiar: async () => {
      await contexto.close();
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await prisma.permisoRol.deleteMany({ where: { rolId: rol.id } });
      await prisma.rol.deleteMany({ where: { id: rol.id } });
    },
  };
}
