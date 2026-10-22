import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { MENU_DEL_DIA_VISIBLE } from "../../src/core/carta/menu-del-dia";
import { diaDeCalendario, sumarDias, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { capturar, expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * GO-3b (ADR-032, F6 paso U2): la pantalla «Menú del día» de la sucursal. Fija: cargar el plato de hoy (doble clic: una sola fila), quitarlo, volver a cargarlo y copiarlo a mañana con «Copiar el
 * día anterior»; un producto sin receta se ve con su motivo y no se puede elegir; axe sin violaciones.
 */

// Interruptor del menú del día (`MENU_DEL_DIA_VISIBLE`, decisión del dueño 2026-10-20): mientras esté apagado, la pantalla «Menú del día» (/movimientos/menu-del-dia) responde «no existe». Encendido, este spec vuelve a correr entero.
test.skip(!MENU_DEL_DIA_VISIBLE, "el menú del día está apagado (MENU_DEL_DIA_VISIBLE = false en src/core/carta/menu-del-dia.ts): la pantalla «Menú del día» (/movimientos/menu-del-dia) responde «no existe»");
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccionE2E = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const milanesa = await prisma.producto.create({ data: { codigo: `E2E-MDP-MILA-${m}`, nombre: `E2E Milanesa MDP ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 9000 } });
  const sinReceta = await prisma.producto.create({ data: { codigo: `E2E-MDP-SR-${m}`, nombre: `E2E Sin receta MDP ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  for (const p of [milanesa, sinReceta]) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
  const reventa = await darRecetaDeReventa(prisma, milanesa, { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [seccionE2E.id], usuarioId: admin.id } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Menús MDP ${m}`, orden: 1 } });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId, activa: true } }, seccionCartaId: seccion.id, titulo: `E2E Menú MDP ${m}`, precio: 10000 } });
  const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1 } });
  return {
    marca: m,
    milanesa,
    sinReceta,
    cupo,
    limpiar: async () => {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "EntradaDelDiaDeCupo" } });
      await prismaAdmin.entradaDelDiaDeCupo.deleteMany({ where: { cupoId: cupo.id } });
      await prismaAdmin.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: [milanesa.id], mpIds: [reventa.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [milanesa.id, sinReceta.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [milanesa.id, sinReceta.id] } } });
    },
  };
}

test("cargar el plato de hoy (una sola vez con doble clic), quitarlo, volver a cargarlo y copiarlo a mañana; el sin receta no se puede elegir; axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  const hoy = diaDeCalendario(new Date(), ZONA_ARGENTINA);
  const activos = (dia: string) => prisma.entradaDelDiaDeCupo.count({ where: { cupoId: d.cupo.id, fecha: new Date(`${dia}T00:00:00.000Z`), activa: true } });
  try {
    await page.goto("/movimientos/menu-del-dia");
    await expect(page.getByRole("heading", { level: 1, name: /^Menú del día en / })).toBeVisible();
    const lugar = page.locator('[data-lugar-del-dia="Plato del día"]');
    await expect(lugar).toContainText("Sin plato cargado");
    await expect(lugar.locator("option", { hasText: d.sinReceta.nombre })).toBeDisabled();
    await lugar.locator("select").selectOption({ label: d.milanesa.nombre });
    await lugar.getByRole("button", { name: "Agregar" }).dblclick();
    await expect(lugar.locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toBeVisible();
    expect(await activos(hoy)).toBe(1);
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);

    await lugar.getByRole("button", { name: `Quitar ${d.milanesa.nombre} de Plato del día` }).click();
    await expect(lugar).toContainText("Sin plato cargado");
    expect(await activos(hoy)).toBe(0);
    await lugar.locator("select").selectOption({ label: d.milanesa.nombre });
    await lugar.getByRole("button", { name: "Agregar" }).click();
    await expect(lugar.locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toBeVisible();

    const manana = sumarDias(hoy, 1);
    await page.goto(`/movimientos/menu-del-dia?fecha=${manana}`);
    await page.getByRole("button", { name: "Copiar el día anterior" }).click();
    await expect(page.locator('[data-lugar-del-dia="Plato del día"]').locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toBeVisible();
    expect(await activos(manana)).toBe(1);
  } finally {
    await d.limpiar();
  }
});

// OPCIONES-LIMPIEZA (G3): el plato del día es un componente del menú: «Quitar» es un toque y el aviso de abajo trae «Deshacer», que lo vuelve a poner (la misma fila, con su auditoría).
for (const pantalla of [
  { nombre: "celular", ancho: 375, alto: 812 },
  { nombre: "escritorio", ancho: 1280, alto: 900 },
] as const) {
  test(`${pantalla.nombre}: quitar el plato del día y «Deshacer» lo vuelve a poner; sin desborde, objetivos de 44 px y axe`, async ({ paginaAutenticada: page, sucursalId }) => {
    const d = await sembrar(sucursalId);
    const hoy = diaDeCalendario(new Date(), ZONA_ARGENTINA);
    const activos = () => prisma.entradaDelDiaDeCupo.count({ where: { cupoId: d.cupo.id, fecha: new Date(`${hoy}T00:00:00.000Z`), activa: true } });
    try {
      await page.setViewportSize({ width: pantalla.ancho, height: pantalla.alto });
      await page.goto("/movimientos/menu-del-dia");
      const lugar = page.locator(`[data-lugar-del-dia="Plato del día"]`).filter({ hasText: `E2E Menú MDP ${d.marca}` });
      await lugar.locator("select").selectOption({ label: d.milanesa.nombre });
      await lugar.getByRole("button", { name: "Agregar" }).click();
      await expect(lugar.locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toBeVisible();

      await lugar.getByRole("button", { name: `Quitar ${d.milanesa.nombre} de Plato del día` }).click();
      const aviso = page.locator("[data-aviso-con-deshacer]");
      await expect(aviso).toContainText(`«${d.milanesa.nombre}» dejó de ser`);
      await expect(lugar.locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toHaveCount(0);
      expect(await activos()).toBe(0);
      await expect(aviso, "el aviso queda dentro de la pantalla").toBeInViewport({ ratio: 1 });
      await expectObjetivosTactiles(aviso.getByRole("button"), `${pantalla.nombre}: el aviso`);
      await expectSinDesborde(page, `${pantalla.nombre}: menú del día con el aviso`);
      expect((await new AxeBuilder({ page }).analyze()).violations, "con el aviso").toEqual([]);
      await capturar(page, `menu-del-dia-${pantalla.nombre}-quitado`);

      await aviso.getByRole("button", { name: "Deshacer" }).click();
      await expect(lugar.locator(`[data-plato-del-dia="${d.milanesa.nombre}"]`)).toBeVisible();
      expect(await activos()).toBe(1);
      // La misma fila, vuelta a activar: una sola fila del día, y el rastro de los tres cambios (agregar, quitar, volver a poner).
      expect(await prisma.entradaDelDiaDeCupo.count({ where: { cupoId: d.cupo.id } })).toBe(1);
      const fila = await prisma.entradaDelDiaDeCupo.findFirstOrThrow({ where: { cupoId: d.cupo.id }, select: { id: true } });
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "EntradaDelDiaDeCupo", entidadId: fila.id } })).toBe(3);
    } finally {
      await d.limpiar();
    }
  });
}
