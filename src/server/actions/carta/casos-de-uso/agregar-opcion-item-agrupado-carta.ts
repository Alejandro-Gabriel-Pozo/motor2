import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { precioDeCarta, whereCartaDeSucursal } from "@/core/carta/public";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { validarOrdenCarta } from "@/core/carta/validaciones";
import type { ComandoAgregarOpcionItemAgrupadoCarta, ResultadoAgregarOpcionItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { productoTieneDescuentoEnAlgunaSucursal } from "@/server/lecturas/carta/descuentos";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { crearOpcionDeItemAgrupado } from "@/server/persistencia/carta/items-agrupados";

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

/** El mensaje cuando el producto ya está en un ítem agrupado (el mismo u otro) de la sucursal: un producto va en a lo sumo uno (D2). `null` si no está en ninguno. */
async function mensajeYaAgrupado(db: ContextoUsuario["db"], sucursalId: string, productoId: string, productoNombre: string, itemAgrupadoCartaId: string): Promise<string | null> {
  const ya = await db.opcionItemAgrupadoCarta.findFirst({ where: { productoId, ...whereCartaDeSucursal(sucursalId) }, select: { itemAgrupadoCartaId: true, itemAgrupadoCarta: { select: { nombre: true } } } });
  if (!ya) return null;
  if (ya.itemAgrupadoCartaId === itemAgrupadoCartaId) return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}».`;
  return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}»: quitalo de ahí primero.`;
}

/**
 * Caso de uso «agregar un producto como opción de un ítem agrupado de la carta» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en la función privada `agregarOpcion` de la Server Action
 * (`src/server/actions/carta/items-agrupados.ts`), movido TAL CUAL: la usaban la acción `agregarOpcionItemAgrupadoCarta` y el alta con productos de
 * `guardarItemAgrupadoCarta` (DA7), que ahora la llama como hermano (`guardar-item-agrupado-carta.ts`). La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_items_agrupados")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: lee el ítem antes de mirar el producto y valida el orden después de
 * varias lecturas. Los ítems agrupados y sus opciones son PROPIOS de cada sucursal (ADR-009, C3): las lecturas miran solo la sucursal activa.
 *
 * Bloquea (D5) si el precio del producto en la sucursal activa (con su precio local, `precioDeCarta`, calculado igual que la carta) no coincide con el de TODAS las
 * opciones ya cargadas; el primer producto de un ítem sin opciones entra siempre. La categoría del producto no importa: la opción sale (y sus ventas se cuentan) en
 * la sección del ítem agrupado.
 *
 * Orden, igual que antes: 1. el ítem (`No se encontró el ítem agrupado.`); 2. que se haya elegido producto; 3. el producto (existe y es PV); 4. que no tenga descuento
 * en ninguna sucursal; 5. que no esté ya en un ítem (el mismo u otro); 6. el orden (`null` = la cantidad de opciones del ítem); 7. el precio contra las opciones
 * ya cargadas; 8. la escritura, con el `catch` de la carrera (otro pedido lo agrupó entre la verificación y el alta: `productoId` es único por sucursal).
 *
 * @contract Deja el producto como opción del ítem agrupado de la sucursal activa, en el orden pedido, si cumple todo lo anterior; nunca toca el producto ni su contenido de carta.
 * @idempotency Por estado — repetir el pedido encuentra al producto ya agrupado y se rechaza («ya está en…»).
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace quien llama (la Server Action o el alta con productos) cuando sale bien.
 * @ficha permiso=carta_items_agrupados transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarOpcionItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoAgregarOpcionItemAgrupadoCarta,
): Promise<ResultadoAgregarOpcionItemAgrupadoCarta> {
  const { db, sucursalId } = actor;
  const { itemAgrupadoCartaId, productoId, orden } = comando;
  const item = await db.itemAgrupadoCarta.findUnique({
    where: { id: itemAgrupadoCartaId, ...whereCartaDeSucursal(sucursalId) },
    select: {
      id: true,
      nombre: true,
      opciones: { select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } } },
    },
  });
  if (!item) return fracaso("ITEM_NO_ENCONTRADO", "No se encontró el ítem agrupado.");
  if (!productoId) return fracaso("FALTA_PRODUCTO", "Elegí el producto a agregar.");
  const producto = await db.producto.findUnique({
    where: { id: productoId },
    select: { id: true, nombre: true, tipo: true, precioVenta: true },
  });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
  if (await productoTieneDescuentoEnAlgunaSucursal(producto.id, db)) {
    return fracaso("CON_DESCUENTO", `«${producto.nombre}» tiene descuento en alguna sucursal: sacale el descuento para agruparlo (el renglón agrupado muestra un solo precio).`);
  }

  const yaAgrupado = await mensajeYaAgrupado(db, sucursalId, producto.id, producto.nombre, item.id);
  if (yaAgrupado) return fracaso("YA_AGRUPADO", yaAgrupado);

  const o = validarOrdenCarta(orden ?? item.opciones.length);
  if (!o.ok) return fracaso("ORDEN_INVALIDO", o.mensaje);

  // D5: mismo precio que las opciones ya cargadas, en la sucursal activa de quien administra (con su precio local, si lo hay).
  if (item.opciones.length > 0) {
    const idsAComparar = [producto.id, ...item.opciones.map((op) => op.producto.id)];
    const localPorProducto = await preciosLocalesVigentes(sucursalId, db, idsAComparar);
    const precioCandidato = precioDeCarta(Number(producto.precioVenta), localPorProducto.get(producto.id));
    const preciosGrupo = item.opciones.map((op) => precioDeCarta(Number(op.producto.precioVenta), localPorProducto.get(op.producto.id)));
    if (preciosGrupo.some((p) => p !== precioCandidato)) {
      const minimo = Math.min(...preciosGrupo);
      const maximo = Math.max(...preciosGrupo);
      const delGrupo = minimo === maximo ? pesos(minimo) : `${pesos(minimo)} a ${pesos(maximo)}`;
      return fracaso(
        "PRECIO_DISTINTO",
        `«${producto.nombre}» cuesta ${pesos(precioCandidato)} acá y «${item.nombre}» ya tiene opciones a ${delGrupo}: agrupá solo productos del mismo precio, o dejala aparte.`,
      );
    }
  }

  try {
    await crearOpcionDeItemAgrupado(db, { sucursalId, itemAgrupadoCartaId: item.id, productoId: producto.id, orden: o.valor });
  } catch (e) {
    // Carrera: otro admin lo agregó a un grupo entre la verificación y el alta (`productoId` es único).
    if (esErrorDeUnicidad(e)) return fracaso("YA_AGRUPADO", (await mensajeYaAgrupado(db, sucursalId, producto.id, producto.nombre, item.id)) ?? `«${producto.nombre}» ya está en un ítem agrupado.`);
    throw e;
  }
  return exito(`«${producto.nombre}» agregado a «${item.nombre}».`, null);
}
