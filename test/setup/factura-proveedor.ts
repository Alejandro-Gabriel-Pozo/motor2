import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "./empresa-de-prueba";
import { prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "./test-db";
import { urlDeSembradoDeVitest } from "./rol-de-pruebas";

/**
 * Fixtures de la factura de proveedor (Paquete 3, M3b): una empresa con dos sucursales (cada una con su sección), un proveedor, un producto y un usuario, más los datos mínimos válidos de una cabecera, un
 * renglón y una parte. Los tests de `factura-proveedor-*` los pisan con lo que quieren romper. La empresa testigo (la otra) arma lo suyo con `sembrarAjeno`.
 */
export interface EscenarioDeFactura {
  usuarioId: string;
  sucursalA: string;
  sucursalB: string;
  seccionA: string;
  seccionB: string;
  proveedorId: string;
  productoId: string;
}

export async function sembrarEscenarioDeFactura(): Promise<EscenarioDeFactura> {
  const base = await sembrarBase();
  const { kg, insumo } = await sembrarCatalogoBase();
  const sucursalA = base.sucursal.id;
  const sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  const seccionA = (await sembrarSeccion(sucursalA, "Depósito")).id;
  const seccionB = (await sembrarSeccion(sucursalB, "Depósito")).id;
  const usuarioId = (await prisma.user.create({ data: { email: "administrativo@test.com" } })).id;
  const proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Distribuidora Sur" } })).id;
  const productoId = (await prisma.producto.create({ data: { codigo: "MP_A", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  return { usuarioId, sucursalA, sucursalB, seccionA, seccionB, proveedorId, productoId };
}

/** Lo que la empresa TESTIGO (otra empresa) tiene: su sucursal, su proveedor, su producto y su cabecera de factura, para probar que nada cruza. */
export async function sembrarAjeno(usuarioId: string) {
  const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  const unidad = await testigo.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
  const insumo = await testigo.insumo.create({ data: { nombre: "Harina" } });
  const sucursal = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
  const proveedor = await testigo.proveedor.create({ data: { codigo: "PRV_T", nombre: "Proveedor testigo" } });
  const producto = await testigo.producto.create({ data: { codigo: "MP_T", nombre: "Harina T", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id } });
  const factura = await testigo.facturaProveedor.create({ data: datosDeFactura({ usuarioId }, { proveedorId: proveedor.id, nroFactura: "9999-00000009", nroFacturaNormalizado: "9999-00000009" }) });
  const renglon = await testigo.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: factura.id, productoId: producto.id }) });
  return { testigo, sucursal, proveedor, producto, factura, renglon };
}

/** Una cabecera CONFIRMADA válida (sin número: nunca choca con otra). `e` aporta el usuario y el proveedor. */
export function datosDeFactura(e: { usuarioId: string; proveedorId?: string }, extra: Record<string, unknown> = {}) {
  return {
    proveedorId: e.proveedorId as string,
    fecha: new Date("2026-10-13T15:00:00.000Z"),
    importeTotal: "100.00",
    estado: "CONFIRMADA",
    confirmadaEn: new Date("2026-10-13T15:00:00.000Z"),
    confirmadaPorId: e.usuarioId,
    creadoPorId: e.usuarioId,
    ...extra,
  };
}

/** Una cabecera PENDIENTE_DE_REPARTO válida (sin confirmación). */
export function datosDePendiente(e: { usuarioId: string; proveedorId?: string }, extra: Record<string, unknown> = {}) {
  return datosDeFactura(e, { estado: "PENDIENTE_DE_REPARTO", confirmadaEn: null, confirmadaPorId: null, ...extra });
}

/** Un renglón de MERCADERIA válido (cantidad 10 a 10 por unidad = 100,00). */
export function datosDeRenglon(e: { facturaProveedorId: string; productoId?: string }, extra: Record<string, unknown> = {}) {
  return {
    facturaProveedorId: e.facturaProveedorId,
    orden: 1,
    naturaleza: "MERCADERIA",
    productoId: e.productoId as string,
    cantidadStock: "10",
    precioPorUnidadStock: "10",
    detalle: "10 kg",
    precioTotal: "100.00",
    ...extra,
  };
}
