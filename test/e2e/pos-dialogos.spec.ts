import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { cierraConEscapeYConElFondo, noSeCierraEnCurso, retenerAcciones } from "./fixtures/dialogos";

/**
 * Los diálogos del salón sobre el `Dialogo` del sistema (`src/ui/componentes/superposiciones/dialogo.tsx`, `<dialog>` nativo con `showModal()`): lo que cada uno promete y que el paso de «overlay a mano» a
 * modal nativo NO puede cambiar. Para cada diálogo:
 *  - se abre con rol de diálogo y su nombre; el foco queda ADENTRO (en el control marcado `data-foco-inicial` si lo tiene, si no en la ✕ de cerrar, que es lo seguro: nunca en «Confirmar»);
 *  - Escape lo cierra y el foco vuelve al botón que lo abrió; el clic en el fondo también lo cierra;
 *  - MIENTRAS LA ACCIÓN ESTÁ EN CURSO (la Server Action retenida a propósito): Escape, el fondo y la ✕ no lo cierran, un doble clic en «Confirmar» manda UNA sola acción, y al terminar se cierra y deja
 *    el efecto una sola vez.
 * Las Server Actions son POST con la cabecera `next-action`: `retenerAcciones` las frena hasta `liberar()`, que es lo que deja «en curso» el diálogo el tiempo que haga falta para medirlo.
 */

async function limpiarMesas(mesaIds: string[]) {
  const cuentaIds = (await prisma.cuenta.findMany({ where: { mesaId: { in: mesaIds } }, select: { id: true } })).map((c) => c.id);
  await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: cuentaIds } } });
  await prisma.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prisma.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
  await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
}

test("«Nueva mesa»: el foco va al número, Escape y el fondo cierran, y mientras se crea no se cierra ni se envía dos veces", async ({ paginaAutenticada: page, sucursalId }) => {
  const numero = 7000 + Math.floor(Math.random() * 900);
  try {
    await page.goto("/mesas");
    const disparador = page.getByRole("button", { name: "Nueva mesa" });
    const dialogo = page.getByRole("dialog", { name: "Nueva mesa" });
    const abrir = () => disparador.click();
    await cierraConEscapeYConElFondo(page, abrir, dialogo, disparador);

    await abrir();
    await expect(dialogo.getByLabel("Número de mesa"), "el foco inicial es el número de mesa").toBeFocused();
    await dialogo.getByLabel("Número de mesa").fill(String(numero));
    const { vistas, liberar } = await retenerAcciones(page);
    await dialogo.getByRole("button", { name: "Crear mesa" }).dblclick();
    await expect.poll(() => vistas.length).toBe(1);
    await expect(dialogo.getByRole("button", { name: "Creando…" })).toBeDisabled();
    await noSeCierraEnCurso(page, dialogo);

    liberar();
    await expect(dialogo).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: `Mesa ${numero} creada.` })).toBeVisible();
    expect(vistas, "un doble clic manda UNA sola acción").toHaveLength(1);
    expect(await prisma.mesa.count({ where: { sucursalId, numero } })).toBe(1);
  } finally {
    const mesas = await prisma.mesa.findMany({ where: { sucursalId, numero }, select: { id: true } });
    await limpiarMesas(mesas.map((m) => m.id));
  }
});

test("«Abrir cuenta»: Escape y el fondo cierran, un doble clic en «Confirmar apertura» abre UNA cuenta y mientras se abre no se cierra", async ({ paginaAutenticada: page, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 7000 + Math.floor(Math.random() * 900) } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const disparador = page.getByRole("button", { name: "Abrir cuenta" });
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await cierraConEscapeYConElFondo(page, () => disparador.click(), dialogo, disparador);

    await disparador.click();
    // Sin elegir nada, confirmar dice por qué no y NO manda nada (no hay acción en curso).
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Elegí cuántos comensales son.");
    await dialogo.getByRole("button", { name: "4", exact: true }).click();
    await expect(dialogo.getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
    const { vistas, liberar } = await retenerAcciones(page);
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).dblclick();
    await expect.poll(() => vistas.length).toBe(1);
    await expect(dialogo.getByRole("button", { name: "Abriendo…" })).toBeDisabled();
    await noSeCierraEnCurso(page, dialogo);

    liberar();
    await expect(dialogo).toBeHidden();
    await expect(page.getByRole("button", { name: "Cerrar cuenta" })).toBeVisible();
    expect(vistas, "un doble clic manda UNA sola acción").toHaveLength(1);
    const cuentas = await prisma.cuenta.findMany({ where: { mesaId: mesa.id }, select: { comensales: true, cerradaEn: true } });
    expect(cuentas).toEqual([{ comensales: 4, cerradaEn: null }]);
  } finally {
    await limpiarMesas([mesa.id]);
  }
});
