import { prisma } from "./test-db";

/**
 * Un comprobante VÁLIDO y ÚNICO para cargar una compra en un test (etapa 1 de Compras: la COMPRA exige proveedor y un número «letra-punto de venta-número»). El proveedor de pruebas se crea la primera vez
 * que hace falta en la base limpia y se reutiliza después (`limpiarBaseDeTest` lo borra con los demás proveedores, así que se busca por código en cada llamada); el número es «A-00001-<contador de 8 dígitos>»,
 * distinto en cada llamada. Uso: `...(await comprobanteDePrueba())` dentro del objeto de la compra, ANTES de lo que el test quiere pisar (`proveedorId`, `nroFactura`).
 */
const CODIGO_PROVEEDOR_DE_PRUEBAS = "PRV_COMPROBANTE_PRUEBAS";

let contador = 0;

/** Un número de factura válido y distinto en cada llamada, para el test que ya elige su proveedor. */
export function nroFacturaDePrueba(): string {
  contador += 1;
  return `A-00001-${String(contador).padStart(8, "0")}`;
}

export async function comprobanteDePrueba(): Promise<{ proveedorId: string; nroFactura: string }> {
  const proveedor = (await prisma.proveedor.findFirst({ where: { codigo: CODIGO_PROVEEDOR_DE_PRUEBAS }, select: { id: true } })) ?? (await prisma.proveedor.create({ data: { codigo: CODIGO_PROVEEDOR_DE_PRUEBAS, nombre: "Proveedor de pruebas" }, select: { id: true } }));
  return { proveedorId: proveedor.id, nroFactura: nroFacturaDePrueba() };
}
