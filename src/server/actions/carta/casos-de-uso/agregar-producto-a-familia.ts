import "server-only";
import { esRestriccionDeLaBase } from "@/core/datos/errores-de-base";
import type { ComandoAgregarProductoAFamilia, ResultadoAgregarProductoAFamilia } from "@/core/features/carta/familias.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import {
  bloquearFamilia,
  crearMiembro,
  leerFamiliaPorId,
  leerMiembroPorId,
  leerMiembroVigenteDeProducto,
  leerProductoParaFamilia,
  posicionesVigentes,
  productoEstaEnUnItemAgrupadoDeLaSucursal,
} from "@/server/persistencia/carta/familias";

/** La base acota la posición de un miembro de 1 a 1000 (CHECK): protección de la base, no una regla de negocio. */
const POSICION_MAXIMA = 1000;
const MENSAJE_FAMILIA_NO_ENCONTRADA = "No se encontró la familia: recargá la pantalla.";
const MENSAJE_YA_AGRUPADO = "El producto ya está en un ítem agrupado de la carta: sacalo de ahí primero para ponerlo en una familia.";

/** La posición que le toca al miembro nuevo: la máxima + 1; si ya se llegó al tope, el primer hueco libre (quitar no renumera). `null` si no queda ninguna. */
function posicionParaElNuevo(vigentes: readonly number[]): number | null {
  const siguiente = Math.max(0, ...vigentes) + 1;
  if (siguiente <= POSICION_MAXIMA) return siguiente;
  const usadas = new Set(vigentes);
  for (let p = 1; p <= POSICION_MAXIMA; p++) if (!usadas.has(p)) return p;
  return null;
}

/**
 * Caso de uso «agregar un producto a una familia» (CU-F3 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, etapa F1). Decisión del dueño (2026-11-17): «Solo los que se venden»: solo un producto de venta
 * (`PV`) es miembro. El producto no se toca (precio, receta y stock siguen siendo suyos); un producto está en UNA sola familia a la vez.
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. la familia es de la empresa y se toma (`FOR UPDATE`; si no, `FAMILIA_NO_ENCONTRADA`); 2. el producto es de la empresa y de venta (`PRODUCTO_NO_ENCONTRADO` para los tres casos:
 * no existe, es de otra empresa o no es PV); 3. si ya es miembro vigente de ESTA familia, éxito sin escribir ni auditar (`yaEstaba`); si lo es de OTRA, `PRODUCTO_EN_OTRA_FAMILIA` (mensaje genérico: no revela cuál);
 * 4. si el `id` de miembro ya existe y es otra cosa, `ID_REUTILIZADO`; 5. cruce con el ítem agrupado (invariante TRANSITORIO, §6.4): si está en un ítem agrupado de la carta de la sucursal activa, `PRODUCTO_YA_AGRUPADO`; 6. la posición (máximo + 1) con
 * la familia tomada; 7. se crea el miembro; 8. la auditoría (`miembro`, de nada a verdadero), con el mismo `tx`. La base repite el cruce con un disparador que mira TODAS las sucursales de la empresa (sin alcance): un ítem agrupado de otra sucursal, o
 * cualquier camino que se saltee el chequeo de arriba, se rechaza igual y acá se traduce a `PRODUCTO_YA_AGRUPADO`. Dos altas del mismo producto a familias distintas: gana una (único parcial por producto); la otra se repite y ve a la ganadora (`tambienChoqueDeUnico`).
 *
 * @contract Deja al producto como miembro vigente de la familia, con su posición y su fila de auditoría: todo o nada.
 * @idempotency Por estado — si el producto ya es miembro vigente de la familia no se escribe ni se audita; el único parcial de la base impide dos familias a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas; el choque del único (dos altas a la vez) se repite y ve la fila de la otra.
 * @sideEffects registrarCambioAuditado (`MiembroDeFamilia`, `miembro`, sin sucursal: es de la empresa), con el mismo `tx`. Nada lee las familias todavía: no hay carta pública que revalidar.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarProductoAFamiliaCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "sucursalId" | "ahora">,
  comando: ComandoAgregarProductoAFamilia,
): Promise<ResultadoAgregarProductoAFamilia> {
  try {
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoAgregarProductoAFamilia> => {
        if (!(await bloquearFamilia(tx, comando.familiaId))) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);
        const familia = await leerFamiliaPorId(tx, comando.familiaId);
        if (!familia) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);

        const producto = await leerProductoParaFamilia(tx, comando.productoId);
        if (!producto || producto.tipo !== "PV") return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

        const vigente = await leerMiembroVigenteDeProducto(tx, producto.id);
        if (vigente) {
          if (vigente.familiaId === familia.id) return exito(`«${producto.nombre}» ya estaba en la familia: no cambió nada.`, { yaEstaba: true, posicion: vigente.posicion });
          return fracaso("PRODUCTO_EN_OTRA_FAMILIA", `«${producto.nombre}» ya está en otra familia: quitalo de ahí primero.`);
        }
        if (await leerMiembroPorId(tx, comando.miembroId)) return fracaso("ID_REUTILIZADO", "El pedido no es válido: recargá la pantalla.");
        if (await productoEstaEnUnItemAgrupadoDeLaSucursal(tx, { sucursalId: actor.sucursalId, productoId: producto.id })) return fracaso("PRODUCTO_YA_AGRUPADO", MENSAJE_YA_AGRUPADO);

        const posicion = posicionParaElNuevo(await posicionesVigentes(tx, familia.id));
        if (posicion === null) return fracaso("DATO_INVALIDO", "La familia no admite más productos.");

        await crearMiembro(tx, { id: comando.miembroId, familiaId: familia.id, productoId: producto.id, posicion, actorId: actor.usuarioId, ahora: actor.ahora });
        await registrarCambioAuditado(tx, {
          entidad: "MiembroDeFamilia",
          entidadId: `${familia.id}:${producto.id}`,
          campo: "miembro",
          descripcion: `Familia de productos «${familia.nombre}»: se agregó «${producto.nombre}»`,
          valorAnterior: null,
          valorNuevo: true,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
        return exito(`«${producto.nombre}» agregado a la familia «${familia.nombre}».`, { yaEstaba: false, posicion });
      },
      undefined,
      undefined,
      true,
    );
  } catch (e) {
    // La red de la base (disparador del invariante transitorio): un camino que se salteó el chequeo de arriba (por ejemplo, un ítem agrupado de una sucursal que el alcance no deja ver) igual se rechaza.
    if (esRestriccionDeLaBase(e, "producto_ya_agrupado")) return fracaso("PRODUCTO_YA_AGRUPADO", MENSAJE_YA_AGRUPADO);
    throw e;
  }
}
