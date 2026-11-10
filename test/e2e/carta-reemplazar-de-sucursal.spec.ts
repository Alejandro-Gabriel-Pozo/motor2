import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";
import { crearMembresia } from "../setup/membresia";

/**
 * «Reemplazar con la carta de otra sucursal» (2026-11-10), en un navegador real: con la carta propia YA armada se ofrece (sobre una carta vacía va «Copiar»); la confirmación dice qué se ELIMINA y qué se
 * COPIA, y el botón de confirmar queda deshabilitado hasta escribir el nombre de la sucursal; reemplazar deja la carta del origen intacta. Sin permiso de copiar, no se ofrece.
 */
async function armar(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const origen = await prisma.sucursal.create({ data: { nombre: `E2E Reemplazo Origen ${marca}` } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  await crearMembresia({ usuarioId: admin.id, sucursalId: origen.id, rolId: rolAdmin.id });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Reemplazo Sección ${marca}`, orden: 61 } });
  const pv = (q: string) => prisma.producto.create({ data: { codigo: `E2E_REEMP_${q}_${marca}`, nombre: `E2E Reemplazo ${q} ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
  const [delOrigen, delDestino] = await Promise.all([pv("Origen"), pv("Destino")]);
  await prisma.disponibilidadProducto.createMany({ data: [sucursalId, origen.id].flatMap((s) => [delOrigen, delDestino].map((p) => ({ sucursalId: s, productoId: p.id, disponible: true }))) });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: origen.id, productoId: delOrigen.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  // La carta propia del destino (la de la sucursal del e2e): un producto y un género.
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: delDestino.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 } });
  const genero = await prisma.generoCarta.create({ data: { sucursalId, nombre: `E2E Reemplazo Género ${marca}` } });
  return {
    origen,
    delOrigen,
    delDestino,
    limpiar: async () => {
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [delOrigen.id, delDestino.id] } } });
      await prisma.generoCarta.deleteMany({ where: { id: genero.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [delOrigen.id, delDestino.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [delOrigen.id, delDestino.id] } } });
      await prisma.usuarioSucursal.deleteMany({ where: { sucursalId: origen.id } });
      await prisma.sucursal.deleteMany({ where: { id: origen.id } });
    },
  };
}

test("reemplazar la carta: la confirmación muestra qué se elimina y qué se copia, exige escribir el nombre y deja el origen intacto", async ({ paginaAutenticada: page, sucursalId }) => {
  const e = await armar(sucursalId);
  const sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
  try {
    await page.goto("/carta");
    await expect(page.locator("[data-carta-vacia]")).toHaveCount(0); // con carta propia no se ofrece la copia sobre una carta vacía
    const seccion = page.locator("[data-reemplazar-carta-seccion]");
    await seccion.locator("summary").click();
    await expect(seccion.getByLabel("Reemplazar con la carta de")).toHaveValue(e.origen.id);
    await seccion.getByRole("button", { name: "Reemplazar la carta" }).click();

    const aviso = seccion.getByRole("alert");
    await expect(aviso).toContainText(`¿Reemplazar la carta de «${sucursal.nombre}» con la de «${e.origen.nombre}»?`);
    await expect(aviso.locator("[data-se-elimina]")).toContainText("1 producto(s) con contenido, 1 género(s) y 0 ítem(s) agrupado(s)");
    await expect(aviso.locator("[data-se-copia]")).toContainText("1 producto(s) con contenido, 0 género(s) y 0 ítem(s) agrupado(s)");
    expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);

    // Sin el nombre escrito (o con otro) no se puede confirmar; abrir la confirmación no cambia nada.
    const confirmar = seccion.getByRole("button", { name: "Sí, reemplazar la carta" });
    await expect(confirmar).toBeDisabled();
    await seccion.getByLabel(/Para confirmar, escribí el nombre de esta sucursal/).fill("otro nombre");
    await expect(confirmar).toBeDisabled();
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId, productoId: e.delDestino.id } })).toBe(1);

    await seccion.getByLabel(/Para confirmar, escribí el nombre de esta sucursal/).fill(sucursal.nombre);
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    await expect(seccion.getByRole("status")).toContainText("Se reemplazó la carta");
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId, productoId: e.delDestino.id } })).toBe(0);
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId, productoId: e.delOrigen.id } })).toBe(1);
    expect(await prisma.generoCarta.count({ where: { sucursalId } })).toBe(0);
    // La carta de la sucursal de origen queda igual.
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: e.origen.id } })).toBe(1);
  } finally {
    await e.limpiar();
  }
});

test("sin permiso de copiar la carta, «Reemplazar con la carta de otra sucursal» no se ofrece", async ({ paginaAutenticada: page, sucursalId }) => {
  const e = await armar(sucursalId);
  const celdas = await ajustarCeldasDelAdmin({ carta_copiar_de_sucursal: { puedeVer: true, puedeEditar: false } });
  try {
    await page.goto("/carta");
    await expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible();
    await expect(page.locator("[data-reemplazar-carta-seccion]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reemplazar la carta" })).toHaveCount(0);
  } finally {
    await celdas.restaurar();
    await e.limpiar();
  }
});
