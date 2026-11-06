import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";

/**
 * Migración 20261104100000_compras_unidad_de_compra (Compras, etapa 2a): `unidadCompraId` + `cantidadCompra` en `MovimientoStock` y `FacturaProveedorRenglon`. Se corre acá contra la base de pruebas, sentencia por sentencia
 * y como DUEÑO (mismo molde que `migracion-rol-clave.test.ts`). Cada test termina con la base en el estado NUEVO (el que espera el resto de la suite). Prueba lo que la base garantiza SOLA: las dos columnas
 * van juntas, la cantidad es mayor que cero, la unidad es de la misma empresa, y la reversa aborta (sin tocar nada) si ya hay datos.
 */
const CARPETA = join(__dirname, "../../prisma/migrations/20261104100000_compras_unidad_de_compra");

/** Parte un .sql en sentencias respetando los bloques `$$ … $$` (un DO tiene `;` adentro). */
function sentenciasDe(archivo: string): string[] {
  const sql = readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const salida: string[] = [];
  let actual = "";
  let dentroDeBloque = false;
  for (const linea of sql.split("\n")) {
    actual += linea + "\n";
    if ((linea.match(/\$\$/g) ?? []).length % 2 === 1) dentroDeBloque = !dentroDeBloque;
    if (!dentroDeBloque && linea.trimEnd().endsWith(";")) {
      salida.push(actual.trim());
      actual = "";
    }
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

const MIGRACION = sentenciasDe("migration.sql");
const REVERSA = sentenciasDe("down.sql");

async function correr(sentencias: string[]) {
  for (const s of sentencias) await prismaAdmin.$executeRawUnsafe(s);
}

const columnas = async () =>
  (
    await prismaAdmin.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name IN ('MovimientoStock','FacturaProveedorRenglon') AND column_name IN ('unidadCompraId','cantidadCompra')`
    )
  )[0]!.n;

let unidadId: string;
let movimientoBase: { operacionId: string; productoId: string; seccionId: string };

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const { kg, insumo } = await sembrarCatalogoBase();
  unidadId = kg.id;
  const seccion = await sembrarSeccion(base.sucursal.id);
  const usuario = await prisma.user.create({ data: { email: "u@test.com" } });
  const producto = await prisma.producto.create({ data: { codigo: "MP_A", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const operacion = await prisma.operacion.create({ data: { sucursalId: base.sucursal.id, proceso: "COMPRA", fecha: new Date(), usuarioId: usuario.id } });
  movimientoBase = { operacionId: operacion.id, productoId: producto.id, seccionId: seccion.id };
});

afterEach(async () => {
  // La migración no es idempotente: solo se vuelve a aplicar si un test dejó la base en el estado viejo.
  if ((await columnas()) !== 4) await correr(MIGRACION);
});

const nuevoMovimiento = (extra: { unidadCompraId?: string | null; cantidadCompra?: string | null }) =>
  prismaAdmin.movimientoStock.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, ...movimientoBase, proceso: "COMPRA", cantidad: 1, detalle: "x", ...extra } });

describe("restricciones de la base (CHECK y clave foránea)", () => {
  it("unidad y cantidad juntas: se aceptan las dos o ninguna", async () => {
    await expect(nuevoMovimiento({})).resolves.toBeTruthy();
    await expect(nuevoMovimiento({ unidadCompraId: unidadId, cantidadCompra: "3" })).resolves.toBeTruthy();
  });

  it("la unidad sin la cantidad, o la cantidad sin la unidad, la rechaza la base", async () => {
    await expect(nuevoMovimiento({ unidadCompraId: unidadId })).rejects.toThrow(/MovimientoStock_unidad_compra_pareo_chk|check constraint/);
    await expect(nuevoMovimiento({ cantidadCompra: "3" })).rejects.toThrow(/MovimientoStock_unidad_compra_pareo_chk|check constraint/);
  });

  it("la cantidad comprada tiene que ser mayor que cero", async () => {
    for (const cantidadCompra of ["0", "-1"]) {
      await expect(nuevoMovimiento({ unidadCompraId: unidadId, cantidadCompra })).rejects.toThrow(/MovimientoStock_cantidad_compra_chk|check constraint/);
    }
  });

  it("la unidad tiene que existir en la MISMA empresa (clave foránea compuesta)", async () => {
    await expect(nuevoMovimiento({ unidadCompraId: "no-existe", cantidadCompra: "3" })).rejects.toThrow(/foreign key|Foreign key|MovimientoStock_empresaId_unidadCompraId_fkey/);
  });

  it("lo mismo en el renglón de la factura: pareo, cantidad > 0 y unidad de la empresa", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } });
    const usuario = await prisma.user.findFirstOrThrow();
    const cabecera = await prismaAdmin.facturaProveedor.create({
      data: { empresaId: EMPRESA_POR_DEFECTO_ID, proveedorId: proveedor.id, nroFactura: "A-00001-00000001", nroFacturaNormalizado: "A:1-1", fecha: new Date(), importeTotal: 10, estado: "CONFIRMADA", confirmadaEn: new Date(), confirmadaPorId: usuario.id, claveIdempotencia: crypto.randomUUID(), payloadHash: "h", creadoPorId: usuario.id },
    });
    const renglon = (extra: { unidadCompraId?: string | null; cantidadCompra?: string | null }, orden: number) =>
      prismaAdmin.facturaProveedorRenglon.create({
        data: { empresaId: EMPRESA_POR_DEFECTO_ID, facturaProveedorId: cabecera.id, orden, naturaleza: "MERCADERIA", productoId: movimientoBase.productoId, cantidadStock: 1, precioPorUnidadStock: 10, detalle: "x", precioTotal: 10, ...extra },
      });
    await expect(renglon({ unidadCompraId: unidadId, cantidadCompra: "3" }, 1)).resolves.toBeTruthy();
    await expect(renglon({ unidadCompraId: unidadId }, 2)).rejects.toThrow(/FacturaProveedorRenglon_unidad_compra_pareo_chk|check constraint/);
    await expect(renglon({ unidadCompraId: unidadId, cantidadCompra: "0" }, 3)).rejects.toThrow(/FacturaProveedorRenglon_cantidad_compra_chk|check constraint/);
    await expect(renglon({ unidadCompraId: "no-existe", cantidadCompra: "3" }, 4)).rejects.toThrow(/foreign key|Foreign key|FacturaProveedorRenglon_empresaId_unidadCompraId_fkey/);
  });
});

describe("reversa (down.sql)", () => {
  it("sin datos cargados en las columnas nuevas: las saca de las dos tablas y vuelve a aplicarse", async () => {
    await nuevoMovimiento({}); // un movimiento anterior a la migración (columnas en NULL) no impide bajar
    await correr(REVERSA);
    expect(await columnas()).toBe(0);
    await correr(REVERSA); // idempotente
    await correr(MIGRACION);
    expect(await columnas()).toBe(4);
  });

  it("con una compra que ya tiene unidad y cantidad: ABORTA, sin tocar nada", async () => {
    await nuevoMovimiento({ unidadCompraId: unidadId, cantidadCompra: "3" });
    await expect(correr(REVERSA)).rejects.toThrow(/No se puede bajar 20261104100000_compras_unidad_de_compra/);
    expect(await columnas()).toBe(4);
    const guardada = await prismaAdmin.movimientoStock.findFirstOrThrow({ where: { unidadCompraId: { not: null } } });
    expect(guardada.cantidadCompra?.toFixed(4)).toBe("3.0000");
  });
});
