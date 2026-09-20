import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Matriz de permisos con «Guardar»: se abre en solo lectura; el modo edición marca los cambios y no aplica nada hasta «Confirmar y guardar»,
 * que guarda todo junto; si otra persona cambió algo mientras tanto, no guarda nada. Se usa una acción del rol «operador» y se la deja como
 * estaba al terminar.
 */
const ACCION = "stock_minimo";

async function operador() {
  return prisma.rol.upsert({ where: { nombre: "operador" }, update: { activo: true }, create: { nombre: "operador" } });
}
async function fijar(rolId: string, puedeVer: boolean, puedeEditar: boolean) {
  await prisma.permisoRol.upsert({
    where: { rolId_accionClave: { rolId, accionClave: ACCION } },
    update: { puedeVer, puedeEditar },
    create: { rolId, accionClave: ACCION, puedeVer, puedeEditar },
  });
}
async function estado(rolId: string) {
  const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId, accionClave: ACCION } } });
  return f ? { ver: f.puedeVer, editar: f.puedeEditar } : { ver: false, editar: false };
}

test("se abre en solo lectura y el modo edición no aplica nada hasta guardar; descartar deja todo como estaba", async ({ paginaAutenticada: page }) => {
  const rol = await operador();
  await fijar(rol.id, false, false);
  try {
    await page.goto("/administracion/permisos");
    await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible();
    await expect(page.locator("[data-celda]")).toHaveCount(0); // solo lectura: ninguna celda se puede tocar

    await page.getByRole("button", { name: "Editar permisos" }).click();
    await expect(page.locator("[data-cambios-pendientes]")).toContainText("Sin cambios todavía");
    await page.locator(`[data-celda="${rol.id}:${ACCION}:ver"]`).click();
    await expect(page.locator("[data-cambios-pendientes]")).toContainText("1 cambio(s) sin guardar");
    expect(await estado(rol.id)).toEqual({ ver: false, editar: false }); // la base NO cambió

    await page.getByRole("button", { name: "Descartar cambios" }).click();
    await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible();
    expect(await estado(rol.id)).toEqual({ ver: false, editar: false });
  } finally {
    await fijar(rol.id, false, false);
  }
});

test("«Revisar y guardar» muestra el resumen y «Confirmar y guardar» aplica el cambio", async ({ paginaAutenticada: page }) => {
  const rol = await operador();
  await fijar(rol.id, false, false);
  try {
    await page.goto("/administracion/permisos");
    await page.getByRole("button", { name: "Editar permisos" }).click();
    await page.locator(`[data-celda="${rol.id}:${ACCION}:ver"]`).click();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();

    const resumen = page.getByRole("dialog", { name: "Resumen de cambios" });
    await expect(resumen).toContainText(`operador · ${ACCION}: Sin acceso → Solo ver`);
    expect(await estado(rol.id)).toEqual({ ver: false, editar: false }); // todavía no se guardó

    await resumen.getByRole("button", { name: "Confirmar y guardar" }).click();
    await expect(page.getByRole("status")).toContainText("1 permiso(s) guardado(s).");
    await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible(); // volvió a solo lectura
    expect(await estado(rol.id)).toEqual({ ver: true, editar: false });
  } finally {
    await fijar(rol.id, false, false);
  }
});

test("«Ver ⊇ Editar» en pantalla: prender Editar prende Ver, y sacar Ver saca Editar; la celda del admin en gestion_permisos está fija", async ({ paginaAutenticada: page }) => {
  const rol = await operador();
  await fijar(rol.id, false, false);
  await page.goto("/administracion/permisos");
  await page.getByRole("button", { name: "Editar permisos" }).click();

  const ver = page.locator(`[data-celda="${rol.id}:${ACCION}:ver"]`);
  const editar = page.locator(`[data-celda="${rol.id}:${ACCION}:editar"]`);
  await editar.click();
  await expect(ver).toHaveAttribute("aria-pressed", "true");
  await expect(editar).toHaveAttribute("aria-pressed", "true");
  await ver.click(); // sacar Ver saca Editar
  await expect(ver).toHaveAttribute("aria-pressed", "false");
  await expect(editar).toHaveAttribute("aria-pressed", "false");

  await expect(page.getByLabel("admin: gestion_permisos, editar: fijo")).toBeVisible();
  await page.getByRole("button", { name: "Salir del modo edición" }).click();
});

test("si otra persona cambió el permiso mientras se editaba, no se guarda nada y se ofrece recargar", async ({ paginaAutenticada: page }) => {
  const rol = await operador();
  await fijar(rol.id, false, false);
  try {
    await page.goto("/administracion/permisos");
    await page.getByRole("button", { name: "Editar permisos" }).click();
    await page.locator(`[data-celda="${rol.id}:${ACCION}:ver"]`).click();

    await fijar(rol.id, true, true); // mientras tanto, otra persona lo cambia

    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await page.getByRole("dialog", { name: "Resumen de cambios" }).getByRole("button", { name: "Confirmar y guardar" }).click();

    await expect(page.getByRole("status")).toContainText("Otra persona cambió estos permisos");
    await expect(page.getByRole("button", { name: "Recargar la matriz" })).toBeVisible();
    expect(await estado(rol.id)).toEqual({ ver: true, editar: true }); // queda lo de la otra persona

    await page.getByRole("button", { name: "Recargar la matriz" }).click();
    await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible();
  } finally {
    await fijar(rol.id, false, false);
  }
});
