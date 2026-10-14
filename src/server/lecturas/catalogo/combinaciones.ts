import "server-only";
import type { Prisma } from "@prisma/client";
import { claveDeCombinacion, type GrupoParaEjes, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { CombinacionesDelProducto } from "@/core/pos/public";
import { preciosLocalesDeCombinacionVigentes } from "./precio-local-de-combinaciones";
import { cargarRecetasVigentesDeCombinaciones } from "./recetas-de-combinacion";

/**
 * Lecturas de las COMBINACIONES de un producto (GO-3b, ADR-032, frente A): los grupos que admite vistos como posibles EJES (con las cantidades efectivas: las del producto si las sobrescribe, si no
 * las del grupo) y sus combinaciones. SIEMPRE con el `tx` de quien llama (los casos de uso deciden con lo que leen adentro de su transacción SERIALIZABLE). Un id de otra empresa no se ve (RLS).
 * Lo que decide un precio de la SUCURSAL no se lee acá: va en `precio-local-de-combinaciones.ts` (el embudo del precio local).
 */

type Tx = Prisma.TransactionClient;

/** Un grupo admitido por el producto, como posible eje, con las opciones que el producto admite (activas) y si cada una es la «ninguna». */
export interface GrupoAdmitidoParaEjes extends GrupoParaEjes {
  /** El id de la fila `ProductoAdmiteGrupo` (el `entidadId` de su auditoría). */
  admiteId: string;
  /** `ProductoAdmiteGrupo.activo` y `GrupoDeOpciones.activo`. */
  activo: boolean;
  opcionesAdmitidas: ReadonlyMap<string, { nombre: string; esNinguna: boolean }>;
}

export interface ProductoConEjes {
  id: string;
  nombre: string;
  seProduce: boolean;
  grupos: GrupoAdmitidoParaEjes[];
  /** El grupo de cada eje declarado (`ejeDeCombinacion`), o `null`. */
  ejes: { eje1: string | null; eje2: string | null };
}

/** El producto con sus grupos admitidos como posibles ejes, o `null` si no existe (o es de otra empresa). Una sola consulta. */
export async function cargarProductoConEjesEnTx(tx: Tx, productoId: string): Promise<ProductoConEjes | null> {
  const p = await tx.producto.findFirst({
    where: { id: productoId },
    select: {
      id: true,
      nombre: true,
      seProduce: true,
      opcionesAdmitidas: { where: { activo: true }, select: { opcionId: true } },
      gruposAdmitidos: {
        orderBy: [{ orden: "asc" }, { id: "asc" }],
        select: {
          id: true,
          ejeDeCombinacion: true,
          cantidadMinima: true,
          cantidadMaxima: true,
          activo: true,
          grupo: { select: { id: true, nombre: true, tipo: true, cantidadMinima: true, cantidadMaxima: true, activo: true, opciones: { select: { id: true, nombre: true, esNinguna: true, activa: true } } } },
        },
      },
    },
  });
  if (!p) return null;
  const admitidas = new Set(p.opcionesAdmitidas.map((o) => o.opcionId));
  const grupos = p.gruposAdmitidos.map(
    (pg): GrupoAdmitidoParaEjes => ({
      admiteId: pg.id,
      grupoId: pg.grupo.id,
      nombre: pg.grupo.nombre,
      tipo: pg.grupo.tipo as TipoDeGrupoDeOpciones,
      cantidadMinima: pg.cantidadMinima ?? pg.grupo.cantidadMinima,
      cantidadMaxima: pg.cantidadMaxima ?? pg.grupo.cantidadMaxima,
      eje: pg.ejeDeCombinacion,
      activo: pg.activo && pg.grupo.activo,
      opcionesAdmitidas: new Map(pg.grupo.opciones.filter((o) => o.activa && admitidas.has(o.id)).map((o) => [o.id, { nombre: o.nombre, esNinguna: o.esNinguna }])),
    }),
  );
  const deEje = (n: number) => grupos.find((g) => g.eje === n)?.grupoId ?? null;
  return { id: p.id, nombre: p.nombre, seProduce: p.seProduce, grupos, ejes: { eje1: deEje(1), eje2: deEje(2) } };
}

/** ¿El producto tiene alguna combinación (activa o no)? Los ejes no cambian mientras exista una. */
export async function tieneCombinaciones(tx: Tx, productoId: string): Promise<boolean> {
  return (await tx.combinacionDeProducto.count({ where: { productoId } })) > 0;
}

/** La combinación (producto, eje 1, eje 2), o `null`. */
export async function cargarCombinacionEnTx(tx: Tx, clave: { productoId: string; opcionEje1Id: string; opcionEje2Id: string | null }) {
  return tx.combinacionDeProducto.findFirst({
    where: { productoId: clave.productoId, opcionEje1Id: clave.opcionEje1Id, opcionEje2Id: clave.opcionEje2Id },
    select: { id: true, activa: true, precio: true, grupoDePrecioId: true, version: true },
  });
}

/**
 * GO-3b (F5, I1): las COMBINACIONES de los productos con ejes de un pedido, para venderlas en la sucursal (la forma que pide `armarLineaConfigurada`): sus filas (activa o no, precio propio o tarifa
 * con su estado, y la versión VIGENTE de su receta propia, que la venta congela al agregar), y los precios locales VIGENTES de la sucursal (por el embudo del precio local). Quien llama pasa SOLO los
 * productos que tienen algún grupo eje (lo dice la lectura de las opciones): un pedido sin combinaciones no lee nada de acá. Cuatro consultas (filas, recetas, capacidad y precios locales).
 */
export async function cargarCombinacionesParaVender(
  tx: Tx,
  args: { sucursalId: string; productoIds: readonly string[] },
): Promise<Map<string, CombinacionesDelProducto>> {
  if (args.productoIds.length === 0) return new Map();
  const filas = await tx.combinacionDeProducto.findMany({
    where: { productoId: { in: [...args.productoIds] } },
    select: {
      id: true,
      productoId: true,
      opcionEje1Id: true,
      opcionEje2Id: true,
      activa: true,
      precio: true,
      producto: { select: { nombre: true } },
      grupoDePrecio: { select: { id: true, nombre: true, precio: true, activo: true } },
    },
  });
  const recetas = await cargarRecetasVigentesDeCombinaciones(tx, filas.map((f) => f.id));
  const locales = await preciosLocalesDeCombinacionVigentes(args.sucursalId, tx, {
    combinacionIds: filas.map((f) => f.id),
    grupoDePrecioIds: [...new Set(filas.flatMap((f) => (f.grupoDePrecio ? [f.grupoDePrecio.id] : [])))],
  });
  const resultado = new Map<string, CombinacionesDelProducto>();
  for (const productoId of new Set(args.productoIds)) {
    const propias = filas.filter((f) => f.productoId === productoId);
    resultado.set(productoId, {
      // El nombre solo aparece en un rechazo de una combinación que existe (sin filas no hay mensaje que lo use).
      nombreDelProducto: propias[0]?.producto.nombre ?? "",
      filas: new Map(
        propias.map((f) => [
          claveDeCombinacion(f),
          {
            combinacionId: f.id,
            activa: f.activa,
            precio: f.precio === null ? null : Number(f.precio),
            grupo: f.grupoDePrecio ? { grupoDePrecioId: f.grupoDePrecio.id, nombre: f.grupoDePrecio.nombre, precio: Number(f.grupoDePrecio.precio), activo: f.grupoDePrecio.activo } : null,
            recetaDeCombinacionVersionId: recetas.get(f.id)?.versionId ?? null,
          },
        ]),
      ),
      locales,
    });
  }
  return resultado;
}
