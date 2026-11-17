import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { precioDeCarta, whereCartaDeSucursal } from "@/core/carta/public";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { esRestriccionDeLaBase } from "@/core/datos/errores-de-base";
import type { ComandoAgregarOpcionItemAgrupadoCarta, ResultadoAgregarOpcionItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { esBaseConfigurable } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { descuentosConfiguradosEnSucursal } from "@/server/lecturas/carta/descuentos";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { leerMiembroVigenteDeProducto } from "@/server/persistencia/carta/familias";
import { crearOpcionDeItemAgrupado } from "@/server/persistencia/carta/items-agrupados";
import { formatearMonto } from "@/core/formato-de-numero";

const pesos = formatearMonto;

/** F1 (invariante TRANSITORIO «familia o ítem agrupado», docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md §6.4): el producto es miembro vigente de una familia, así que no puede ir en un ítem agrupado. Mensaje genérico: no revela cuál. */
const mensajeYaEnFamilia = (productoNombre: string) => `«${productoNombre}» ya está en una familia: quitalo de ahí primero para agruparlo en un ítem.`;

/** El mensaje cuando el producto ya está en un ítem agrupado (el mismo u otro) de la sucursal: un producto va en a lo sumo uno (D2). `null` si no está en ninguno. */
async function mensajeYaAgrupado(db: ContextoUsuario["db"] | Prisma.TransactionClient, sucursalId: string, productoId: string, productoNombre: string, itemAgrupadoCartaId: string): Promise<string | null> {
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
 * (`conPermiso("carta_items_agrupados")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: lee el ítem antes de mirar el producto y valida el orden después de
 * varias lecturas. Los ítems agrupados y sus opciones son PROPIOS de cada sucursal (ADR-009, C3): las lecturas miran solo la sucursal activa.
 *
 * Bloquea (D5) si el precio del producto en la sucursal activa (con su precio local, `precioDeCarta`, calculado igual que la carta) no coincide con el de TODAS las
 * opciones ya cargadas; el primer producto de un ítem sin opciones entra siempre. La categoría del producto no importa: la opción sale (y sus ventas se cuentan) en
 * la sección del ítem agrupado.
 *
 * F1 (cruce con las familias, invariante TRANSITORIO): justo después del 5, si el producto es miembro vigente de una familia, `YA_EN_FAMILIA` y no se escribe nada; la base lo repite con un disparador (si se lo saltea algún camino, el alta
 * rechaza igual y acá se traduce al mismo resultado).
 *
 * Orden, igual que antes: 1. el ítem (`No se encontró el ítem agrupado.`); 2. que se haya elegido producto; 3. el producto (existe y es PV); 4. que no tenga descuento
 * en esta sucursal (P2.1: antes, en ninguna) y que no se venda por opción (Fase 4, `ES_BASE_CONFIGURABLE`, justo después del 3); 5. que no esté ya en un ítem (el mismo u otro); 6. el orden (`null` = la cantidad de opciones del ítem); 7. el precio contra las opciones
 * ya cargadas; 8. la escritura, con el `catch` de la carrera (otro pedido lo agrupó entre la verificación y el alta: `productoId` es único por sucursal).
 *
 * @contract Deja el producto como opción del ítem agrupado de la sucursal activa, en el orden pedido, si cumple todo lo anterior; nunca toca el producto ni su contenido de carta.
 * @idempotency Por estado — repetir el pedido encuentra al producto ya agrupado y se rechaza («ya está en…»).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): las lecturas que deciden y la escritura, juntas. F1: el invariante «familia o ítem agrupado» se decide contra el miembro de familia que se ve en la
 * misma foto de la transacción; con las dos altas en SERIALIZABLE, la base cancela una (40001), se repite y la repetición responde `YA_EN_FAMILIA` o `YA_AGRUPADO`. Si este alta corriera en READ COMMITTED, la foto de una
 * alta de familia en SERIALIZABLE (que ya leyó) no vería esta opción recién confirmada y las dos pasarían: por eso NO se baja el nivel. Una falla de la escritura (único, disparador) aborta la transacción: se traduce AFUERA,
 * con una lectura nueva.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace quien llama (la Server Action o el alta con productos) cuando sale bien.
 * @ficha permiso=carta_items_agrupados transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarOpcionItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "sucursalId">,
  comando: ComandoAgregarOpcionItemAgrupadoCarta,
): Promise<ResultadoAgregarOpcionItemAgrupadoCarta> {
  try {
    return await conTransaccionSerializable(actor.transaccion, (tx) => agregarOpcionEnTransaccion(tx, actor.sucursalId, comando));
  } catch (e) {
    // La escritura falló y la transacción ya no sirve: se responde con una lectura nueva (`actor.db`), no con la foto abortada.
    const { sucursalId } = actor;
    if (esErrorDeUnicidad(e) || esRestriccionDeLaBase(e, "producto_ya_miembro_de_familia")) {
      const producto = comando.productoId ? await actor.db.producto.findUnique({ where: { id: comando.productoId }, select: { id: true, nombre: true } }) : null;
      if (producto) {
        // Carrera: otro admin lo agregó a un grupo entre la verificación y el alta (`productoId` es único).
        if (esErrorDeUnicidad(e)) return fracaso("YA_AGRUPADO", (await mensajeYaAgrupado(actor.db, sucursalId, producto.id, producto.nombre, comando.itemAgrupadoCartaId)) ?? `«${producto.nombre}» ya está en un ítem agrupado.`);
        return fracaso("YA_EN_FAMILIA", mensajeYaEnFamilia(producto.nombre));
      }
    }
    throw e;
  }
}

async function agregarOpcionEnTransaccion(db: Prisma.TransactionClient, sucursalId: string, comando: ComandoAgregarOpcionItemAgrupadoCarta): Promise<ResultadoAgregarOpcionItemAgrupadoCarta> {
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
    select: { id: true, nombre: true, tipo: true, precioVenta: true, modoDeVenta: true },
  });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
  // Fase 4 (ADR-035): el renglón agrupado muestra el precio guardado de cada producto; el de una base no se cobra (su precio final está en cada opción).
  if (esBaseConfigurable(producto.modoDeVenta)) {
    return fracaso("ES_BASE_CONFIGURABLE", `«${producto.nombre}» se vende por opción (el precio final está en cada opción): no va en un ítem agrupado, que muestra un solo precio por producto.`);
  }
  // P2.1: solo el descuento de ESTA sucursal (la de la carta del ítem), igual que `guardar-descuento-producto.ts`, que rechaza el descuento de una opción agrupada mirando solo esta sucursal. El descuento de otra sucursal no cambia el renglón de esta carta.
  if ((await descuentosConfiguradosEnSucursal(sucursalId, db, [producto.id])).size > 0) {
    return fracaso("CON_DESCUENTO", `«${producto.nombre}» tiene descuento en esta sucursal: sacale el descuento para agruparlo (el renglón agrupado muestra un solo precio).`);
  }

  const yaAgrupado = await mensajeYaAgrupado(db, sucursalId, producto.id, producto.nombre, item.id);
  if (yaAgrupado) return fracaso("YA_AGRUPADO", yaAgrupado);
  if (await leerMiembroVigenteDeProducto(db, producto.id)) return fracaso("YA_EN_FAMILIA", mensajeYaEnFamilia(producto.nombre));

  // S-52: el orden lo decidió `guardComandoAgregarOpcionItemAgrupadoCarta` (la acción lo calculó con lo que mandó el cliente); su rechazo se aplica ACÁ, después de las lecturas anteriores.
  // `null` = al final: la cantidad de opciones que ya tiene el ítem (siempre válida).
  if (!orden.ok) return fracaso("ORDEN_INVALIDO", orden.mensaje);
  const o = { valor: orden.valor.orden ?? item.opciones.length };

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

  // Si la escritura falla (único, disparador) el error sale de la transacción y lo traduce quien llama (arriba).
  await crearOpcionDeItemAgrupado(db, { sucursalId, itemAgrupadoCartaId: item.id, productoId: producto.id, orden: o.valor });
  return exito(`«${producto.nombre}» agregado a «${item.nombre}».`, null);
}
