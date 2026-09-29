import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Permisos por reporte. Antes 18 de las 19 páginas de /reportes no tenían ningún permiso: cualquier usuario con sesión veía
 * costos, márgenes y valuación. Ahora cada reporte se protege con una acción de «Ver» (agrupadas por sensibilidad), el rol
 * «operador» arranca sin las nuevas, y el menú solo muestra lo que el rol puede ver.
 */

/** Una página con la sesión de un usuario nuevo con rol «operador» en la sucursal dada (la fixture solo trae al admin). */
async function paginaComoOperador(browser: import("@playwright/test").Browser, baseURL: string | undefined, sucursalId: string): Promise<Page> {
  // La base de pruebas puede traer restos de otros tests: se deja el rol activo y con el permiso que tiene de fábrica
  // (Conteos físicos va con proceso_control, que el operador ve) para que el test no dependa de lo que corrió antes.
  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: { estado: "ACTIVE" } });
  const operador = await prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "operador" } }, update: { activo: true }, create: { nombre: "operador" } });
  await prisma.permisoRol.upsert({
    where: { rolId_accionClave: { rolId: operador.id, accionClave: "proceso_control" } },
    update: { puedeVer: true, puedeEditar: true },
    create: { rolId: operador.id, accionClave: "proceso_control", puedeVer: true, puedeEditar: true },
  });
  for (const accionClave of ["ver_reportes_dinero", "ver_reportes_control", "ver_reportes_operativos", "ver_reportes_catalogo", "pagar_consignante"] as const) {
    await prisma.permisoRol.updateMany({ where: { rolId: operador.id, accionClave }, data: { puedeVer: false, puedeEditar: false } });
  }
  const usuario = await prisma.user.create({ data: { email: `e2e-operador-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

  const context = await browser.newContext();
  const host = new URL(baseURL ?? "http://localhost:3000").hostname;
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

test("el admin ve todos los reportes en el menú y puede abrirlos", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos");
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();

  for (const ruta of ["/reportes/costos", "/reportes/perdidas", "/reportes/vencimientos", "/reportes/insumos-sin-receta", "/reportes/consignacion"]) {
    await expect(page.locator(`a[href="${ruta}"]`)).toHaveCount(1);
  }
});

test("un operador no ve los reportes nuevos: ni en el menú ni abriendo la dirección a mano", async ({ browser, baseURL, sucursalId }) => {
  const page = await paginaComoOperador(browser, baseURL, sucursalId);

  // Entra a un reporte que sí puede ver (Conteos físicos va con proceso_control): el menú despliega el grupo Reportes solo
  // cuando se está dentro de uno de ellos.
  await page.goto("/reportes/conteos");
  await expect(page.locator('a[href="/reportes/conteos"]')).toHaveCount(1);

  // El menú no ofrece los reportes de dinero, control, operativos, catálogo ni consignación...
  for (const ruta of ["/reportes", "/reportes/costos", "/reportes/perdidas", "/reportes/vencimientos", "/reportes/insumos-sin-receta", "/reportes/consignacion"]) {
    await expect(page.locator(`a[href="${ruta}"]`)).toHaveCount(0);
  }

  // Y abrir la dirección a mano da el mensaje de permiso, no el reporte.
  for (const ruta of ["/reportes", "/reportes/costos", "/reportes/valuacion", "/reportes/consignacion"]) {
    await page.goto(ruta);
    await expect(page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
  }
  await page.context().close();
});

test("al entrar, un admin va a /reportes y un operador a una pantalla que sí puede abrir (no a un mensaje de «no tenés permiso»)", async ({ paginaAutenticada: pagina, browser, baseURL, sucursalId }) => {
  await pagina.goto("/");
  await pagina.waitForURL(/\/reportes$/);

  const operador = await paginaComoOperador(browser, baseURL, sucursalId);
  await operador.goto("/");
  await operador.waitForLoadState("networkidle");
  expect(new URL(operador.url()).pathname).not.toBe("/reportes");
  await expect(operador.getByText(/No tenés permiso para ver esta sección/)).toHaveCount(0);
  await operador.context().close();
});

test("un operador no ve en el menú las pantallas de administración que no puede abrir", async ({ browser, baseURL, sucursalId }) => {
  const operador = await paginaComoOperador(browser, baseURL, sucursalId);
  await operador.goto("/catalogo/productos");
  await expect(operador.locator('a[href="/catalogo/productos"]')).toHaveCount(1);
  // Administración no se despliega en esta página; se comprueba que el enlace a Usuarios no aparece en ningún lado del menú.
  await expect(operador.locator('a[href="/administracion/usuarios"]')).toHaveCount(0);
  await operador.goto("/administracion/usuarios");
  await expect(operador.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
  await expect(operador.locator('a[href="/administracion/usuarios"]')).toHaveCount(0);
  await operador.context().close();
});
