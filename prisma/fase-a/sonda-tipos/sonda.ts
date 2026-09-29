// Sonda de tipos ADR-007 A1: compila los patrones reales de escritura/lectura del repo contra el Client OBJETIVO
// (node_modules/.prisma/fase-a-client). Nunca se ejecuta: solo `npm run` de tipos con su tsconfig propio.
// `@ts-expect-error` marca lo que ROMPE con el schema objetivo; si algún día deja de romper, tsc avisa.
import type { PrismaClient } from "../../../node_modules/.prisma/fase-a-client/index.js";

declare const db: PrismaClient;
declare const id: string;

export async function patronesQueSiguenCompilando() {
  // Escritura "unchecked" con FK escalares (el patrón del repo: 59 create/createMany, 0 `connect`), sin pasar empresaId.
  await db.producto.create({ data: { codigo: "c", tipo: "MP", nombre: "n", unidadStockId: id, factorConversion: 1 } });
  await db.grupo.create({ data: { nombre: "n", grupoPadreId: id } });
  await db.disponibilidadProducto.createMany({ data: [{ sucursalId: id, productoId: id, disponible: true }] });
  await db.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: id, productoId: id, orden: 1 } });
  await db.sucursal.create({ data: { nombre: "n" } });
  await db.cliente.create({ data: { nombre: "n", descuentoPorcentaje: 0 } });
  // Lecturas/updates por id (única simple `id` sigue existiendo) y por el compuesto explícito.
  await db.producto.findUnique({ where: { id } });
  await db.producto.update({ where: { id }, data: { nombre: "x", categoriaId: id } });
  await db.producto.update({ where: { id }, data: { insumoId: null } });
  await db.producto.findMany({ where: { unidadStockId: id, categoriaId: null } });
  await db.producto.findMany({ include: { unidadStock: true, categoria: true } });
  // Checked con connect por id: el tipo acepta `{ id }`; empresaId sale del default de la columna.
  await db.producto.create({
    data: { codigo: "c", tipo: "MP", nombre: "n", unidadStock: { connect: { id } }, empresa: { connect: { id } } },
  });
  // Nested create de hijo con FK compuesta.
  await db.sucursal.create({ data: { nombre: "n", secciones: { create: { nombre: "s" } } } });
}

export async function patronesQueRompen() {
  // Unicidad que pasó a ser por empresa: `where: { nombre }` ya no es un WhereUniqueInput.
  // @ts-expect-error nombre pasó a @@unique([empresaId, nombre])
  await db.sucursal.findUnique({ where: { nombre: "n" } });
  // @ts-expect-error codigo pasó a @@unique([empresaId, codigo])
  await db.producto.findUnique({ where: { codigo: "c" } });
  // @ts-expect-error idem en upsert
  await db.unidad.upsert({ where: { nombre: "n" }, create: { nombre: "n", magnitud: "MASA", decimales: 2 }, update: {} });
  // 1:1 con FK: `where: { sucursalId }` pasó a @@unique([empresaId, sucursalId]).
  // @ts-expect-error SucursalPublica.sucursalId
  await db.sucursalPublica.findUnique({ where: { sucursalId: id } });
  // Con las claves compuestas nuevas sí compila (lo que habría que escribir):
  await db.sucursal.findUnique({ where: { empresaId_nombre: { empresaId: id, nombre: "n" } } });
  await db.sucursalPublica.findUnique({ where: { empresaId_sucursalId: { empresaId: id, sucursalId: id } } });
}
