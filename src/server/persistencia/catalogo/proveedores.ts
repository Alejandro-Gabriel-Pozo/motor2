import "server-only";
import type { Prisma } from "@prisma/client";
import type { OfertaDeProveedor } from "@/core/features/catalogo/oferta-de-proveedor";
import type { ValoresDeContactoDeProveedor } from "@/core/features/catalogo/proveedores.schema";

/**
 * Escrituras de los PROVEEDORES (`Proveedor`; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-14 — `docs/plan-hito-4-pureza.md` §3; mismo
 * contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres escrituras
 * que antes hacía en línea `src/server/actions/catalogo/proveedores.ts`; las llaman los casos de uso `alta-proveedor.ts`, `actualizar-activa-proveedor.ts` y
 * `actualizar-proveedor.ts`, con la base del contexto y sin transacción (como antes). Un proveedor no tiene columnas de plata: no se audita.
 */

/**
 * Crea el proveedor con ese código (el `intentar` de `crearConCodigoAutogenerado`: un código repetido —o un CUIT que una carrera ya tomó— hace lanzar el P2002 del
 * índice único). Devuelve el id y el nombre guardados.
 */
export async function crearProveedorNuevo(
  db: Prisma.TransactionClient,
  args: { codigo: string; nombre: string; valores: ValoresDeContactoDeProveedor; oferta: OfertaDeProveedor },
): Promise<{ id: string; nombre: string }> {
  const { valores } = args;
  const creado = await db.proveedor.create({
    data: {
      codigo: args.codigo,
      nombre: args.nombre,
      contacto: valores.contacto,
      telefono: valores.telefono,
      email: valores.email,
      cuit: valores.cuit,
      condicionesPago: valores.condicionesPago,
      notas: valores.notas,
      ofreceProductos: args.oferta.ofreceProductos,
      ofreceServicios: args.oferta.ofreceServicios,
    },
  });
  return { id: creado.id, nombre: creado.nombre };
}

/** Activa o desactiva el proveedor. Devuelve si había uno con ese id (O.44: `updateMany` + `count`, y S-07: lo que no es texto no escribe; ver `fijarActivaDeCategoria`). */
export async function fijarActivoDeProveedor(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<boolean> {
  if (typeof args.id !== "string") return false;
  const { count } = await db.proveedor.updateMany({ where: { id: args.id }, data: { activo: args.activo } });
  return count > 0;
}

/**
 * Reescribe el nombre, los datos de contacto y qué le compramos al proveedor, con CONTROL OPTIMISTA sobre el nombre: el `where` lleva `nombre = nombreActual` (el que el caso de uso
 * acaba de leer), así que si otra edición lo cambió en el medio no toca ninguna fila y devuelve 0 (el caso de uso lo traduce a «cambió mientras lo editabas»). Un nombre o un CUIT que ya
 * tiene otro proveedor hace lanzar el P2002 del índice único (el árbitro final). Va siempre dentro de la transacción del caso de uso.
 */
export async function guardarProveedor(
  db: Prisma.TransactionClient,
  args: { id: string; nombreActual: string; nombre: string; valores: ValoresDeContactoDeProveedor; oferta: OfertaDeProveedor }
): Promise<number> {
  const { valores } = args;
  const { count } = await db.proveedor.updateMany({
    where: { id: args.id, nombre: args.nombreActual },
    data: {
      nombre: args.nombre,
      contacto: valores.contacto,
      telefono: valores.telefono,
      email: valores.email,
      cuit: valores.cuit,
      condicionesPago: valores.condicionesPago,
      notas: valores.notas,
      ofreceProductos: args.oferta.ofreceProductos,
      ofreceServicios: args.oferta.ofreceServicios,
    },
  });
  return count;
}
