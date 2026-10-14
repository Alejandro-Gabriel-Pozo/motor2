import "server-only";
import type { ComandoGuardarRecetaDeCombinacion, ResultadoGuardarRecetaDeCombinacion } from "@/core/features/catalogo/combinaciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarRecetasVigentesDeCombinaciones, type RecetaDeCombinacionLeida } from "@/server/lecturas/catalogo/recetas-de-combinacion";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import { crearVersionDeRecetaDeCombinacion } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «la RECETA PROPIA de una combinación» (GO-3b, ADR-032, frente B, paso AB5: el flat white grande con doble shot, 36 g de café y 200 ml de leche, en vez de «lo del mediano × 1,5»).
 * De la EMPRESA (v1: sin receta por sucursal), con la clave `guardar_receta`. Solo se AGREGAN versiones (la vigente es la de número mayor); una versión SIN ingredientes es «sin excepción: vuelve a
 * la regla general» (así se quita una excepción sin borrar nada).
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. la combinación existe (otra empresa no se ve); un producto que se produce por lote no admite excepción (`PRODUCTO_SE_PRODUCE`: su venta descuenta su propio stock);
 *  2. la versión: la pantalla manda el número de la vigente que vio (0 = no tenía). La MISMA versión que ya guardó este mismo usuario con el número siguiente es un éxito idempotente (el doble clic);
 *     otro número es `VERSION_DESACTUALIZADA`. Si el contenido es el de la vigente, éxito sin escribir;
 *  3. cada ingrediente es una MATERIA PRIMA de la empresa (`RECETA_INVALIDA`); su unidad es la de stock de esa materia prima (la pone el servidor, como exige U7);
 *  4. el ENVASE de la medida del eje (un consumo que no escala con la medida y que REEMPLAZA un insumo) tiene que poder aplicarse sobre la receta propia: si el insumo que reemplaza no está en ella,
 *     se BLOQUEA (`RECETA_INVALIDA`: el vaso de 400 ml se perdería en silencio). Un REEMPLAZA de otra opción que no es eje (la leche de almendras) cuyo insumo no está en la receta propia es un AVISO:
 *     se guarda igual y el mensaje lo dice (ese cambio no se aplicará);
 *  5. la versión `número + 1` con sus ingredientes (el único `(combinacionId, numero)` arbitra dos guardados a la vez: gana uno, el reintento del otro relee y es `VERSION_DESACTUALIZADA` o, si era
 *     el mismo, éxito idempotente) y su auditoría (`RecetaDeCombinacionVersion`, `numero`, con el resumen en la descripción).
 * La venta congela la versión vigente al AGREGAR el ítem (`CombinacionEnLinea`) y el cierre consume esa (GO-3b F5): cambiarla no cambia lo que ya está en una mesa.
 *
 * @contract Agrega la versión pedida de la receta propia de la combinación, con su auditoría, si es válida y nadie guardó otra desde la vista; si no, no escribe nada.
 * @idempotency Optimista — el número esperado se compara dentro de la transacción; el mismo contenido repetido por el mismo usuario (con el número siguiente ya guardado por él) es éxito sin escribir.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`RecetaDeCombinacionVersion`, `numero`), con el mismo `tx`.
 * @ficha permiso=guardar_receta transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarRecetaDeCombinacionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoGuardarRecetaDeCombinacion,
): Promise<ResultadoGuardarRecetaDeCombinacion> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoGuardarRecetaDeCombinacion> => {
      const combinacion = await tx.combinacionDeProducto.findFirst({
        where: { id: comando.combinacionId },
        select: { id: true, opcionEje1Id: true, opcionEje2Id: true, producto: { select: { id: true, nombre: true, seProduce: true } }, opcionEje1: { select: { nombre: true } }, opcionEje2: { select: { nombre: true } } },
      });
      if (!combinacion) return fracaso("COMBINACION_NO_ENCONTRADA", "No se encontró esa combinación.");
      const nombre = `«${[combinacion.producto.nombre, combinacion.opcionEje1.nombre, combinacion.opcionEje2?.nombre].filter(Boolean).join(" · ")}»`;
      if (combinacion.producto.seProduce) return fracaso("PRODUCTO_SE_PRODUCE", `«${combinacion.producto.nombre}» se produce por lote: su venta descuenta su propio stock y no lleva receta por combinación.`);

      const vigente = (await cargarRecetasVigentesDeCombinaciones(tx, [combinacion.id])).get(combinacion.id) ?? null;
      if (vigente && vigente.numero === comando.numeroEsperado + 1 && vigente.creadoPorId === actor.usuarioId && mismoContenido(vigente, comando)) {
        return exito(`La receta propia de ${nombre} ya estaba guardada.`, { numero: vigente.numero, huboCambio: false, avisos: [] });
      }
      if ((vigente?.numero ?? 0) !== comando.numeroEsperado) {
        return fracaso("VERSION_DESACTUALIZADA", `Otra persona guardó la receta de ${nombre} mientras la editabas: recargá la pantalla y volvé a intentar.`);
      }
      if ((vigente === null && comando.ingredientes.length === 0) || (vigente !== null && mismoContenido(vigente, comando))) {
        return exito(`La receta propia de ${nombre} no tenía cambios.`, { numero: vigente?.numero ?? null, huboCambio: false, avisos: [] });
      }

      const insumoIds = comando.ingredientes.map((i) => i.insumoProductoId);
      const materias = new Map((await tx.producto.findMany({ where: { id: { in: insumoIds } }, select: { id: true, nombre: true, tipo: true, unidadStockId: true } })).map((p) => [p.id, p]));
      for (const i of comando.ingredientes) {
        const mp = materias.get(i.insumoProductoId);
        if (!mp || mp.tipo !== "MP") return fracaso("RECETA_INVALIDA", `Cada ingrediente tiene que ser una materia prima (MP)${mp ? ` (${mp.nombre} no lo es)` : ""}.`);
      }

      const avisos: string[] = [];
      if (comando.ingredientes.length > 0) {
        const enLaReceta = new Set(insumoIds);
        const ejes = new Set([combinacion.opcionEje1Id, combinacion.opcionEje2Id].filter((x): x is string => x !== null));
        const grupos = (await cargarOpcionesParaVender(tx, { sucursalId: actor.sucursalId, productoIds: [combinacion.producto.id] })).get(combinacion.producto.id)?.grupos ?? [];
        const nombreDe = async (id: string) => materias.get(id)?.nombre ?? (await tx.producto.findFirst({ where: { id }, select: { nombre: true } }))?.nombre ?? id;
        for (const g of grupos) {
          if (g.tipo === "ADICIONAL") continue;
          const esGrupoDeEje = g.opciones.some((o) => ejes.has(o.opcionId));
          for (const o of g.opciones) {
            for (const c of o.consumos) {
              if (c.efecto !== "REEMPLAZA" || c.reemplazaAProductoId === null || enLaReceta.has(c.reemplazaAProductoId)) continue;
              if (ejes.has(o.opcionId) && g.tipo === "MEDIDA" && !c.escalaConLaMedida) {
                return fracaso(
                  "RECETA_INVALIDA",
                  `El envase de «${o.nombre}» reemplaza «${await nombreDe(c.reemplazaAProductoId)}», que la receta propia de ${nombre} no tiene: agregalo a la receta o sacá ese reemplazo del tamaño.`,
                );
              }
              if (!esGrupoDeEje) avisos.push(`«${o.nombre}» cambia «${await nombreDe(c.reemplazaAProductoId)}», que esta receta no tiene: con ${nombre} ese cambio no se aplica.`);
            }
          }
        }
      }

      const numero = comando.numeroEsperado + 1;
      const ingredientes = comando.ingredientes.map((i) => ({ ...i, unidadId: materias.get(i.insumoProductoId)!.unidadStockId }));
      const { id } = await crearVersionDeRecetaDeCombinacion(tx, { combinacionId: combinacion.id, numero, creadoPorId: actor.usuarioId, ahora: actor.ahora, ingredientes });
      const resumen = ingredientes.length === 0 ? "sin excepción (vuelve a la regla general)" : ingredientes.map((i) => `${materias.get(i.insumoProductoId)!.nombre} ${i.cantidad}`).join(", ");
      await registrarCambioAuditado(tx, {
        entidad: "RecetaDeCombinacionVersion",
        entidadId: id,
        campo: "numero",
        descripcion: `Receta propia de la combinación ${nombre}, versión ${numero}: ${resumen}`,
        valorAnterior: vigente?.numero ?? null,
        valorNuevo: numero,
        actorId: actor.usuarioId,
      });
      const base = ingredientes.length === 0 ? `${nombre} vuelve a la receta general.` : `Receta propia de ${nombre} guardada (versión ${numero}).`;
      return exito(avisos.length ? `${base} Ojo: ${avisos.join(" ")}` : base, { numero, huboCambio: true, avisos });
    },
    undefined,
    undefined,
    true,
  );
}

/** ¿La versión tiene exactamente estos ingredientes, en este orden? */
function mismoContenido(vigente: RecetaDeCombinacionLeida, comando: ComandoGuardarRecetaDeCombinacion): boolean {
  return (
    vigente.ingredientes.length === comando.ingredientes.length &&
    vigente.ingredientes.every((v, k) => {
      const c = comando.ingredientes[k]!;
      return v.insumoProductoId === c.insumoProductoId && v.cantidad === c.cantidad && v.mermaPorcentaje === c.mermaPorcentaje;
    })
  );
}
