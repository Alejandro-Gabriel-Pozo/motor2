import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { prismaAdmin } from "../setup/cliente-duenio";
import { activarEmpresaB, crearUsuarioEn, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";
import { crearUsuarioSinEmpresa, sembrarInvitacionDeUsuario } from "./fixtures/invitacion";

/**
 * E8 (ADR-024): la invitación por usuario en un navegador real. Un administrador agrega a alguien desde Administración → Usuarios (se crea una invitación, no un usuario), la
 * reenvía, la revoca, invita a vincular a un precargado; y la persona invitada abre el enlace y acepta. El ingreso con Google no se puede recorrer en un E2E: se prueba con una sesión
 * sembrada del email invitado; la decisión del login y la vinculación de la cuenta las cubre test/auth/vinculacion.test.ts, y la prueba de humo manual con una cuenta real (runbook).
 * El mail sale por la consola del servidor de E2E (sin Resend): lo que se comprueba acá es el estado en la base y lo que muestra la pantalla.
 */
test.describe.configure({ mode: "serial" });

let e: EmpresasDeLaPrueba;
let admin: { usuarioId: string; sessionToken: string; email: string };
let rolOperador: string;

async function sinViolaciones(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test.beforeAll(async () => {
  e = await activarEmpresaB();
  const email = `admin-usuarios-${e.marca}@local.test`;
  admin = { ...(await crearUsuarioEn(email, [{ sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId }])), email };
  rolOperador = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: e.b.empresaId, clave: "operador" } })).id;
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
});

const invitacionesDe = (email: string) => prismaAdmin.invitacion.findMany({ where: { email }, orderBy: { creadaEn: "asc" }, include: { sucursales: true } });

async function paginaDeUsuarios(browser: Parameters<typeof paginaConSesion>[0], baseURL: string | undefined) {
  const page = await paginaConSesion(browser, baseURL, admin.sessionToken);
  await page.goto("/administracion/usuarios");
  await expect(page.getByRole("heading", { name: /^Usuarios/ })).toBeVisible();
  return page;
}

test("agregar un email nuevo crea una invitación (no un usuario) y aparece en «Invitaciones pendientes»", async ({ browser, baseURL }) => {
  const email = `nueva-${e.marca}@local.test`;
  const page = await paginaDeUsuarios(browser, baseURL);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Rol").selectOption({ label: "operador" });
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Invitación enviada" })).toBeVisible();
  const pendientes = page.getByRole("table", { name: "Invitaciones pendientes de esta sucursal" });
  await expect(pendientes.getByRole("cell", { name: email, exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Usuarios de la sucursal" }).getByRole("cell", { name: email, exact: true })).toHaveCount(0);
  await sinViolaciones(page);

  const [inv] = await invitacionesDe(email);
  expect(inv).toMatchObject({ rolEmpresa: "usuario", estado: "PENDIENTE", invitadoPorId: admin.usuarioId });
  expect(inv.sucursales).toHaveLength(1);
  expect(inv.enviadaEn).not.toBeNull();
  expect(await prismaAdmin.user.findUnique({ where: { email } })).toBeNull();
  await page.context().close();
});

test("reenviar: el freno de un minuto se explica; con el envío viejo rota el token; revocar la saca de la lista", async ({ browser, baseURL }) => {
  const email = `reenvio-${e.marca}@local.test`;
  const sembrada = await sembrarInvitacionDeUsuario({ empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, rolId: rolOperador, invitadoPorId: admin.usuarioId, email });
  await prismaAdmin.invitacion.update({ where: { id: sembrada.id }, data: { enviadaEn: new Date() } });
  const hashInicial = (await invitacionesDe(email))[0].hashToken;

  const page = await paginaDeUsuarios(browser, baseURL);
  await page.getByRole("button", { name: `Reenviar la invitación a ${email}` }).click();
  await page.getByRole("button", { name: "Sí, reenviar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "menos de un minuto" })).toBeVisible();
  expect((await invitacionesDe(email))[0].hashToken).toBe(hashInicial);

  await prismaAdmin.invitacion.update({ where: { id: sembrada.id }, data: { enviadaEn: new Date(Date.now() - 120_000) } });
  await page.reload();
  await page.getByRole("button", { name: `Reenviar la invitación a ${email}` }).click();
  await page.getByRole("button", { name: "Sí, reenviar" }).click();
  await expect.poll(async () => (await invitacionesDe(email))[0].hashToken).not.toBe(hashInicial);

  await page.reload();
  await page.getByRole("button", { name: `Revocar la invitación a ${email}` }).click();
  await page.getByRole("button", { name: "Sí, revocar" }).click();
  await expect.poll(async () => (await invitacionesDe(email))[0].estado).toBe("REVOCADA");
  await page.reload();
  await expect(page.getByRole("cell", { name: email, exact: true })).toHaveCount(0);
  await page.context().close();
});

test("un precargado sin Google muestra «Invitar a vincular»; uno con cuenta vinculada figura «Vinculada» y sin botón", async ({ browser, baseURL }) => {
  const sinGoogle = `precargado-${e.marca}@local.test`;
  const conGoogle = `vinculado-${e.marca}@local.test`;
  await crearUsuarioEn(sinGoogle, [{ sucursalId: e.b.sucursalId, rolId: rolOperador }]);
  const vinculado = await crearUsuarioEn(conGoogle, [{ sucursalId: e.b.sucursalId, rolId: rolOperador }]);
  await prismaAdmin.account.create({ data: { userId: vinculado.usuarioId, type: "oidc", provider: "google", providerAccountId: `g-${e.marca}`, id_token: "x" } });

  const page = await paginaDeUsuarios(browser, baseURL);
  const tabla = page.getByRole("table", { name: "Usuarios de la sucursal" });
  const filaSin = tabla.getByRole("row").filter({ hasText: sinGoogle });
  const filaCon = tabla.getByRole("row").filter({ hasText: conGoogle });
  await expect(filaSin).toContainText("Sin vincular");
  await expect(filaCon).toContainText("Vinculada");
  await expect(filaCon.getByRole("button", { name: /vincular|Reenviar/ })).toHaveCount(0);
  await sinViolaciones(page);

  await filaSin.getByRole("button", { name: `Invitar a vincular ${sinGoogle}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitación para vincular" })).toBeVisible();
  await expect.poll(async () => (await invitacionesDe(sinGoogle))[0]?.rolEmpresa).toBe("vinculacion");
  await page.context().close();
});

test("el enlace de una invitación de usuario: sin sesión pide entrar, guarda el token en una cookie httpOnly y lo saca de la URL", async ({ page }) => {
  const inv = await sembrarInvitacionDeUsuario({ empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, rolId: rolOperador, invitadoPorId: admin.usuarioId });
  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByText(`Te dieron acceso a «${e.b.nombre}»`)).toBeVisible();
  await expect(page.getByText(inv.email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  expect(page.url()).not.toContain(inv.token);
  await sinViolaciones(page);
  const cookie = (await page.context().cookies()).find((c) => c.name === "motor2.invitacion");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});

test("con la sesión de la persona invitada: ve a qué sucursales entra, acepta una sola vez y queda con su membresía", async ({ browser, baseURL }) => {
  const inv = await sembrarInvitacionDeUsuario({ empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, rolId: rolOperador, invitadoPorId: admin.usuarioId });
  const invitado = await crearUsuarioSinEmpresa(inv.email);
  const page = await paginaConSesion(browser, baseURL, invitado.sessionToken);

  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByText(e.b.sucursalNombre)).toBeVisible();
  await expect(page.getByText("operador")).toBeVisible();
  await sinViolaciones(page);
  await page.getByRole("button", { name: "Aceptar la invitación" }).click();

  await expect.poll(async () => prismaAdmin.usuarioSucursal.count({ where: { usuarioId: invitado.usuarioId, sucursalId: e.b.sucursalId, activo: true } })).toBe(1);
  expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).estado).toBe("ACEPTADA");
  expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuarioId: invitado.usuarioId, empresaId: e.b.empresaId, activo: true } })).toBe(1);

  // El enlace ya no sirve.
  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByText(/Este enlace ya no sirve/)).toBeVisible();
  await page.context().close();
});

test("si quien invitó perdió el acceso antes de que acepten, se explica y no se crea nada", async ({ browser, baseURL }) => {
  const otroAdmin = await crearUsuarioEn(`otro-admin-${e.marca}@local.test`, [{ sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId }]);
  const inv = await sembrarInvitacionDeUsuario({ empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, rolId: rolOperador, invitadoPorId: otroAdmin.usuarioId });
  await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: otroAdmin.usuarioId }, data: { activo: false } });
  const invitado = await crearUsuarioSinEmpresa(inv.email);
  const page = await paginaConSesion(browser, baseURL, invitado.sessionToken);

  await page.goto(`/invitacion#t=${inv.token}`);
  await page.getByRole("button", { name: "Aceptar la invitación" }).click();
  await expect(page.getByText(/Pedile a quien te invitó que te reenvíe la invitación/)).toBeVisible();
  expect(await prismaAdmin.usuarioSucursal.count({ where: { usuarioId: invitado.usuarioId } })).toBe(0);
  expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).estado).toBe("PENDIENTE");
  await page.context().close();
});

test("un enlace vencido, revocado o inventado dice que ya no sirve", async ({ page }) => {
  const vencida = await sembrarInvitacionDeUsuario({ empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, rolId: rolOperador, invitadoPorId: admin.usuarioId, venceEn: new Date(Date.now() - 1000) });
  await page.goto(`/invitacion#t=${vencida.token}`);
  await expect(page.getByText(/Este enlace ya no sirve/)).toBeVisible();
  await page.goto(`/invitacion#t=${"x".repeat(43)}`);
  await expect(page.getByText(/Este enlace ya no sirve/)).toBeVisible();
});

test("/login muestra los avisos de vinculación con texto fijo y no refleja códigos desconocidos", async ({ page }) => {
  await page.goto("/login?aviso=falta-invitacion");
  await expect(page.getByRole("alert").filter({ hasText: "todavía no está vinculada" })).toBeVisible();
  await sinViolaciones(page);
  await page.goto("/login?aviso=cuenta-distinta");
  await expect(page.getByRole("alert").filter({ hasText: "Por seguridad no se puede vincular otra" })).toBeVisible();
  await page.goto("/login?aviso=%3Cb%3Efalso%3C/b%3E");
  await expect(page.getByText("falso")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
});
