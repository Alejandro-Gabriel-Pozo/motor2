import "server-only";
import type { Prisma } from "@prisma/client";
import { deCentavos } from "@/core/carta/public";
import { comprobarPlanAntesDeEscribir, contenidosAEscribir, type PlanDeCarta } from "@/core/features/catalogo/importacion/planificar-carta";
import { disponibilidadesAEscribir, productosAEscribir, type OrigenDelPrecio, type PlanDeProductos } from "@/core/features/catalogo/importacion/planificar-productos";
import type { CambioAuditable } from "@/core/permisos/auditoria";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearContenidosImportados } from "@/server/persistencia/carta/contenido-producto";
import { crearProductosImportados, sembrarDisponibilidadImportada } from "@/server/persistencia/catalogo/productos";

/**
 * PASO COMPARTIDO del importador del catálogo (E1.4; no es un caso de uso: lo llama solo `importar-catalogo.ts`, dentro de SU transacción SERIALIZABLE): las ESCRITURAS EN LOTE de un plan ya
 * comprobado (docs/diseno-importador-de-catalogo-2026-10-28.md, ADENDA A.4). Cuatro viajes, todos con el `tx` de quien llama, así que van todos o ninguno (I1):
 *  1. `createManyAndReturn` de los productos nuevos (los `CREAR`), con su precio único como `precioVenta` (nunca `PrecioLocalProducto`: un precio por empresa, A.1);
 *  2. `createMany` de su disponibilidad (una fila por local con fila en el Excel);
 *  3. `createMany` de los contenidos de carta nuevos (create, nunca upsert: no pisa nada);
 *  4. UN `createMany` de auditoría (el escritor por lotes de `registrarCambioAuditado`): una fila por producto (`Producto.precioVenta`, de null al precio, con la huella y el origen del precio) y
 *     una por contenido (`ContenidoCartaProducto.visibleEnCarta`, de null a true, con la sucursal: la misma que deja «Agregar a la carta»). La disponibilidad del alta no se audita, como en
 *     `sembrarDisponibilidadDeProductoNuevo` (excepción declarada de escrituras-auditadas): es parte del alta y no hay valor anterior.
 * Antes de escribir, `comprobarPlanAntesDeEscribir` (I6). Devuelve cuánto escribió de cada cosa.
 */
const ORIGEN: Record<OrigenDelPrecio, string> = {
  UNICO_EN_EL_EXCEL: "único en el Excel",
  CORRECCION: "corrección del dueño",
  REGLA: "regla del precio único (el más frecuente; si empatan, el mayor)",
  SIN_PRECIO_EN_EL_EXCEL: "sin precio en el Excel",
};

export interface EscriturasDeLaImportacion {
  productos: number;
  filasDeDisponibilidad: number;
  contenidos: number;
  auditorias: number;
}

export async function escribirImportacionDeCatalogoEnTx(
  tx: Prisma.TransactionClient,
  entrada: { productos: PlanDeProductos; carta: PlanDeCarta; unidadId: string; actorId: string; huellaVisible: string },
): Promise<EscriturasDeLaImportacion> {
  comprobarPlanAntesDeEscribir(entrada.productos, entrada.carta);
  const nuevos = productosAEscribir(entrada.productos, entrada.unidadId);
  const creados = await crearProductosImportados(tx, nuevos);
  if (creados.length !== nuevos.length) throw new Error(`Se pidieron ${nuevos.length} productos y la base devolvió ${creados.length}.`);
  const idPorCodigo = new Map(creados.map((p) => [p.codigo, p.id]));
  const filasDeDisponibilidad = await sembrarDisponibilidadImportada(tx, disponibilidadesAEscribir(entrada.productos, idPorCodigo));
  const contenidos = contenidosAEscribir(entrada.carta, idPorCodigo);
  await crearContenidosImportados(tx, contenidos);

  const nombrePorId = new Map<string, string>();
  for (const p of entrada.productos.productos) {
    const id = idPorCodigo.get(p.sku) ?? p.existenteId;
    if (id) nombrePorId.set(id, p.nombre);
  }
  const seccionPorId = new Map(entrada.carta.contenidos.flatMap((c) => (c.seccionId && c.seccion ? [[c.seccionId, c.seccion] as const] : [])));
  const localPorSucursal = new Map(entrada.carta.contenidos.flatMap((c) => (c.sucursalId ? [[c.sucursalId, c.local] as const] : [])));
  const cambios: CambioAuditable[] = [
    ...entrada.productos.productos
      .filter((p) => p.accion === "CREAR")
      .map(
        (p): CambioAuditable => ({
          entidad: "Producto",
          entidadId: idPorCodigo.get(p.sku)!,
          campo: "precioVenta",
          descripcion: `Importación de catálogo ${entrada.huellaVisible}: «${p.nombre}» (${p.sku}) precio de venta (${ORIGEN[p.precio!.origen]})`,
          valorAnterior: null,
          valorNuevo: deCentavos(p.precio!.centavos),
          actorId: entrada.actorId,
          sucursalId: null,
        }),
      ),
    ...contenidos.map(
      (c): CambioAuditable => ({
        entidad: "ContenidoCartaProducto",
        entidadId: `${c.sucursalId}:${c.productoId}`,
        campo: "visibleEnCarta",
        descripcion: `Carta de «${localPorSucursal.get(c.sucursalId)}»: «${nombrePorId.get(c.productoId)}» agregado a «${seccionPorId.get(c.seccionCartaId)}» (importación de catálogo ${entrada.huellaVisible})`,
        valorAnterior: null,
        valorNuevo: true,
        actorId: entrada.actorId,
        sucursalId: c.sucursalId,
      }),
    ),
  ];
  await registrarCambioAuditado(tx, cambios);
  return { productos: creados.length, filasDeDisponibilidad, contenidos: contenidos.length, auditorias: cambios.length };
}
