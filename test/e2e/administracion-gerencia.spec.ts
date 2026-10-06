import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prismaAdmin } from "../setup/cliente-duenio";
import { crearMembresia } from "../setup/membresia";

/**
 * Gerencia de la empresa (Tanda 3): la pantalla de traspaso solo la abre el gerente, se confirma tipeando el email de la persona elegida y,
 * hecho el traspaso, quien lo pidió ya no es gerente. El usuario de las pruebas no es gerente por defecto: el spec lo hace gerente y,
 * pase lo que pase, deja a la empresa sin gerente al terminar (los demás specs no lo esperan).
 */
test.describe.configure({ mode: "serial" });

const EMAIL_ADMIN_E2E = "e2e-admin@local.test";

async function dejarSinGerente(empresaId: string) {
  await prismaAdmin.usuarioEmpresa.updateMany({ where: { empresaId, rolEmpresa: "gerente" }, data: { rolEmpresa: null } });
}

test("un administrador que no es gerente no ve el traspaso, solo el aviso de permiso", async ({ paginaAutenticada: page, sucursalId }) => {
  const { empresaId } = await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
  await dejarSinGerente(empresaId);
  await page.goto("/administracion/gerencia");
  await expect(page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Traspasar la gerencia" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gerencia de la empresa" })).toHaveCount(0);
});

test("el gerente traspasa la gerencia: el email equivocado no la mueve, el correcto sí y deja el enlace al inicio", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const { empresaId } = await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
  const rolAdmin = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId, clave: "admin" } });
  const admin = await prismaAdmin.user.findUniqueOrThrow({ where: { email: EMAIL_ADMIN_E2E } });
  const emailCandidato = `e2e-gerencia-${marca}@local.test`;
  const candidato = await prismaAdmin.user.create({ data: { email: emailCandidato, activoGlobal: true } });
  await crearMembresia({ usuarioId: candidato.id, sucursalId, rolId: rolAdmin.id, activo: true });
  await dejarSinGerente(empresaId);
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId } }, data: { rolEmpresa: "gerente" } });

  try {
    await page.goto("/administracion/gerencia");
    await expect(page.getByRole("heading", { name: "Gerencia de la empresa" })).toBeVisible();
    for (const ancho of [1024, 1280]) {
      await page.setViewportSize({ width: ancho, height: 720 });
      await page.evaluate(() => document.fonts.ready);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `la página tiene scroll horizontal a ${ancho} px`).toBeLessThanOrEqual(0);
    }
    await page.getByLabel("Nuevo gerente").selectOption({ label: emailCandidato });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByLabel(/escribí el email/).fill("otra-persona@local.test");
    await page.getByRole("button", { name: "Traspasar la gerencia" }).click();
    await expect(page.getByText(/El email no coincide/)).toBeVisible();
    expect((await prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId } } })).rolEmpresa).toBe("gerente");

    await page.getByLabel(/escribí el email/).fill(emailCandidato.toUpperCase());
    await page.getByRole("button", { name: "Traspasar la gerencia" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir al inicio" })).toBeVisible();

    const filas = await prismaAdmin.usuarioEmpresa.findMany({ where: { empresaId, rolEmpresa: "gerente" }, select: { usuarioId: true } });
    expect(filas.map((f) => f.usuarioId)).toEqual([candidato.id]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await dejarSinGerente(empresaId);
    await prismaAdmin.usuarioSucursal.deleteMany({ where: { usuarioId: candidato.id } });
    await prismaAdmin.usuarioEmpresa.deleteMany({ where: { usuarioId: candidato.id } });
    await prismaAdmin.user.delete({ where: { id: candidato.id } });
  }
});
