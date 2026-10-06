import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { paginaConSesion } from "./fixtures/multiempresa";
import { crearUsuarioSinEmpresa, leerInvitacion, pertenenciasDe, sembrarInvitacion } from "./fixtures/invitacion";

/**
 * E5 (ADR-020): aceptar la invitación del primer gerente, en un navegador real. El ingreso con Google no se puede recorrer en un E2E: se prueba con una
 * sesión sembrada del email invitado; que Google devuelva a `/invitacion` con la cookie puesta lo cubre `inicioDeSesionPermitido` (test/auth/invitacion-gate.test.ts)
 * y la prueba de humo manual con una cuenta real (runbook).
 */
const MENSAJE_NO_SIRVE = /Este enlace ya no sirve/;

async function sinViolaciones(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("sin sesión: el enlace pide entrar con la cuenta invitada, guarda el token en una cookie httpOnly y lo saca de la URL", async ({ page }) => {
  const inv = await sembrarInvitacion();
  const avisosDeCsp: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) avisosDeCsp.push(m.text());
  });

  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByText(`Te invitaron a ser gerente de «${inv.nombre}»`)).toBeVisible();
  await expect(page.getByText(inv.email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  expect(page.url()).not.toContain(inv.token);
  await sinViolaciones(page);

  const cookie = (await page.context().cookies()).find((c) => c.name === "motor2.invitacion");
  expect(cookie, "cookie de invitación").toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
  expect(cookie!.value).toBe(inv.token);
  expect(avisosDeCsp).toEqual([]);
});

test("con la sesión de otra persona: explica la diferencia y ofrece cerrar sesión; no deja aceptar", async ({ browser, baseURL }) => {
  const inv = await sembrarInvitacion();
  const otra = await crearUsuarioSinEmpresa(`otra-${Date.now()}@local.test`);
  const page = await paginaConSesion(browser, baseURL, otra.sessionToken);
  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByText(/Iniciaste sesión como/)).toBeVisible();
  await expect(page.getByText(inv.email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByLabel("CUIT de la empresa")).toHaveCount(0);
  await sinViolaciones(page);
  expect((await leerInvitacion(inv.token)).estado).toBe("PENDIENTE");
});

test("con la sesión del invitado: valida el CUIT, acepta una sola vez y la empresa queda en alta", async ({ browser, baseURL }) => {
  const inv = await sembrarInvitacion();
  const invitado = await crearUsuarioSinEmpresa(inv.email);
  const page = await paginaConSesion(browser, baseURL, invitado.sessionToken);

  await page.goto(`/invitacion#t=${inv.token}`);
  await expect(page.getByLabel("CUIT de la empresa")).toBeVisible();
  await sinViolaciones(page);

  // CUIT con el dígito verificador mal: se explica en el mismo paso y la invitación sigue pendiente.
  await page.getByLabel("CUIT de la empresa").fill("30-71234567-4");
  await page.getByRole("button", { name: "Revisar el CUIT" }).click();
  await expect(page.locator("#error-cuit")).toContainText(/dígito verificador/);
  expect((await leerInvitacion(inv.token)).estado).toBe("PENDIENTE");

  // CUIT válido: se muestra formateado con el nombre de la empresa; sin tildar la verificación no se puede aceptar; "Corregir" vuelve al campo.
  await page.getByLabel("CUIT de la empresa").fill("30-71234567-1");
  await page.getByRole("button", { name: "Revisar el CUIT" }).click();
  await expect(page.getByRole("heading", { name: "¿Es este el CUIT de la empresa?" })).toBeFocused();
  await expect(page.getByText("30-71234567-1", { exact: true })).toBeVisible();
  await expect(page.locator("strong", { hasText: inv.nombre })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar y aceptar" })).toBeDisabled();
  await sinViolaciones(page);
  await page.getByRole("button", { name: "Corregir el CUIT" }).click();
  await expect(page.getByLabel("CUIT de la empresa")).toHaveValue("30-71234567-1");
  await page.getByRole("button", { name: "Revisar el CUIT" }).click();

  // Tildada la verificación, acepta y manda a /login, que explica que la empresa está en alta.
  await page.getByLabel("Verifiqué que el CUIT y los datos de la empresa son correctos.").check();
  await page.getByRole("button", { name: "Confirmar y aceptar" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(`La empresa «${inv.nombre}» está en alta.`)).toBeVisible();
  await sinViolaciones(page);

  expect(await leerInvitacion(inv.token)).toMatchObject({ estado: "ACEPTADA", cuitDeclarado: "30712345671" });
  expect(await pertenenciasDe(inv.email)).toEqual([{ empresaId: inv.empresaId, rolEmpresa: "gerente" }]);

  // Un enlace usado ya no sirve, ni siquiera para quien lo usó sin la sesión.
  const otraVez = await (await browser.newContext()).newPage();
  await otraVez.goto(`/invitacion#t=${inv.token}`);
  await expect(otraVez.getByText(MENSAJE_NO_SIRVE)).toBeVisible();
});

test("un enlace vencido, uno inventado y uno sin token dicen lo mismo: ya no sirve", async ({ browser }) => {
  const vencida = await sembrarInvitacion({ venceEn: new Date(Date.now() - 1000) });
  const casos = [`/invitacion#t=${vencida.token}`, "/invitacion#t=" + "a".repeat(43), "/invitacion"];
  for (const ruta of casos) {
    const page = await (await browser.newContext()).newPage();
    await page.goto(ruta);
    await expect(page.getByText(MENSAJE_NO_SIRVE), ruta).toBeVisible();
    await sinViolaciones(page);
  }
});
