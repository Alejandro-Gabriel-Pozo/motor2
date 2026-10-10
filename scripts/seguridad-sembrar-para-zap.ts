/**
 * Siembra la base DESCARTABLE sobre la que OWASP ZAP escanea la aplicación (`.github/workflows/seguridad.yml`, job `zap`): la empresa, los roles y una carta pública con
 * una sucursal publicada, para que el rastreador tenga páginas reales además del login. Reutiliza el seed de los E2E (`asegurarBaseSeed`) y NO crea sesiones ni usuarios con
 * acceso: ZAP entra como anónimo.
 *
 * Guarda: usa las mismas variables y las mismas validaciones que Playwright (`MOTOR2_E2E_DATABASE_URL` / `MOTOR2_E2E_APP_DATABASE_URL`): solo una base LOCAL cuyo nombre
 * termina en `_e2e`; contra cualquier otra cosa (Neon, producción, `motor2_dev`) aborta sin conectarse. Uso local: ver docs/seguridad-pipeline.md.
 */
import "dotenv/config";
import { resolverUrlAppE2E, resolverUrlE2E } from "../test/e2e/fixtures/base-e2e";

const SLUG_SUCURSAL = "zap";

async function main(): Promise<void> {
  const base = resolverUrlE2E(process.env);
  const baseApp = resolverUrlAppE2E(process.env);
  // Los módulos que leen `DATABASE_URL` al importarse (el cliente de Prisma) tienen que verla ya apuntando a la base validada.
  process.env.DATABASE_URL = baseApp.url;
  process.env.DIRECT_URL = base.url;
  console.log(`[zap] Base descartable: ${base.host}/${base.nombre}`);

  const { asegurarBaseSeed } = await import("../test/e2e/fixtures/auth");
  const { prisma } = await import("../test/e2e/fixtures/db");
  try {
    const { sucursal } = await asegurarBaseSeed();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const seccion = await prisma.seccionCarta.upsert({ where: { empresaId_nombre: { empresaId: sucursal.empresaId, nombre: "Platos" } }, update: {}, create: { nombre: "Platos", orden: 1 } });
    const producto = await prisma.producto.upsert({
      where: { empresaId_codigo: { empresaId: sucursal.empresaId, codigo: "PV_ZAP_1" } },
      update: {},
      create: { codigo: "PV_ZAP_1", nombre: "Milanesa de prueba", tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id },
    });
    await prisma.disponibilidadProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: sucursal.id, productoId: producto.id } },
      update: { disponible: true },
      create: { sucursalId: sucursal.id, productoId: producto.id, disponible: true },
    });
    await prisma.contenidoCartaProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: sucursal.id, productoId: producto.id } },
      update: { visibleEnCarta: true, seccionCartaId: seccion.id },
      create: { sucursalId: sucursal.id, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: "Plato de prueba para el escaneo de seguridad" },
    });
    await prisma.sucursalPublica.upsert({
      where: { empresaId_sucursalId: { empresaId: sucursal.empresaId, sucursalId: sucursal.id } },
      update: { slug: SLUG_SUCURSAL, publicada: true },
      create: { sucursalId: sucursal.id, slug: SLUG_SUCURSAL, publicada: true },
    });
    console.log(`[zap] Carta pública sembrada: /carta-publica/e2e/${SLUG_SUCURSAL}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
