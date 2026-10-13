import "server-only";
import { rechazoDeReferenciaNoEncontrada } from "@/core/datos/errores-de-base";
import { MENSAJE_OPCION_NO_ENCONTRADA } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoAgregarVersionDeOpcion, ResultadoAgregarVersionDeOpcion } from "@/core/features/catalogo/opciones-de-venta.schema";
import { contenidoDeVersionIgual, validarConsumos, validarVersion } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { agregarVersionDeOpcion } from "@/server/persistencia/catalogo/opciones-de-venta";
import { cargarOpcionEnTx, columnasDeVersion, describirConsumos, insumosDeLosConsumos, versionVigenteEnTx } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «agregar una versión a una opción» (GO-2a; ADR-030 §2): lo que la opción cobra (diferencia y factor) y consume (sus consumos) SOLO se agrega. La versión nueva es la
 * vigente + 1 y rige desde que se carga (supuesto 1 del ADR); lo ya vendido conserva su foto.
 *
 * Dentro de UNA transacción SERIALIZABLE: relee la opción y su versión vigente. Si la vigente ya es la esperada + 1, la cargó la misma persona y tiene el MISMO contenido, es el
 * mismo pedido repetido (un doble clic que llegó después de que el primero confirmó): éxito sin agregar otra. Si la vigente no es la esperada, `VERSION_DESACTUALIZADA` (otra
 * persona agregó una en el medio). Si el contenido es igual al de la vigente, no se agrega una versión vacía. Después, las reglas del tipo (`validarVersion`, `validarConsumos`), los
 * insumos (materias primas de la empresa, en su unidad de stock) y el módulo Recetas para los consumos (D-3). Dos versiones simultáneas con el mismo número chocan con el único
 * `(opcionId, numero)`: gana una, la otra recibe 23505 o 40001, se reintenta y su relectura la rechaza.
 *
 * @contract Agrega la versión `numeroEsperado + 1` de la opción con su diferencia, su factor y sus consumos, o devuelve la que ya era esa.
 * @idempotency Optimista — el número esperado se compara con el de la vigente dentro de la transacción; el mismo pedido repetido (misma persona, mismo contenido) no duplica la versión.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: el único `(opcionId, numero)` arbitra dos versiones a la vez; el reintento da el resultado de negocio.
 * @sideEffects registrarCambioAuditado (la versión nueva contra la anterior: número, tipo de diferencia, diferencia, porcentaje y factor, con el resumen de los consumos), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarVersionDeOpcionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "db" | "transaccion" | "ahora">,
  comando: ComandoAgregarVersionDeOpcion
): Promise<ResultadoAgregarVersionDeOpcion> {
  if (comando.version.consumos.length > 0) {
    const sinRecetas = await denegacionDeModuloDeAccion("guardar_receta", actor.empresaId, actor.db);
    if (sinRecetas) return fracaso("MODULO_RECETAS_INACTIVO", "Los consumos de una opción usan el módulo Recetas, que tu empresa no tiene activo: guardala sin consumos.");
  }

  try {
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoAgregarVersionDeOpcion> => {
        const opcion = await cargarOpcionEnTx(tx, comando.opcionId);
        if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", MENSAJE_OPCION_NO_ENCONTRADA);
        const vigente = await versionVigenteEnTx(tx, opcion.id);
        const numeroVigente = vigente?.numero ?? 0;

        if (vigente && numeroVigente === comando.numeroEsperado + 1 && vigente.creadoPorId === actor.usuarioId && contenidoDeVersionIgual(vigente, comando.version)) {
          return exito(`Ese cambio de precio de «${opcion.nombre}» ya estaba cargado: no se agregó otro.`, { versionDeOpcionId: vigente.id, numero: numeroVigente, yaExistia: true });
        }
        if (numeroVigente !== comando.numeroEsperado) {
          return fracaso(
            "VERSION_DESACTUALIZADA",
            `El precio o el consumo de «${opcion.nombre}» cambió mientras lo editabas: otra persona cargó un cambio antes. Recargá la pantalla y volvé a hacer el cambio.`
          );
        }
        if (vigente && contenidoDeVersionIgual(vigente, comando.version)) {
          return exito(`«${opcion.nombre}» ya tiene esos valores: no se agregó otro cambio de precio.`, { versionDeOpcionId: vigente.id, numero: numeroVigente, yaExistia: true });
        }

        for (const regla of [validarVersion(opcion.grupo.tipo, opcion.esNinguna, comando.version), validarConsumos(opcion.grupo.tipo, opcion.esNinguna, comando.version.consumos)]) {
          if (!regla.ok) return fracaso("CONFIGURACION_INVALIDA", regla.mensaje);
        }
        const insumos = await insumosDeLosConsumos(tx, comando.version.consumos);
        if (!insumos.ok) return fracaso("REFERENCIA_NO_ENCONTRADA", insumos.mensaje);

        const numero = numeroVigente + 1;
        const creada = await agregarVersionDeOpcion(tx, {
          opcionId: opcion.id,
          numero,
          diferencia: comando.version.diferencia,
          factorEscala: comando.version.factorEscala,
          consumos: insumos.consumos,
          creadoPorId: actor.usuarioId,
          ahora: actor.ahora,
        });

        const antes = columnasDeVersion(vigente);
        const despues = columnasDeVersion(comando.version);
        const descripcion = `Opción «${opcion.nombre}» de «${opcion.grupo.nombre}»: versión ${numero} (${describirConsumos(insumos.consumos, insumos.nombres)}).`;
        const cambios = [
          { campo: "numero", valorAnterior: vigente?.numero ?? null, valorNuevo: numero },
          { campo: "tipoDeDiferencia", valorAnterior: antes.tipoDeDiferencia, valorNuevo: despues.tipoDeDiferencia },
          { campo: "diferenciaPrecio", valorAnterior: antes.diferenciaPrecio, valorNuevo: despues.diferenciaPrecio },
          { campo: "porcentaje", valorAnterior: antes.porcentaje, valorNuevo: despues.porcentaje },
          { campo: "factorEscala", valorAnterior: antes.factorEscala, valorNuevo: despues.factorEscala },
        ];
        for (const c of cambios) {
          await registrarCambioAuditado(tx, { entidad: "VersionDeOpcion", entidadId: creada.id, campo: c.campo, descripcion, valorAnterior: c.valorAnterior, valorNuevo: c.valorNuevo, actorId: actor.usuarioId, sucursalId: null });
        }
        return exito(`Listo: el cambio de precio o de consumo de «${opcion.nombre}» rige desde ahora.`, { versionDeOpcionId: creada.id, numero, yaExistia: false });
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    const rechazo = rechazoDeReferenciaNoEncontrada(e, { insumoProductoId: "el insumo elegido", reemplazaAProductoId: "el insumo reemplazado", unidadId: "la unidad" }, "No se encontró una de las referencias elegidas.");
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
