// GO-2d: SIN `import "server-only"` (como `precio-local.ts`): la carta pública lo alcanza (`lecturas/carta/menu.ts`) y a esa la carga una fixture de Playwright
// (`test/e2e/fixtures/carta-menu.ts`), donde ese módulo revienta. Declarado en `test/arquitectura/server-only-en-consultas-y-lecturas.test.ts`.
import type { Prisma, PrismaClient } from "@prisma/client";
import { precioLocalActivoEn } from "./precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * GO-2a (ADR-030 §5): el ÚNICO lugar que lee la GRILLA de precios de una opción por sucursal (`PrecioLocalDeOpcion`, ADR-009 familia `override`; lo fija
 * `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`). La venta (GO-2b) decide el precio con `preciosLocalesDeOpcionVigentes` y la administración lee la fila anterior con
 * `filaDePrecioLocalDeOpcion`. La capacidad `precio_local` se sigue preguntando en un solo lugar: `precioLocalActivoEn` de `precio-local.ts`.
 *
 * Vive en un archivo PROPIO, al lado de `precio-local.ts` y no adentro, a propósito: la carta pública alcanza `precio-local.ts` (el precio local de los productos) y su guardián
 * (`carta-publica-lista-cerrada.test.ts`) junta los campos de TODO archivo que alcanza; con la grilla de opciones ahí, la lista cerrada de lo que un anónimo puede leer crecería sin que
 * la carta lo use. Las opciones no están en la carta pública (ADR-030 §11).
 */

/**
 * Los precios locales VIGENTES de las opciones de UN producto en la sucursal: el mapa `opcionId → precio`. Rige una fila solo si (1) la sucursal tiene prendida la capacidad
 * `precio_local` (el interruptor único de todo precio propio, como `preciosLocalesVigentes`), (2) la fila está habilitada, (3) el producto ADMITE la opción (su fila y la de su grupo,
 * activas) y (4) la opción es una MEDIDA que ese producto cobra en modo ABSOLUTO: el precio por sucursal de una variante o de un adicional no entra (GO-0 §8). Lo que no está en el
 * mapa se cobra al precio de la empresa (`ProductoAdmiteOpcion.precioAbsoluto`). Dos consultas.
 */
export async function preciosLocalesDeOpcionVigentes(sucursalId: string, db: Db, productoId: string, precioLocalActivo?: boolean | Promise<boolean>): Promise<Map<string, number>> {
  const [capacidadActiva, filas] = await Promise.all([
    precioLocalActivo ?? precioLocalActivoEn(sucursalId, db),
    db.precioLocalDeOpcion.findMany({
      where: { sucursalId, productoId, habilitado: true },
      select: {
        opcionId: true,
        precio: true,
        opcion: {
          select: {
            grupoId: true,
            grupo: { select: { tipo: true } },
            productosQueLaAdmiten: { where: { productoId, activo: true }, select: { id: true } },
          },
        },
      },
    }),
  ]);
  if (!capacidadActiva || filas.length === 0) return new Map();
  const grupoIds = [...new Set(filas.map((f) => f.opcion.grupoId))];
  const absolutos = new Set(
    (await db.productoAdmiteGrupo.findMany({ where: { productoId, grupoId: { in: grupoIds }, activo: true, modoPrecio: "ABSOLUTO" }, select: { grupoId: true } })).map((g) => g.grupoId)
  );
  const vigentes = new Map<string, number>();
  for (const f of filas) {
    if (f.opcion.grupo.tipo !== "MEDIDA" || f.opcion.productosQueLaAdmiten.length === 0 || !absolutos.has(f.opcion.grupoId)) continue;
    vigentes.set(f.opcionId, Number(f.precio));
  }
  return vigentes;
}

/** La fila de la grilla de una opción de un producto en la sucursal, tal cual está (habilitada o no), o `null` si no hay. La lee el caso de uso que la edita, DENTRO de su transacción. */
export async function filaDePrecioLocalDeOpcion(db: Db, clave: { sucursalId: string; productoId: string; opcionId: string }): Promise<{ precio: number; habilitado: boolean } | null> {
  const fila = await db.precioLocalDeOpcion.findUnique({
    where: { sucursalId_productoId_opcionId: clave },
    select: { precio: true, habilitado: true },
  });
  return fila ? { precio: Number(fila.precio), habilitado: fila.habilitado } : null;
}

/**
 * GO-2d: TODAS las filas de la grilla de una sucursal (habilitadas o no), tal cual están, para la pantalla que las administra (`/movimientos/precio-local`, «Precios por tamaño en
 * esta sucursal»). No decide qué precio rige (eso es `preciosLocalesDeOpcionVigentes`, con la capacidad y la admisión): la pantalla muestra lo cargado y su estado. Una consulta.
 */
export async function filasDePrecioLocalDeOpcionesEnSucursal(db: Db, sucursalId: string): Promise<{ productoId: string; opcionId: string; precio: number; habilitado: boolean }[]> {
  const filas = await db.precioLocalDeOpcion.findMany({ where: { sucursalId }, select: { productoId: true, opcionId: true, precio: true, habilitado: true } });
  return filas.map((f) => ({ productoId: f.productoId, opcionId: f.opcionId, precio: Number(f.precio), habilitado: f.habilitado }));
}

/**
 * GO-2d: lo mismo que `preciosLocalesDeOpcionVigentes` (las MISMAS cuatro condiciones: la capacidad `precio_local`, la fila habilitada, la opción admitida por el producto y una
 * MEDIDA que ese producto cobra en ABSOLUTO) pero para VARIOS productos a la vez, en tres consultas fijas: lo usa el selector del POS para mostrar el precio de cada tamaño de
 * todos los productos de la carta sin una consulta por producto. El mapa va por `"<productoId>|<opcionId>"`. Lo que decide el precio al vender sigue siendo
 * `preciosLocalesDeOpcionVigentes`, dentro de la transacción de la venta.
 */
export async function preciosLocalesDeOpcionVigentesEnProductos(sucursalId: string, db: Db, productoIds: readonly string[], precioLocalActivo?: boolean | Promise<boolean>): Promise<Map<string, number>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const [capacidadActiva, filas] = await Promise.all([
    precioLocalActivo ?? precioLocalActivoEn(sucursalId, db),
    db.precioLocalDeOpcion.findMany({
      where: { sucursalId, productoId: { in: ids }, habilitado: true },
      select: {
        productoId: true,
        opcionId: true,
        precio: true,
        opcion: { select: { grupoId: true, grupo: { select: { tipo: true } }, productosQueLaAdmiten: { where: { productoId: { in: ids }, activo: true }, select: { productoId: true } } } },
      },
    }),
  ]);
  if (!capacidadActiva || filas.length === 0) return new Map();
  const absolutos = new Set(
    (
      await db.productoAdmiteGrupo.findMany({
        where: { productoId: { in: [...new Set(filas.map((f) => f.productoId))] }, grupoId: { in: [...new Set(filas.map((f) => f.opcion.grupoId))] }, activo: true, modoPrecio: "ABSOLUTO" },
        select: { productoId: true, grupoId: true },
      })
    ).map((g) => `${g.productoId}|${g.grupoId}`)
  );
  const vigentes = new Map<string, number>();
  for (const f of filas) {
    if (f.opcion.grupo.tipo !== "MEDIDA" || !f.opcion.productosQueLaAdmiten.some((a) => a.productoId === f.productoId) || !absolutos.has(`${f.productoId}|${f.opcion.grupoId}`)) continue;
    vigentes.set(`${f.productoId}|${f.opcionId}`, Number(f.precio));
  }
  return vigentes;
}
