/**
 * MAQUETA (rama temporal alegp/tmp-capturas-poda-genero, no se mergea): después de `sembrar-datos-reales.ts`, arma la CARTA de Varvarco con los productos reales del dueño y la
 * estructura que la poda oculta: los géneros Agua, Agua saborizada y Huinganco, y un ítem agrupado «Aguas» (Agua 500 cc y Agua con gas 500 cc, $4.000 las dos).
 * Todo por el cliente de la base local descartable `*_e2e`; nunca producción.
 */
import "dotenv/config";
import { prisma } from "../../../../test/e2e/fixtures/db";
import { prismaAdmin } from "../../../../test/setup/cliente-duenio";

async function main() {
  const sucursal = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Varvarco" }, include: { empresa: true } });
  const sucursalId = sucursal.id;
  const prod = async (nombre: string) => (await prisma.producto.findFirstOrThrow({ where: { nombre } })).id;
  const cafeteria = await prisma.seccionCarta.create({ data: { nombre: "Cafetería", orden: 1 } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 2 } });
  const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres", orden: 3 } });
  const agua = await prisma.generoCarta.create({ data: { sucursalId, nombre: "Agua", orden: 1 } });
  const saborizada = await prisma.generoCarta.create({ data: { sucursalId, nombre: "Agua saborizada", orden: 2 } });
  const huinganco = await prisma.generoCarta.create({ data: { sucursalId, nombre: "Huinganco", orden: 3 } });
  const contenidos: [string, string, number, string | null][] = [
    ["Café", cafeteria.id, 1, null],
    ["Capuccino", cafeteria.id, 2, null],
    ["Cerveza Patagonia", bebidas.id, 3, huinganco.id],
    ["Agua saborizada 500 cc", bebidas.id, 4, saborizada.id],
    ["Gaseosa 500 cc", bebidas.id, 5, null],
    ["Brownie", postres.id, 1, null],
  ];
  for (const [nombre, seccionCartaId, orden, generoCartaId] of contenidos) {
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: await prod(nombre), visibleEnCarta: true, seccionCartaId, orden, generoCartaId } });
  }
  const aguas = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Aguas", seccionCartaId: bebidas.id, orden: 1, generoCartaId: agua.id } });
  for (const [orden, nombre] of ["Agua 500 cc", "Agua con gas 500 cc"].entries()) {
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: aguas.id, productoId: await prod(nombre), orden } });
  }
  await prismaAdmin.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prismaAdmin.sucursalPublica.create({ data: { sucursalId, slug: "varvarco", publicada: true } });
  console.log(`[maqueta] Carta lista; empresa ${sucursal.empresa.slug}`);
  await prisma.$disconnect();
  await prismaAdmin.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
