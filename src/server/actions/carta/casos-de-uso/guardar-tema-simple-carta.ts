import "server-only";
import type { ComandoGuardarTemaSimpleCarta, ResultadoGuardarTemaSimpleCarta } from "@/core/features/carta/tema.schema";
import { mezclarTemaSimple, mismoContenido } from "@/core/carta/public";
import { LARGO_MAXIMO_DEL_RUBRO_SIMPLE, MENSAJE_RUBRO_DEMASIADO_LARGO } from "@/core/carta/tema-simple";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { cambiarValoresDelTema, crearTemaDeLaSucursal, leerTemaParaMezclar } from "@/server/persistencia/carta/tema";

/**
 * Caso de uso «guardar la pantalla simple del tema de la carta» (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`, §5 I1 y §6). A diferencia de `guardar-tema-carta.ts` (que
 * reemplaza TODO lo guardado por el formulario completo), este MEZCLA: lee lo guardado, cambia SOLO las siete claves de la pantalla simple (más el marcador `marca_derivada`, ver `mezclarTemaSimple`) y conserva todas las demás y
 * `aplicarEnCarta`: lo ya cargado por la empresa sigue mandando.
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. la sucursal es la activa y existe (si no, `SUCURSAL_NO_ENCONTRADA`; la RLS no deja ver otra empresa);
 *  2. se calcula la mezcla; si ya es lo guardado (o no hay tema ni nada que guardar), éxito sin escribir ni versionar (el segundo clic de un doble clic, o el reintento de un pedido que ya se aplicó, aunque la versión ya cambió);
 *  3. la versión que vio la pantalla tiene que ser la vigente (`actualizadoEn` del tema, o `sin-tema` si no había): si otra persona cambió el tema mientras se editaba, `VERSION_DESACTUALIZADA` y no se escribe nada;
 *  4. se escribe: se crea el tema (aplicado) o se cambian sus valores (sin tocar `aplicarEnCarta`).
 * Sin auditoría, igual que el guardado de siempre (el tema visual no es plata): la fila misma, con su `actualizadoEn`, es el registro.
 *
 * @contract Deja el tema de la sucursal activa con las siete claves de la pantalla simple como vienen y todo lo demás como estaba; o no cambia nada.
 * @idempotency Por estado — si la mezcla ya es lo guardado, éxito sin escribir; la versión vista arbitra dos pedidos distintos a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE): la lectura que decide y la escritura, juntas; dos guardados a la vez con la misma versión se serializan y solo gana uno.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_tema transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarTemaSimpleCartaCasoDeUso(actor: Pick<ContextoDeAccion, "db" | "transaccion">, comando: ComandoGuardarTemaSimpleCarta): Promise<ResultadoGuardarTemaSimpleCarta> {
  const { sucursalId, valores, versionEsperada } = comando;
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoGuardarTemaSimpleCarta> => {
      const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true, nombre: true } });
      if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");

      const fila = await leerTemaParaMezclar(tx, { sucursalId });
      // Rubro ≤ 40 como Pedernal, SOLO si cambia: un rubro ya guardado más largo (el catálogo admite 120) no bloquea el guardado mientras no se toque.
      const rubroPedido = valores.hero_etiqueta_superior ?? "";
      const rubroGuardado = (fila?.valores as Record<string, unknown> | null | undefined)?.hero_etiqueta_superior;
      if (rubroPedido.length > LARGO_MAXIMO_DEL_RUBRO_SIMPLE && rubroPedido !== rubroGuardado) return fracaso("RUBRO_DEMASIADO_LARGO", MENSAJE_RUBRO_DEMASIADO_LARGO);

      const mezcla = mezclarTemaSimple(fila?.valores, valores);
      const nada = fila ? mismoContenido(fila.valores, mezcla) : Object.keys(mezcla).length === 0;
      if (nada) return exito(`El tema de "${sucursal.nombre}" ya estaba así: no cambió nada.`, { cambiado: false });

      const versionVigente = fila ? fila.actualizadoEn.toISOString() : "sin-tema";
      if (versionVigente !== versionEsperada) return fracaso("VERSION_DESACTUALIZADA", "Otra persona cambió esto mientras lo editabas: no se guardó nada. Recargá la pantalla y volvé a hacer tus cambios.");

      if (fila) await cambiarValoresDelTema(tx, { empresaId: sucursal.empresaId, sucursalId, valores: mezcla });
      else await crearTemaDeLaSucursal(tx, { empresaId: sucursal.empresaId, sucursalId, valores: mezcla });
      return exito(`Tema de "${sucursal.nombre}" guardado. Está aplicado: la carta toma los cambios en hasta 5 minutos.`, { cambiado: true });
    },
    undefined,
    {},
    true,
  );
}
