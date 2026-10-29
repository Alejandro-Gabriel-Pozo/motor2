import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Ventas con opciones, paso 6 (diseño 2026-10-29): la sección «Ventas por opción» de Período, con datos. Se siembra directo (como `periodo-y-tickets-mismo-dia`) un día pasado con dos ventas de una gaseosa por
 * opción: «Coca» ×2 con su costo congelado (importe, costo y margen) y «Fanta» ×1 sin costo guardado (la fila dice «costo incompleto»); en otro día, el texto de «sin ventas». La pantalla ya
 * pasa axe vacía (`accesibilidad.spec.ts`); acá, con la tabla llena. El cálculo contra la base lo prueba `test/reportes/ventas-por-opcion.test.ts`.
 */
const EL_DIA = new Date("2025-11-12T18:00:00Z");

test("Período muestra «Ventas por opción» con unidades, importe, costo y margen; sin costo guardado dice «costo incompleto»; otro día, sin ventas; axe limpio", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const marca = await sembrarGrupo({ nombre: `E2E Marca VPO ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: `Coca ${m}` }, { nombre: `Fanta ${m}` }] });
  const nombre = `E2E Gaseosa VPO ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-VPO-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: marca }] });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 6000 + Math.floor(Math.random() * 3000) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id, cerradaEn: EL_DIA, cerradaPorId: admin.id } });
  const operaciones: string[] = [];
  const venta = async (opcion: string, unidades: number, importe: number, costoUnitario: number | null) => {
    const o = marca.opciones[opcion]!;
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: EL_DIA, usuarioId: admin.id, detalleLibre: "Mesa E2E VPO" } });
    operaciones.push(operacion.id);
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId, seccionId, proceso: "VENTA", cantidad: -unidades, detalle: "Venta", precioTotal: importe, precioPorUnidadStock: importe / unidades, costoUnitarioVenta: costoUnitario },
    });
    const item = await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId, cantidad: unidades, precioUnitario: importe / unidades, numeroEnvio: 1, operacionId: operacion.id, creadoPorId: admin.id, huellaOpciones: "0123456789abcdef".repeat(4) },
    });
    await prisma.opcionElegidaEnLinea.create({
      data: { cuentaItemId: item.id, grupoId: marca.grupoId, opcionId: o.opcionId, versionDeOpcionId: o.versionId, tipoGrupo: "VARIANTE", nombreGrupo: `E2E Marca VPO ${m}`, nombreOpcion: opcion, importeUnitario: "0.00" },
    });
  };
  await venta(`Coca ${m}`, 2, 5000, 700);
  await venta(`Fanta ${m}`, 1, 2500, null);
  try {
    await page.goto("/reportes/periodo?desde=2025-11-12&hasta=2025-11-12");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Ventas por opción/ })).toBeVisible();
    const coca = page.getByRole("row", { name: new RegExp(`${nombre}.*Coca ${m}`) });
    await expect(coca).toBeVisible();
    // Producto, Grupo, Opción, Unidades, Importe, Costo al vender, Margen.
    await expect(coca.getByRole("cell").nth(3)).toHaveText("2");
    await expect(coca.getByRole("cell").nth(4)).toHaveText("$5.000");
    await expect(coca.getByRole("cell").nth(5)).toHaveText("$1.400");
    await expect(coca.getByRole("cell").nth(6)).toHaveText("$3.600 (72%)");
    const fanta = page.getByRole("row", { name: new RegExp(`${nombre}.*Fanta ${m}`) });
    await expect(fanta.getByRole("cell").nth(3)).toHaveText("1");
    await expect(fanta.getByRole("cell").nth(4)).toHaveText("$2.500");
    await expect(fanta.getByRole("cell").nth(5)).toContainText("costo incompleto (1 de 1 ventas sin costo guardado)");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con «Ventas por opción» llena").toEqual([]);

    await page.goto("/reportes/periodo?desde=2025-11-13&hasta=2025-11-13");
    await expect(page.getByRole("heading", { name: /Ventas por opción/ })).toBeVisible();
    await expect(page.getByText("No hubo ventas con opciones en el período.")).toBeVisible();
  } finally {
    await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: cuenta.id } } });
    await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prisma.movimientoStock.deleteMany({ where: { operacionId: { in: operaciones } } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});
