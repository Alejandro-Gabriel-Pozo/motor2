import "server-only";
import type { Prisma } from "@prisma/client";
import type { GrupoParaEjes, TipoDeGrupoDeOpciones } from "@/core/opciones/public";

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
