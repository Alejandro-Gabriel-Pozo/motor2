import { crearUsuarioConMembresia, prisma, sembrarBase } from "../../setup/test-db";
import { crearMembresia } from "../../setup/membresia";
import { LOCALES_DEL_IMPORTADOR, type LocalDelImportador } from "../../../src/core/features/catalogo/importacion/tipos";

/** Las 8 secciones de carta que tiene producción (A.2: «Promociones» no se usa). */
export const SECCIONES_DE_PRODUCCION = ["Entrada", "Platos principales", "Clásicos", "Pastas caseras", "Pizzas", "Postres", "Bebidas", "Promociones"];

/**
 * La empresa de prueba armada como la del importador (contra Postgres real): las 5 sucursales con su nombre exacto más «Oficinas NQNTUR» (que no vende), la unidad «unidad», las 8
 * secciones de carta y la dueña, administradora en las 6 sucursales (con eso tiene las 4 claves de A.6 en cada una). Siembra con el rol de pruebas (`test/setup/test-db.ts`).
 */
export async function sembrarEmpresaDelImportador() {
  const base = await sembrarBase();
  const sucursales = {} as Record<LocalDelImportador, string>;
  for (const local of LOCALES_DEL_IMPORTADOR) sucursales[local] = (await prisma.sucursal.create({ data: { nombre: local } })).id;
  const oficinas = (await prisma.sucursal.create({ data: { nombre: "Oficinas NQNTUR" } })).id;
  const unidadId = (await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } })).id;
  const secciones: Record<string, string> = {};
  for (const [i, nombre] of SECCIONES_DE_PRODUCCION.entries()) secciones[nombre] = (await prisma.seccionCarta.create({ data: { nombre, orden: i + 1 } })).id;
  const duena = await crearUsuarioConMembresia({ email: "duena@importador.test", sucursalId: sucursales.Huinganco, rolId: base.admin.id });
  for (const id of [...Object.values(sucursales).filter((s) => s !== sucursales.Huinganco), oficinas, base.sucursal.id]) await crearMembresia({ usuarioId: duena.id, sucursalId: id, rolId: base.admin.id });
  return { base, sucursales, oficinas, unidadId, secciones, duena };
}
