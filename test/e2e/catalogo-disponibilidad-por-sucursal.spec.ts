import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresias } from "../setup/membresia";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Circuito completo del alta con el tilde "Activo en todas las sucursales" (§4, P5) y su efecto real en el catálogo de
 * OTRA sucursal — filtro `soloDisponibles` del selector de /movimientos/venta (P6) — más "desactivar en una sucursal no
 * toca la otra" (P4/P10). docs/plan-disponibilidad-por-sucursal-2026-09-23.md.
 *
 * Un solo usuario admin, con membresía activa en AMBAS sucursales, visto desde 2 pestañas (contextos) con distinto
 * `sucursalActivaId` — mismo mecanismo que crea `cambiarSucursalActiva`, fijado directo por cookie (más simple que
 * navegar el selector real, y ya cubierto aparte por otros specs de sesión/permiso).
 */
async function abrirEnDosSucursales(browser: Browser, baseURL: string | undefined, sucursalAId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const sucursalB = await prisma.sucursal.create({ data: { nombre: `E2E Disp Norte ${marca}` } });
  const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { nombre: "admin" } });
  const usuario = await prisma.user.create({ data: { email: `e2e-disp-${marca}@local.test`, activoGlobal: true } });
  await crearMembresias([
      { usuarioId: usuario.id, sucursalId: sucursalAId, rolId: rolAdmin.id, activo: true },
      { usuarioId: usuario.id, sucursalId: sucursalB.id, rolId: rolAdmin.id, activo: true },
    ]);
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

  const host = new URL(baseURL ?? "http://localhost:3000").hostname;
  async function abrirComo(sucursalId: string) {
    const contexto = await browser.newContext();
    await contexto.addCookies([
      { name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" },
      { name: "sucursalActivaId", value: sucursalId, domain: host, path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    return contexto.newPage();
  }

  const pageA = await abrirComo(sucursalAId);
  const pageB = await abrirComo(sucursalB.id);

  return {
    sucursalBId: sucursalB.id,
    pageA,
    pageB,
    limpiar: async () => {
      await pageA.context().close();
      await pageB.context().close();
      const productos = await prisma.producto.findMany({ where: { nombre: { startsWith: "E2E Disp " } }, select: { id: true } });
      const productoIds = productos.map((p) => p.id);
      await prismaAdmin.registroAuditoria.deleteMany({ where: { actorId: usuario.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await prisma.sucursal.deleteMany({ where: { id: sucursalB.id } });
    },
  };
}

async function darDeAltaPV(page: import("@playwright/test").Page, nombre: string, tildar: boolean) {
  await page.goto("/catalogo/productos/nuevo");
  await page.getByRole("radio", { name: "Producto de venta (PV)" }).check();
  await page.getByRole("textbox", { name: "Nombre" }).fill(nombre);
  await page.getByRole("combobox", { name: "Unidad de stock" }).selectOption({ label: "kg" });
  if (!tildar) await page.getByRole("checkbox", { name: "Activo en todas las sucursales" }).uncheck();
  await page.getByRole("button", { name: "Crear producto" }).click();
  await page.waitForURL(/\/catalogo\/productos\/[^/]+\?guardado=alta/);
}

/**
 * `/movimientos/venta`: el selector de producto ya filtra `{ tipo: "PV", soloDisponibles: true }` — el candidato real
 * para ver el efecto EN LA SUCURSAL ACTIVA de quien mira. Ojo: `getByRole("option")` sin acotar también matchea las
 * `<option>` de los `<select>` nativos de la página (Sección, Sucursal activa) — por eso el conteo filtra por `name`
 * (el nombre del producto sembrado en este test, que no coincide con ninguna de esas opciones).
 */
async function apareceEnSelectorDeVenta(page: import("@playwright/test").Page, nombre: string): Promise<boolean> {
  await page.goto("/movimientos/venta");
  const combo = page.getByRole("combobox", { name: "Producto" });
  await combo.fill(nombre);
  await page.waitForTimeout(500); // debounce de 250ms de SelectorProducto + margen para la respuesta del servidor
  return (await page.getByRole("option", { name: nombre, exact: false }).count()) > 0;
}

test("alta SIN el tilde: disponible solo donde se dio de alta; CON el tilde: en las dos sucursales; desactivar en una no cambia la otra", async ({
  browser,
  baseURL,
  sucursalId,
}) => {
  const { pageA, pageB, limpiar } = await abrirEnDosSucursales(browser, baseURL, sucursalId);
  try {
    const marca = Date.now();

    const soloA = `E2E Disp Solo A ${marca}`;
    await darDeAltaPV(pageA, soloA, false);
    expect(await apareceEnSelectorDeVenta(pageA, soloA), "aparece en A, donde se dio de alta").toBe(true);
    expect(await apareceEnSelectorDeVenta(pageB, soloA), "invisible en B: nunca se tildó 'Activo en todas las sucursales'").toBe(false);

    const universal = `E2E Disp Universal ${marca}`;
    await darDeAltaPV(pageA, universal, true);
    expect(await apareceEnSelectorDeVenta(pageA, universal)).toBe(true);
    expect(await apareceEnSelectorDeVenta(pageB, universal), "con el tilde, aparece también en B").toBe(true);

    // Desactivar en A no toca B — el corazón del pendiente (docs/plan-disponibilidad-por-sucursal-2026-09-23.md).
    const productoUniversal = await prisma.producto.findFirstOrThrow({ where: { nombre: universal } });
    await pageA.goto(`/catalogo/productos/${productoUniversal.id}`);
    await pageA.getByRole("button", { name: "Desactivar", exact: true }).click();
    await pageA.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(pageA.getByText(/No disponible en/)).toBeVisible();

    expect(await apareceEnSelectorDeVenta(pageA, universal), "ahora invisible en A").toBe(false);
    expect(await apareceEnSelectorDeVenta(pageB, universal), "pero sigue disponible en B, sin tocarse").toBe(true);
  } finally {
    await limpiar();
  }
});
