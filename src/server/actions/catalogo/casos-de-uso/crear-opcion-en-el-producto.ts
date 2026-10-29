import "server-only";
import { mismosCentavos } from "@/core/datos/importe";
import { rechazoDeReferenciaNoEncontrada } from "@/core/datos/errores-de-base";
import type { ComandoCrearOpcionEnElProducto, ResultadoCrearOpcionEnElProducto } from "@/core/features/catalogo/opciones-de-venta.schema";
import { exito, fracaso, type Fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";
import { crearOpcionDeGrupoEnTx } from "./crear-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnTx } from "./fijar-admision-de-grupo-en-producto";
import { cargarGrupoEnTx } from "./opciones-de-venta-en-tx";

/** Paso entre el orden de una opción y el de la siguiente dentro del grupo: el de «Opciones de venta» y el del alta compuesta del grupo, con lugar para una en el medio. */
const PASO_DE_ORDEN = 10;

type FracasoDelComando = Fracaso<Extract<ResultadoCrearOpcionEnElProducto, { ok: false }>["codigo"]>;

/**
 * Un rechazo de las reglas de negocio, LANZADO: dentro de `conTransaccionSerializable` devolver un `fracaso` NO deshace lo ya escrito (la opción y su respaldo quedarían confirmados aunque la admisión se
 * rechace). Todo rechazo posterior a la primera escritura se lanza y se captura afuera, ya con la transacción deshecha (el mismo recurso que `crear-grupo-en-el-producto.ts`).
 */
class PasoRechazado extends Error {
  constructor(readonly resultado: FracasoDelComando) {
    super(resultado.mensaje);
    this.name = "PasoRechazado";
  }
}

/** Un rechazo de un paso compartido (el alta de la opción o la admisión) como rechazo de este comando; los códigos que no declara salen como `CONFIGURACION_INVALIDA`, con su mensaje. */
function rechazoDe(paso: { codigo: string; mensaje: string }): PasoRechazado {
  const conocidos = [
    "PRODUCTO_NO_ENCONTRADO",
    "PRODUCTO_NO_ELEGIBLE",
    "GRUPO_NO_ENCONTRADO",
    "GRUPO_INACTIVO",
    "NOMBRE_REPETIDO",
    "NOMBRE_DE_ANCLA_REPETIDO",
    "VERSION_DESACTUALIZADA",
    "CONFIGURACION_INVALIDA",
    "REFERENCIA_NO_ENCONTRADA",
    "OPCION_INACTIVA",
  ] as const;
  const codigo = conocidos.find((c) => c === paso.codigo);
  return new PasoRechazado(codigo ? fracaso(codigo, paso.mensaje) : fracaso("CONFIGURACION_INVALIDA", paso.mensaje));
}

const aNumero = (d: unknown): number | null => (d === null || d === undefined ? null : Number(d));

/**
 * Caso de uso «agregar una opción a un grupo que el producto ya usa» (`+ Opción` y `+ Extra`; ADR-030, «El comando compuesto»), TODO O NADA: la opción en el grupo de la biblioteca (con su versión 1 y, en un
 * adicional, su producto de respaldo) y lo que ESTE producto admite de ella, en UNA transacción SERIALIZABLE. Es lo que hoy son dos pantallas (crear la opción en «Opciones de venta», admitirla en el producto) sin
 * salir del producto. Sin clave nueva ni migración: pide las dos claves de siempre (`producto_opciones_admitidas` y `opciones_definir`), ya resueltas por la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Pasos, dentro de la transacción y con lo leído ahí: 1. la fila del producto PRIMERO (`FOR UPDATE`) y que sea de venta y no el respaldo de un adicional;
 * 2. el grupo existe y está activo; 3. el producto lo usa (una fila ACTIVA de lo que admite: no se agrega una opción a un grupo que no usa: para eso está «Agregar un grupo»); 4. qué lleva la opción según el TIPO del grupo,
 * que se lee acá y no viene del cliente: INCLUIDA, nada; VARIANTE, MEDIDA en DIFERENCIA y ADICIONAL, lo que suma (en la versión de la opción); MEDIDA en ABSOLUTO, su precio final (en lo que admite el producto, y la versión
 * en 0); el respaldo, solo y siempre en un adicional; 5. la opción (`crearOpcionDeGrupoEnTx`, al final del orden del grupo, con todas sus reglas); 6. lo que el producto admite de ella (`fijarAdmisionDeGrupoEnTx`: la
 * fila del grupo queda como estaba, con la versión que vio la pantalla, y las demás opciones del grupo no se tocan; las reglas puras de la admisión, la regla de la base y el control del precio de lista).
 * Una opción de un grupo de la biblioteca NO cambia lo que admiten los OTROS productos que lo usan: solo este admite la nueva.
 *
 * @contract Deja la opción en el grupo y lo que el producto admite de ella (o igual, si ya estaba así) y devuelve sus ids; ante cualquier rechazo no queda ni una fila.
 * @idempotency Por estado — sin migración: el nombre de la opción en el grupo (único sin distinguir mayúsculas) arbitra, y la fila de lo que el producto admite de ella; repetir el pedido las encuentra tal como se piden y no escribe ni audita de nuevo. Una opción con ese nombre pero distinta, o ya admitida con otro importe, se rechaza (`NOMBRE_REPETIDO`): nunca se pisa.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: la opción, su respaldo y la admisión en una sola transacción; el choque de un único es la carrera perdida y el reintento da el resultado de negocio. Todo rechazo lanza para deshacerla.
 * @sideEffects registrarCambioAuditado (el alta de la opción con su versión 1, la del producto de respaldo si es un extra, y lo que admite el producto, por columna), todo con el mismo `tx`; ninguno fuera de la base, así que el reintento es seguro.
 * @ficha permiso=opciones_definir+producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearOpcionEnElProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoCrearOpcionEnElProducto,
  azar: FuenteDeAzar
): Promise<ResultadoCrearOpcionEnElProducto> {
  try {
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoCrearOpcionEnElProducto> => {
        // 1. La fila del producto, antes de leer nada.
        await tomarFilaDeProducto(tx, comando.productoId);
        const producto = await tx.producto.findFirst({ where: { id: comando.productoId }, select: { id: true, nombre: true, tipo: true } });
        if (!producto) throw new PasoRechazado(fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto."));
        if (producto.tipo !== "PV") throw new PasoRechazado(fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» no es un producto de venta: solo un producto de venta admite opciones.`));
        if (await tx.opcionDeGrupo.findFirst({ where: { productoId: producto.id }, select: { id: true } })) {
          throw new PasoRechazado(fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» es el producto de respaldo de un adicional: no admite opciones.`));
        }

        // 2. El grupo.
        const grupo = await cargarGrupoEnTx(tx, comando.grupoId);
        if (!grupo) throw new PasoRechazado(fracaso("GRUPO_NO_ENCONTRADO", "No se encontró el grupo de opciones."));
        if (!grupo.activo) throw new PasoRechazado(fracaso("GRUPO_INACTIVO", `«${grupo.nombre}» está archivado: restauralo (en Biblioteca de opciones → Archivados) antes de agregarle opciones.`));

        // 3. Lo que el producto ya usa de él.
        const filaGrupo = await tx.productoAdmiteGrupo.findUnique({
          where: { productoId_grupoId: { productoId: producto.id, grupoId: grupo.id } },
          select: { id: true, orden: true, cantidadMinima: true, cantidadMaxima: true, modoPrecio: true, activo: true },
        });
        if (!filaGrupo || !filaGrupo.activo) {
          throw new PasoRechazado(fracaso("GRUPO_NO_ADMITIDO", `«${producto.nombre}» no usa el grupo «${grupo.nombre}»: agregalo al producto antes de sumarle una opción.`));
        }

        // 4. Qué lleva la opción según el tipo del grupo (leído acá: el cliente no lo dice).
        const esExtra = grupo.tipo === "ADICIONAL";
        const precioFinal = grupo.tipo === "MEDIDA" && filaGrupo.modoPrecio === "ABSOLUTO";
        if (grupo.tipo === "INCLUIDA" && comando.importe !== null && comando.importe !== 0) {
          throw new PasoRechazado(fracaso("CONFIGURACION_INVALIDA", `«${grupo.nombre}» es un grupo de opciones incluidas: van dentro del precio y no llevan importe.`));
        }
        if (grupo.tipo !== "INCLUIDA" && comando.importe === null) {
          throw new PasoRechazado(
            fracaso("CONFIGURACION_INVALIDA", precioFinal ? "Falta el precio final de la opción." : esExtra ? "Falta cuánto cobra el extra." : "Falta cuánto suma la opción (0 si no cambia el precio).")
          );
        }
        const importe = grupo.tipo === "INCLUIDA" ? 0 : comando.importe!;
        if (precioFinal && importe <= 0) throw new PasoRechazado(fracaso("CONFIGURACION_INVALIDA", "El precio final de la opción tiene que ser mayor que cero."));
        if (esExtra && comando.unidadStockId === null) throw new PasoRechazado(fracaso("CONFIGURACION_INVALIDA", "Elegí la unidad del producto de respaldo del extra."));
        if (!esExtra && comando.unidadStockId !== null) throw new PasoRechazado(fracaso("CONFIGURACION_INVALIDA", "Solo un extra (un adicional) lleva producto de respaldo."));
        const cantidadMaxima = esExtra ? grupo.cantidadMaxima : 1;
        const absoluto = precioFinal ? importe : null;

        // 5. La opción, al final del orden del grupo. Si ya está igual (un reintento) se adopta; si es otra con ese nombre, `NOMBRE_REPETIDO`.
        const ultima = await tx.opcionDeGrupo.aggregate({ where: { grupoId: grupo.id }, _max: { orden: true } });
        const opcion = await crearOpcionDeGrupoEnTx(
          tx,
          actor,
          {
            grupoId: grupo.id,
            nombre: comando.nombre,
            orden: (ultima._max.orden ?? 0) + PASO_DE_ORDEN,
            esNinguna: false,
            version: { diferencia: { tipo: "MONTO", monto: precioFinal ? 0 : importe }, factorEscala: null, consumos: [] },
            ancla: esExtra ? { unidadStockId: comando.unidadStockId! } : null,
          },
          azar
        );
        if (!opcion.ok) throw rechazoDe(opcion);
        const { opcionId } = opcion.datos;

        // 6. Lo que el producto admite de ella. Si ya la admite tal como se pide (un doble clic, un reintento) no hay nada que escribir; si la admite distinto, no se pisa.
        const filaOpcion = await tx.productoAdmiteOpcion.findUnique({
          where: { productoId_opcionId: { productoId: producto.id, opcionId } },
          select: { cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, activo: true },
        });
        if (filaOpcion) {
          const comoSePide = filaOpcion.activo && filaOpcion.cantidadMaxima === cantidadMaxima && filaOpcion.tipoDeDiferencia === null && mismosCentavos(aNumero(filaOpcion.precioAbsoluto), absoluto);
          if (!comoSePide) {
            throw new PasoRechazado(fracaso("NOMBRE_REPETIDO", `«${comando.nombre}» ya está (o estuvo) en «${producto.nombre}» con otro importe: no se pisa. Cambialo desde su tarjeta.`));
          }
          return exito(`«${comando.nombre}» ya estaba en «${grupo.nombre}» de «${producto.nombre}»: no se hizo nada más.`, { opcionId, admisionId: filaGrupo.id, yaExistia: true });
        }
        const admision = await fijarAdmisionDeGrupoEnTx(tx, actor, {
          productoId: producto.id,
          grupoId: grupo.id,
          versionEsperada: comando.versionEsperada,
          orden: filaGrupo.orden,
          cantidadMinima: filaGrupo.cantidadMinima,
          cantidadMaxima: filaGrupo.cantidadMaxima,
          modoPrecio: filaGrupo.modoPrecio === null ? null : (filaGrupo.modoPrecio as "ABSOLUTO" | "DIFERENCIA"),
          activo: true,
          opciones: [{ opcionId, versionEsperada: 0, cantidadMaxima, precioAbsoluto: absoluto, diferencia: null, activo: true }],
        });
        // La opción y su respaldo ya están escritos: devolver el rechazo los confirmaría. Se lanza.
        if (!admision.ok) throw rechazoDe(admision);

        const que = esExtra ? "el extra" : "la opción";
        return exito(`Listo: se agregó ${que} «${comando.nombre}» a «${grupo.nombre}» de «${producto.nombre}».`, { opcionId, admisionId: admision.datos.admisionId, yaExistia: false });
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    // Un rechazo de las reglas de negocio: la transacción ya se deshizo (ni opción, ni versión, ni respaldo, ni admisión, ni auditoría).
    if (e instanceof PasoRechazado) return e.resultado;
    // Defensa: todo se lee antes de escribir (un id ajeno no se ve), pero si una clave foránea igual se viola sale como rechazo de pertenencia y no como excepción cruda.
    const rechazo = rechazoDeReferenciaNoEncontrada(e, { productoId: "el producto", grupoId: "el grupo de opciones", opcionId: "la opción", unidadStockId: "la unidad elegida" }, "No se encontró una de las referencias elegidas.");
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
