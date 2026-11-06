/**
 * MAQUETA (rama temporal alegp/tmp-capturas-correcciones, no se mergea): siembra una base LOCAL descartable (`*_e2e`, ver test/e2e/fixtures/base-e2e.ts)
 * con los datos reales de la empresa que se leyeron de producción solo en lectura: sucursales, proveedor CORDECC, Mesa 1 (SALON), puesto 0 (MOSTRADOR) y los
 * productos de venta con sus precios. Las ventas, las compras y las correcciones NO se siembran: se hacen por las pantallas (capturar.ts).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolverUrlE2E, crearPrismaE2E, resetearBaseE2E } from "../../../../test/e2e/fixtures/base-e2e";
import { asegurarBaseSeed } from "../../../../test/e2e/fixtures/auth";
import { prisma } from "../../../../test/e2e/fixtures/db";
import { prismaAdmin } from "../../../../test/setup/cliente-duenio";
import { crearMembresia } from "../../../../test/setup/membresia";
import { darRecetaDeReventa } from "../../../../test/setup/receta-de-venta";

export const EMAIL_GERENTE = "gerente@maqueta.local";
const SUCURSALES = ["Oficinas NQNTUR", "Varvarco", "Huinganco", "Manzano Amargo", "Las Ovejas", "Los Miches"];
/** Productos de venta (PV) y precio de venta reales; el resto de los 47 no se pasó. */
const PRODUCTOS_DE_VENTA: Array<[string, number]> = [
  ["Agua 500 cc", 4000], ["Agua 1500 cc", 5000], ["Agua con gas 500 cc", 4000], ["Agua con gas 1500 cc", 6000], ["Agua saborizada 500 cc", 5000], ["Agua saborizada 1500 cc", 7000],
  ["Andes lata 473 cc", 5000], ["Andes Botella", 10000], ["Brownie", 10000], ["Café", 4000], ["Campari", 9000], ["Capuccino", 8000], ["Cerveza Corona 330 cc", 8000],
  ["Cerveza Corona 710 cc", 11000], ["Cerveza Kawin 1 litro", 13000], ["Cerveza Patagonia", 14000], ["Ensalada de estación", 10000], ["Fernet", 9000], ["Flan casero", 9000],
  ["Gancia", 9000], ["Gaseosa 500 cc", 5000], ["Gaseosa 1500 cc", 9000], ["Gin tonic", 12000],
];
/** Lo que ya hay en el depósito antes de los casos (stock propio de los PV que se venden en la maqueta y que no se compran a CORDECC). */
/** Los PV de reventa de CORDECC (los de la maqueta de compras). */
const REVENTA = ["Cerveza Patagonia", "Agua 500 cc"];
const STOCK_INICIAL: Record<string, number> = { Brownie: 20, "Café": 200, Capuccino: 100, "Flan casero": 20 };

async function main() {
  const base = resolverUrlE2E(process.env);
  const duenio = crearPrismaE2E(base);
  await resetearBaseE2E(duenio);
  await duenio.$disconnect();

  const { sucursal, seccion, admin } = await asegurarBaseSeed();
  const empresaId = sucursal.empresaId;
  await prismaAdmin.empresa.update({ where: { id: empresaId }, data: { nombre: "Empresa" } });
  // La sucursal que opera en la maqueta es Varvarco (supuesto declarado: no se sabe en cuál está la Mesa 1 real).
  await prismaAdmin.sucursal.update({ where: { id: sucursal.id }, data: { nombre: "Varvarco" } });
  await prismaAdmin.seccion.update({ where: { id: seccion.id }, data: { nombre: "Depósito" } });
  const otras = [];
  for (const nombre of SUCURSALES.filter((n) => n !== "Varvarco")) otras.push(await prismaAdmin.sucursal.create({ data: { empresaId, nombre } }));

  const usuario = await prismaAdmin.user.create({ data: { email: EMAIL_GERENTE, name: "Gerente", activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal.id, rolId: admin.id, activo: true });
  for (const s of otras) await crearMembresia({ usuarioId: usuario.id, sucursalId: s.id, rolId: admin.id, activo: true });
  await prismaAdmin.session.create({ data: { sessionToken: "maqueta-sesion-gerente", userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) } });

  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  await prisma.proveedor.create({ data: { codigo: "CORDECC", nombre: "CORDECC" } });
  await prisma.mesa.create({ data: { sucursalId: sucursal.id, numero: 1, tipo: "SALON" } });
  await prisma.mesa.create({ data: { sucursalId: sucursal.id, numero: 0, tipo: "MOSTRADOR" } });

  for (const [nombre, precio] of PRODUCTOS_DE_VENTA) {
    const codigo = `PV_${nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
    const pv = await prisma.producto.create({ data: { codigo, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: precio } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal.id, productoId: pv.id, disponible: true } });
    // PV de reventa que se compra a CORDECC: la Compra solo ofrece insumos, así que el sistema lo modela como un insumo («<nombre> (reventa)») con receta 1:1; sin stock hasta que se cargue la factura.
    if (REVENTA.includes(nombre)) {
      // El sistema no admite dos productos con el mismo nombre (Producto_nombre_lower_key): el insumo lleva «(reventa)», como lo nombra el propio sistema.
      await darRecetaDeReventa(prisma, pv, { sucursalIds: [sucursal.id] });
    }
    // Los elaborados que se venden en la maqueta no tienen sus recetas reales cargadas aquí: sustituto declarado = insumo «<nombre> (reventa)» 1:1 con stock, para que el sistema deje venderlos ("sin receta no se vende").
    const stock = STOCK_INICIAL[nombre];
    if (stock) await darRecetaDeReventa(prisma, pv, { sucursalIds: [sucursal.id], stock: { cantidad: stock, seccionIds: [seccion.id], usuarioId: usuario.id } });
  }
  console.log(`[maqueta] Base lista (${base.nombre}); sesión: cookie authjs.session-token=maqueta-sesion-gerente; token aleatorio de apoyo ${randomUUID().slice(0, 4)}`);
  await prisma.$disconnect();
  await prismaAdmin.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
