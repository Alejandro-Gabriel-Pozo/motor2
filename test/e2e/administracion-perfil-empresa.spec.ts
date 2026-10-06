import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Perfil de la empresa: pantalla de solo consulta que abre solo el gerente (comparte la clave de la gerencia). El usuario de las pruebas no es gerente por defecto: el spec lo
 * hace gerente y, pase lo que pase, deja a la empresa sin gerente y con el CUIT que tenía al terminar (los demás specs no lo esperan).
 */
test.describe.configure({ mode: "serial" });

const EMAIL_ADMIN_E2E = "e2e-admin@local.test";
const CUIT_DE_PRUEBA = "20123456786";

async function dejarSinGerente(empresaId: string) {
  await prismaAdmin.usuarioEmpresa.updateMany({ where: { empresaId, rolEmpresa: "gerente" }, data: { rolEmpresa: null } });
}

test("un administrador que no es gerente no ve el perfil, solo el aviso de permiso", async ({ paginaAutenticada: page, sucursalId }) => {
  const { empresaId } = await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
  await dejarSinGerente(empresaId);
  await page.goto("/administracion/empresa");
  await expect(page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Perfil de la empresa" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Perfil de la empresa" })).toHaveCount(0);
});

test("el gerente ve nombre, CUIT con guiones, zona horaria y moneda, y no hay nada que editar", async ({ paginaAutenticada: page, sucursalId }) => {
  const { empresaId } = await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
  const admin = await prismaAdmin.user.findUniqueOrThrow({ where: { email: EMAIL_ADMIN_E2E } });
  const antes = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { nombre: true, cuit: true, zonaHoraria: true, moneda: true } });
  await dejarSinGerente(empresaId);
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId } }, data: { rolEmpresa: "gerente" } });
  await prismaAdmin.empresa.update({ where: { id: empresaId }, data: { cuit: CUIT_DE_PRUEBA } });

  try {
    await page.goto("/administracion/empresa");
    await expect(page.getByRole("heading", { name: "Perfil de la empresa" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Perfil de la empresa" })).toBeVisible();

    const datos = page.locator("dl");
    await expect(datos).toContainText(antes.nombre);
    await expect(datos).toContainText("20-12345678-6");
    await expect(datos).toContainText(antes.zonaHoraria);
    await expect(datos).toContainText(antes.moneda);
    // Es de solo consulta: ni formularios ni botones de guardar.
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /guardar|editar|cambiar/i })).toHaveCount(0);

    for (const ancho of [1024, 1280]) {
      await page.setViewportSize({ width: ancho, height: 720 });
      await page.evaluate(() => document.fonts.ready);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `la página tiene scroll horizontal a ${ancho} px`).toBeLessThanOrEqual(0);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Sin CUIT confirmado, la pantalla lo dice en vez de dejar el dato en blanco.
    await prismaAdmin.empresa.update({ where: { id: empresaId }, data: { cuit: null } });
    await page.reload();
    await expect(page.locator("dl")).toContainText("Todavía no cargado");
  } finally {
    await dejarSinGerente(empresaId);
    await prismaAdmin.empresa.update({ where: { id: empresaId }, data: { cuit: antes.cuit } });
  }
});
