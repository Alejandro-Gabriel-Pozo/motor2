import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prismaAdmin } from "../setup/cliente-duenio";
import { cambiarPoliticaDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "../../src/core/permisos/politica-de-empresa";

/**
 * Política de plataforma por empresa (add-on C2, ADR-008/ADR-010): la plataforma apaga «permisos editables» y/o «dos paneles» de una empresa
 * (en producción, con `npm run politica-empresa`; acá con la misma función que usa el script) y las pantallas lo respetan. Con un solo worker
 * (playwright.config.ts) el cambio no pisa a otros specs, y cada test deja la empresa «completa» al terminar.
 */
const SLUG = "e2e";
/** Un administrador de plataforma de mentira: la operación audita en `AuditoriaPlataforma` (sin FK), que solo escriben el dueño y `motor2_plataforma`, y acá corre con el dueño. */
const AUTOR = { adminId: "e2e-admin", adminEmail: "e2e-admin@local.test", instalacionId: "principal", instalacionNombre: "principal" };

const selector = (page: Page) => page.getByRole("group", { name: "Panel del menú" });

async function fijarPolitica(cambio: { permisosEditables?: boolean; dosPaneles?: boolean }) {
  await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: SLUG, ...cambio }, AUTOR);
}

test.afterEach(async () => {
  await fijarPolitica({ permisosEditables: true, dosPaneles: true });
});

test("empresa completa (por defecto): el selector de paneles y la edición de permisos y roles están disponibles", async ({ paginaAutenticada: page }) => {
  await page.goto("/inicio");
  await expect(selector(page)).toBeVisible();

  await page.goto("/administracion/permisos");
  await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible();
  await expect(page.getByText(MENSAJE_PERMISOS_DE_PLATAFORMA)).toHaveCount(0);
});

test("dosPaneles apagado: el menú es uno solo (sin selector), con todo junto, y sigue marcando la pantalla abierta", async ({ paginaAutenticada: page }) => {
  await fijarPolitica({ dosPaneles: false });

  await page.goto("/inicio");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(selector(page)).toHaveCount(0);
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: "Administración" })).toBeVisible();

  await page.goto("/catalogo/categorias");
  await expect(selector(page)).toHaveCount(0);
  await expect(page.locator("nav a[aria-current=page]")).toHaveCount(1);
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
});

test("dosPaneles apagado no toca los permisos: la matriz sigue editable", async ({ paginaAutenticada: page }) => {
  await fijarPolitica({ dosPaneles: false });
  await page.goto("/administracion/permisos");
  await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible();
});

test("permisosEditables apagado: la matriz de permisos y la pantalla de roles avisan que los administra la plataforma, sin controles de edición", async ({
  paginaAutenticada: page,
}) => {
  await fijarPolitica({ permisosEditables: false });

  await page.goto("/administracion/permisos");
  await expect(page.getByText(MENSAJE_PERMISOS_DE_PLATAFORMA)).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar permisos" })).toHaveCount(0);
  await expect(page.locator("[data-celda]")).toHaveCount(0);

  await page.goto("/administracion/roles");
  await expect(page.getByText(MENSAJE_PERMISOS_DE_PLATAFORMA)).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear", exact: true })).toHaveCount(0);
});

test("permisosEditables apagado deja el menú en dos paneles (son perillas independientes)", async ({ paginaAutenticada: page }) => {
  await fijarPolitica({ permisosEditables: false });
  await page.goto("/inicio");
  await expect(selector(page)).toBeVisible();
});

test("el cambio de política queda en la auditoría de plataforma, a nombre del administrador y con la instalación", async () => {
  await fijarPolitica({ dosPaneles: false });
  const filas = await prismaAdmin.auditoriaPlataforma.findMany({ where: { accion: "politica-cambiada", adminId: AUTOR.adminId } });
  expect(filas.some((f) => JSON.stringify(f.detalle).includes('"perilla":"dosPaneles"') && JSON.stringify(f.detalle).includes('"despues":false') && f.adminEmail === AUTOR.adminEmail)).toBe(true);
});
