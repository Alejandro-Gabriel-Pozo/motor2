import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Confirmación de intención en la Bandeja de traspasos (docs/plan-mutaciones-controladas-2026-09-25.md, Pasos 6a/6b): «Cancelar solicitud»
 * y los dos «Rechazar» ya no actúan al primer clic — abren un aviso en el mismo lugar (BotonConConfirmacion) y recién «Sí, …» llama al
 * servidor. Cada prueba siembra con Prisma su propia sucursal «B», su producto (marca única) y el traspaso en el estado que necesita; el
 * usuario E2E es de «Central». Cada prueba limpia lo que creó.
 */
type Lado = "central-pide" | "le-piden-a-central" | "le-envian-a-central";

async function sembrarTraspaso(sucursalId: string, seccionId: string, lado: Lado) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Traspasos B ${marca}` } });
  const seccionOtra = await prisma.seccion.create({ data: { sucursalId: otra.id, nombre: `E2E Depósito B ${marca}` } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-TR-${marca}`, nombre: `E2E Harina Traspaso ${marca}`, tipo: "MP", unidadStockId: kg.id } });

  const datos =
    lado === "central-pide"
      ? // PULL propio: Central pidió a B, sigue esperando que B decida → «Esperando respuesta», con «Cancelar solicitud».
        { origenSucursalId: otra.id, destinoSucursalId: sucursalId, seccionDestinoId: seccionId, iniciadoPor: "DESTINO" as const, estado: "SOLICITADA" as const }
      : lado === "le-piden-a-central"
        ? // PULL de B: B le pidió a Central → «Para aprobar», con «Rechazar».
          { origenSucursalId: sucursalId, destinoSucursalId: otra.id, seccionDestinoId: seccionOtra.id, iniciadoPor: "DESTINO" as const, estado: "SOLICITADA" as const }
        : // PUSH de B: B ya lo mandó (stock en tránsito) → «Para aceptar», con «Rechazar».
          {
            origenSucursalId: otra.id,
            destinoSucursalId: sucursalId,
            seccionOrigenId: seccionOtra.id,
            iniciadoPor: "ORIGEN" as const,
            estado: "ENVIADA" as const,
            fechaDecisionOrigen: new Date(),
            decididoPorOrigenId: admin.id,
          };
  const traspaso = await prisma.traspasoSucursal.create({ data: { ...datos, productoId: producto.id, cantidad: 3, creadoPorId: admin.id } });

  const limpiar = async () => {
    await prisma.movimientoStock.deleteMany({ where: { traspasoSucursalId: traspaso.id } });
    await prisma.traspasoSucursal.deleteMany({ where: { id: traspaso.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.seccion.deleteMany({ where: { id: seccionOtra.id } });
    await prisma.sucursal.deleteMany({ where: { id: otra.id } });
  };
  return { traspaso, producto, otra, admin, limpiar };
}

const estadoEnBase = async (id: string) => (await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id } })).estado;

test("«Cancelar solicitud» pide confirmación: el primer clic no toca nada, Escape vuelve, y «Sí, cancelar la solicitud» la cancela", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const t = await sembrarTraspaso(sucursalId, seccionId, "central-pide");
  try {
    await page.goto("/traspasos");
    const fila = page.locator(`div[data-traspaso="${t.traspaso.id}"]`);
    await expect(fila).toContainText("esperando que");
    const disparador = fila.getByRole("button", { name: /^Cancelar solicitud/ });

    // Primer clic: solo abre el aviso (role="alert"), con el foco en «Volver» — lo seguro en algo que no se deshace. La base no cambia.
    await disparador.click();
    const aviso = fila.getByRole("alert").filter({ hasText: "¿Cancelar tu solicitud" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(t.producto.codigo);
    await expect(aviso).toContainText(`${t.otra.nombre} ya no la va a ver para aprobar`);
    await expect(fila.getByRole("button", { name: "Volver" })).toBeFocused();
    expect(await estadoEnBase(t.traspaso.id)).toBe("SOLICITADA");

    // Escape cancela y devuelve el foco al botón que la abrió; la base sigue igual.
    await page.keyboard.press("Escape");
    await expect(aviso).toHaveCount(0);
    await expect(disparador).toBeFocused();
    expect(await estadoEnBase(t.traspaso.id)).toBe("SOLICITADA");

    // Confirmar: sale de «Esperando», queda CANCELADA y el historial lo dice.
    await disparador.click();
    await fila.getByRole("button", { name: "Sí, cancelar la solicitud" }).click();
    await expect(fila).toHaveCount(0);
    const enBase = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: t.traspaso.id } });
    expect(enBase.estado).toBe("CANCELADA");
    expect(enBase.cerradoPorId).toBe(t.admin.id);
    await expect(page.locator(`tr[data-traspaso="${t.traspaso.id}"]`)).toContainText("Cancelada por quien la pidió");
  } finally {
    await t.limpiar();
  }
});
