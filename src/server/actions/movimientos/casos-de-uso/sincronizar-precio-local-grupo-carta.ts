import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoSincronizarPrecioLocalGrupoCarta, ResultadoSincronizarPrecioLocalGrupoCarta } from "@/core/features/catalogo/precio-local.schema";
import { precioDeCarta } from "@/core/carta/public";
import { mismosCentavos } from "@/core/datos/importe";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { leerPrecioLocal } from "@/server/persistencia/movimientos/precio-local";
import { guardarPrecioLocalEnTx } from "./guardar-precio-local-en-tx";

/**
 * Caso de uso «aplicar el mismo precio local a los productos de UN ítem agrupado de la carta» (Hito 4 de la pureza, bloque 4.2, paso H4C-4 —
 * `docs/plan-hito-4-pureza.md` §3; el paso que ofrece `setPrecioLocalProducto` con `sincronizable`, docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). La
 * Server Action es el adaptador (`conPermiso("precio_local")` → `guardComandoSincronizarPrecioLocalGrupoCarta` → este caso de uso → `revalidarCartasPublicas` si
 * salió bien → `aResultadoAccion`).
 *
 * Desde la ola «precio y carta» (Fase 2, paso A3), con control del VALOR VISTO y todo dentro de UNA transacción SERIALIZABLE (antes el ítem y los productos se
 * leían fuera, en READ COMMITTED, y se escribía sin comparar):
 *  1. todos los productos son opciones del mismo ítem agrupado en la sucursal activa (si no, `NO_SON_DEL_MISMO_ITEM`);
 *  2. de cada producto, la fila de su precio local (`leerPrecioLocal`) y el precio que la carta muestra hoy en la sucursal (`preciosLocalesVigentes` +
 *     `precioDeCarta`: la misma lectura con la que `resolverGrupoDeProducto` armó lo que se ofreció igualar);
 *  3. los que ya están como se pide (mismo precio al centavo y mismo `habilitado`) no se tocan; para los demás, el precio que mostró la pantalla
 *     (`preciosVistos`) tiene que ser el de hoy: si alguno cambió (o la pantalla no lo mandó), `PRECIO_DESACTUALIZADO` y NO se cambia ninguno;
 *  4. producto por producto en orden de nombre, el paso compartido `guardarPrecioLocalEnTx` (mismo upsert y misma auditoría que fijarlo a mano en cada uno).
 * Repetir el mismo «Aplicar también» es un solo cambio: la segunda vez ya están todos como se pide (éxito, mismo mensaje, sin escribir).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard: la sucursal de la pantalla, el precio, la lista y los
 * precios vistos).
 *
 * @contract Deja el mismo precio local en todos los productos del ítem agrupado (en la sucursal activa), con su auditoría: o quedan todos, o ninguno; si el precio de alguno cambió desde que se ofreció igualarlo, ninguno.
 * @idempotency Optimista — el precio visto de cada producto se compara dentro de la transacción; repetir el mismo pedido no escribe ni audita, y con un precio visto viejo da `PRECIO_DESACTUALIZADO`.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, las escrituras y la auditoría, juntas; dos primeras altas del mismo precio local chocan con el único `(sucursalId, productoId)` y el reintento decide de nuevo.
 * @sideEffects registrarCambioAuditado (PrecioLocalProducto.precio y .habilitado de cada producto), en la misma transacción, por el paso compartido. La revalidación
 *   de la carta pública la hace la Server Action.
 * @ficha permiso=precio_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function sincronizarPrecioLocalGrupoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoSincronizarPrecioLocalGrupoCarta,
): Promise<ResultadoSincronizarPrecioLocalGrupoCarta> {
  const { productoIds: ids, precio, habilitado, preciosVistos } = comando;
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoSincronizarPrecioLocalGrupoCarta> => {
      const grupo = await resolverGrupoDeProducto(ids[0], actor.sucursalId, tx);
      const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
      if (!grupo || ids.some((id) => !delGrupo.has(id))) return fracaso("NO_SON_DEL_MISMO_ITEM", "Esos productos no están todos en el mismo ítem agrupado de la carta.");

      const [productos, locales] = await Promise.all([
        tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, precioVenta: true }, orderBy: { nombre: "asc" } }),
        preciosLocalesVigentes(actor.sucursalId, tx, ids),
      ]);
      const aEscribir: { id: string; nombre: string }[] = [];
      for (const p of productos) {
        const fila = await leerPrecioLocal(tx, { sucursalId: actor.sucursalId, productoId: p.id });
        if (fila && mismosCentavos(fila.precio, precio) && fila.habilitado === habilitado) continue;
        const hoy = precioDeCarta(Number(p.precioVenta), locales.get(p.id));
        const visto = Object.prototype.hasOwnProperty.call(preciosVistos, p.id) ? preciosVistos[p.id] : undefined;
        if (visto === undefined || !mismosCentavos(hoy, visto)) {
          return fracaso(
            "PRECIO_DESACTUALIZADO",
            `El precio de «${p.nombre}» en «${actor.sucursalNombre}» cambió desde que se ofreció igualarlo (ahora es $${hoy.toLocaleString("es-AR")}): no se cambió ninguno. Recargá la pantalla y volvé a hacer el cambio.`,
          );
        }
        aEscribir.push({ id: p.id, nombre: p.nombre });
      }
      for (const p of aEscribir) await guardarPrecioLocalEnTx(tx, actor, p, precio, habilitado);
      return exito(`Precio local de ${productos.map((p) => `"${p.nombre}"`).join(", ")} fijado en ${precio} en "${actor.sucursalNombre}" («${grupo.nombreItem}»).`, null);
    },
    undefined,
    undefined,
    true,
  );
}
