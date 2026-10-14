import "server-only";
import type { ComandoAgregarEntradaDeCupo, ResultadoAgregarEntradaDeCupo } from "@/core/features/carta/combos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarLugaresActivosDePromo, sucursalesDeLaEmpresa } from "@/server/lecturas/carta/componentes-de-promo";
import { crearEntradaDeCupo, fijarActivaDeEntradaDeCupo } from "@/server/persistencia/carta/combos";
import { nombreDeLaEntrada, revisarAlicuotasEnTx, validarComponenteEnTx } from "./componentes-de-combo-en-tx";

/**
 * Caso de uso «que este producto sea una opción del lugar LISTA de una promo» (GO-3b, ADR-032, pasos D4a y D4b). Una entrada es un producto de venta —aunque no esté en la carta— con una
 * CONFIGURACIÓN FIJA opcional de sus opciones de venta («Café · Mediano · Con leche»: el mozo no elige opciones dentro de un combo, D-6). La identidad de la entrada es (lugar, producto,
 * configuración): la misma con otra configuración es otra entrada.
 *
 * Dentro de UNA transacción SERIALIZABLE, en este orden y sin escribir nada hasta el final:
 *  1. el lugar: existe (la RLS oculta el de otra empresa: «no encontrado», sin oráculo), es un LISTA y está activo;
 *  2. el producto como componente (`validarComponenteEnTx`): PV, no ancla, la configuración válida para lo que admite (lo mismo que la venta: `armarLineaConfigurada`; sin adicionales), precio de
 *     referencia de $ 0,01 o más (D-8: el de la empresa, o la lista compuesta con la configuración) y origen de stock (D-9: receta vigente con ingredientes en la sucursal ACTIVA de quien la carga,
 *     o stock propio). La venta vuelve a mirar todo en la sucursal que vende;
 *  3. las alícuotas (D-2): el producto contra todos los componentes posibles del combo (secciones, listas y platos del día de hoy en adelante);
 *  4. «llevar al estado activa»: si la entrada ya existe y está activa, no se escribe ni se audita; si existe dada de baja, se reactiva; si no existe, se crea al final de la lista.
 * Cada escritura con su fila de auditoría (`EntradaDeCupo`, `activa`, del antes al después) en la misma transacción.
 *
 * Lee con la verificación de toda la empresa (`lecturaDeVerificacionEnLaEmpresa`): las alícuotas de los productos de la carta de CUALQUIER sucursal cuentan. Escribe lo de la empresa (sin sucursal).
 *
 * @contract Deja la entrada (lugar, producto, configuración) activa, con su auditoría, si el producto puede ser componente del combo; si no, no escribe nada.
 * @idempotency Por estado — si la entrada ya está activa no se escribe ni se audita; dos altas a la vez de la misma entrada dejan UNA fila (el único `(cupoId, productoId, claveConfiguracion)` y el reintento).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`EntradaDeCupo`, `activa`), con el mismo `tx`.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarEntradaDeCupoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "sucursalId" | "empresaZonaHoraria" | "transaccion" | "db" | "alcance" | "ahora">,
  comando: ComandoAgregarEntradaDeCupo,
): Promise<ResultadoAgregarEntradaDeCupo> {
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  return conTransaccionSerializable(
    verificacion.transaccion,
    async (tx): Promise<ResultadoAgregarEntradaDeCupo> => {
      const cupo = await tx.promoCartaCupo.findFirst({ where: { id: comando.cupoId }, select: { id: true, tipo: true, activo: true, nombre: true, promoCartaId: true, promoCarta: { select: { titulo: true } } } });
      if (!cupo) return fracaso("CUPO_NO_ENCONTRADO", "No se encontró ese lugar de la promo.");
      if (cupo.tipo !== "LISTA") return fracaso("CUPO_INVALIDO", "Ese lugar de la promo no es una lista propia: sus opciones salen de una sección de la carta o del plato del día.");
      if (!cupo.activo) return fracaso("CUPO_INVALIDO", `«${cupo.nombre ?? ""}» está dado de baja en la promo: volvé a agregarlo en sus cupos.`);

      const validado = await validarComponenteEnTx(tx, { sucursalId: actor.sucursalId, productoId: comando.productoId, opciones: comando.opciones, etiqueta: "con esa configuración" });
      if (!validado.ok) return validado;
      const { producto, claveConfiguracion } = validado.componente;
      const alicuotas = await revisarAlicuotasEnTx(tx, {
        lugares: await cargarLugaresActivosDePromo(tx, cupo.promoCartaId),
        desdeDia: diaDeCalendario(actor.ahora, actor.empresaZonaHoraria),
        sucursalIds: await sucursalesDeLaEmpresa(tx, actor.empresaId),
        producto,
      });
      if (!alicuotas.ok) return alicuotas;

      const nombre = await nombreDeLaEntrada(tx, producto.nombre, comando.opciones.map((o) => o.opcionId));
      const descripcion = `Promo "${cupo.promoCarta.titulo}", lugar «${cupo.nombre ?? ""}»: ${nombre}`;
      const existente = await tx.entradaDeCupo.findUnique({ where: { cupoId_productoId_claveConfiguracion: { cupoId: cupo.id, productoId: producto.id, claveConfiguracion } }, select: { id: true, activa: true } });
      if (existente?.activa) return exito(`${nombre} ya era una opción de «${cupo.nombre ?? ""}».`, { entradaId: existente.id, huboCambio: false });

      let entradaId: string;
      if (existente) {
        await fijarActivaDeEntradaDeCupo(tx, { id: existente.id, activa: true, ahora: actor.ahora });
        entradaId = existente.id;
      } else {
        const ultima = await tx.entradaDeCupo.aggregate({ where: { cupoId: cupo.id }, _max: { orden: true } });
        entradaId = (await crearEntradaDeCupo(tx, { cupoId: cupo.id, productoId: producto.id, claveConfiguracion, orden: (ultima._max.orden ?? -1) + 1, opciones: comando.opciones, ahora: actor.ahora })).id;
      }
      await registrarCambioAuditado(tx, {
        entidad: "EntradaDeCupo",
        entidadId: entradaId,
        campo: "activa",
        descripcion,
        valorAnterior: existente ? false : null,
        valorNuevo: true,
        actorId: actor.usuarioId,
      });
      return exito(`${nombre} quedó como opción de «${cupo.nombre ?? ""}».`, { entradaId, huboCambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
