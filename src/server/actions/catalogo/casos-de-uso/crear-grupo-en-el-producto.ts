import "server-only";
import { mismosCentavos } from "@/core/datos/importe";
import { rechazoDeReferenciaNoEncontrada } from "@/core/datos/errores-de-base";
import type { ComandoCrearGrupoEnElProducto, DatosDeVersionDeOpcion, ResultadoCrearGrupoEnElProducto } from "@/core/features/catalogo/opciones-de-venta.schema";
import { contenidoDeVersionIgual, formaDelGrupoPorRespuesta } from "@/core/opciones/public";
import { exito, fracaso, type Fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";
import { crearGrupoDeOpcionesEnTx } from "./crear-grupo-de-opciones";
import { crearOpcionDeGrupoEnTx } from "./crear-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnTx } from "./fijar-admision-de-grupo-en-producto";
import { versionVigenteEnTx } from "./opciones-de-venta-en-tx";

/** Paso entre el orden de un grupo y el siguiente, dentro de las opciones del grupo y de los grupos del producto: lo que ya usa la pantalla (`PASO_DE_ORDEN` de «Opciones de venta») y deja lugar para uno en el medio. */
const PASO_DE_ORDEN = 10;

type FracasoDelComando = Fracaso<Extract<ResultadoCrearGrupoEnElProducto, { ok: false }>["codigo"]>;

/**
 * Un rechazo de las reglas de negocio, LANZADO. Dentro de `conTransaccionSerializable` devolver un `fracaso` NO deshace lo ya escrito: Prisma confirma lo que la función terminó sin lanzar (el alta del grupo y
 * de sus opciones quedarían confirmados aunque la admisión se rechace). Por eso TODO rechazo de este caso de uso se lanza y se captura afuera (precedente: `LoteDesactualizado` de `archivar-opciones.ts`); el
 * resultado recién se devuelve cuando la transacción ya se deshizo.
 */
class PasoRechazado extends Error {
  constructor(readonly resultado: FracasoDelComando) {
    super(resultado.mensaje);
    this.name = "PasoRechazado";
  }
}

/** Un rechazo de un paso compartido (el alta del grupo, la de una opción o la admisión) como rechazo de este comando: los códigos que el comando no declara salen como `CONFIGURACION_INVALIDA`, con su mensaje. */
function rechazoDe(paso: { codigo: string; mensaje: string }): PasoRechazado {
  const conocidos = ["PRODUCTO_NO_ENCONTRADO", "PRODUCTO_NO_ELEGIBLE", "NOMBRE_REPETIDO", "VERSION_DESACTUALIZADA", "CONFIGURACION_INVALIDA", "GRUPO_INACTIVO", "REFERENCIA_NO_ENCONTRADA"] as const;
  const codigo = conocidos.find((c) => c === paso.codigo);
  return new PasoRechazado(codigo ? fracaso(codigo, paso.mensaje) : fracaso("CONFIGURACION_INVALIDA", paso.mensaje));
}

/** El nombre del grupo ya es de otro de la biblioteca (o del mismo producto, pero distinto): se le dice a la persona cómo seguir. Nunca se pisa. */
const nombreRepetidoEnLaBiblioteca = (nombre: string) =>
  fracaso("NOMBRE_REPETIDO", `Ya hay un grupo «${nombre}» en la biblioteca y no es igual a este (otro tipo, otras opciones u otros precios): agregalo con «Agregar un grupo existente» o elegí otro nombre.`);

const cuantas = (n: number) => (n === 1 ? "1 opción" : `${n} opciones`);

/**
 * Caso de uso «crear un grupo de opciones y agregarlo a este producto» (Fase 6, «el espacio del producto», 6.14c; ADR-030, «El comando compuesto»), TODO O NADA: el grupo de la biblioteca, sus opciones con su
 * versión 1 y lo que el producto admite de ellas, en UNA transacción SERIALIZABLE. Es lo que hoy son tres pantallas (crear el grupo, crear cada opción, agregarlo al producto) sin salir del producto.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Los dos permisos (`producto_opciones_admitidas` y `opciones_definir`) y el formato (`guardComandoCrearGrupoEnElProducto`) ya los resolvió la Server Action.
 *
 * Pasos, dentro de la transacción y con lo leído ahí: 1. la fila del producto PRIMERO (`FOR UPDATE`, el mismo orden que `actualizarProducto` y `fijarAdmisionDeGrupoEnTx`: sin bloqueos cruzados) y que sea de
 * venta y no el ancla de un adicional; 2. el grupo (`crearGrupoDeOpcionesEnTx`, con la forma que sale de «¿Cambia el precio?»); 3. sus opciones (`crearOpcionDeGrupoEnTx`: orden de a 10, versión 1 con la diferencia
 * que suma, 0 si el precio final va en lo que admite el producto); 4. el orden del grupo en el producto, leído acá; 5. lo que el producto admite (`fijarAdmisionDeGrupoEnTx`: las reglas puras de la admisión,
 * la regla de la base y el control del precio de lista).
 *
 * NUNCA modifica un grupo de la biblioteca que ya existía. Si hay uno con ese nombre (sin distinguir mayúsculas) y es el mismo (tipo, cantidades, prefijo, el mismo conjunto de opciones activas por nombre y el mismo
 * precio de cada una) se «adopta»: solo se agrega al producto (`yaExistia`). Si es otro, `NOMBRE_REPETIDO` y no se escribe nada.
 *
 * Todo rechazo se LANZA (`PasoRechazado`), también el posterior a la primera escritura: devolver un `fracaso` desde adentro de `conTransaccionSerializable` confirmaría lo ya escrito.
 *
 * @contract Deja el grupo con sus opciones y lo que el producto admite de él (o igual, si ya estaba así) y devuelve el grupo y la admisión; ante cualquier rechazo no queda ni una fila.
 * @idempotency Por estado — sin migración: el nombre único del grupo (sin distinguir mayúsculas) arbitra y el de cada opción en su grupo; repetir el pedido encuentra el grupo, sus opciones y lo que admite el producto y no escribe ni audita de nuevo. Dos envíos simultáneos chocan con el único: el perdedor se reintenta y ve el grupo del ganador.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: el grupo, las opciones y la admisión en una sola transacción; el choque del único es la carrera perdida y el reintento da el resultado de negocio. Todo rechazo lanza para deshacer.
 * @sideEffects registrarCambioAuditado (el alta del grupo, la de cada opción con su versión 1 y lo que admite el producto, por columna), todo con el mismo `tx`; ninguno fuera de la base, así que el reintento es seguro.
 * @ficha permiso=opciones_definir+producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearGrupoEnElProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoCrearGrupoEnElProducto,
  azar: FuenteDeAzar
): Promise<ResultadoCrearGrupoEnElProducto> {
  const forma = formaDelGrupoPorRespuesta(comando.respuesta);
  const precioFinal = comando.respuesta === "PRECIO_FINAL";
  /** Lo que fija la versión 1 de cada opción: lo que suma (SUMA); 0 en un grupo de precio final (el precio va en lo que admite el producto) y en uno incluido. */
  const versionDe = (importe: number | null): DatosDeVersionDeOpcion => ({
    diferencia: { tipo: "MONTO", monto: comando.respuesta === "SUMA" ? (importe ?? 0) : 0 },
    factorEscala: null,
    consumos: [],
  });
  const precioAbsolutoDe = (importe: number | null) => (precioFinal ? importe : null);

  try {
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoCrearGrupoEnElProducto> => {
        // 1. La fila del producto, antes de leer nada.
        await tomarFilaDeProducto(tx, comando.productoId);
        const producto = await tx.producto.findFirst({ where: { id: comando.productoId }, select: { id: true, nombre: true, tipo: true } });
        if (!producto) throw new PasoRechazado(fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto."));
        if (producto.tipo !== "PV") throw new PasoRechazado(fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» no es un producto de venta: solo un producto de venta admite opciones.`));
        if (await tx.opcionDeGrupo.findFirst({ where: { productoId: producto.id }, select: { id: true } })) {
          throw new PasoRechazado(fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» es el producto de respaldo de un adicional: no admite opciones.`));
        }

        // 2. El grupo: uno nuevo o el idéntico que ya estaba en la biblioteca.
        const grupo = await crearGrupoDeOpcionesEnTx(tx, actor, { nombre: comando.nombre, ...forma, prefijoEnCarta: comando.prefijoEnCarta });
        if (!grupo.ok) {
          throw grupo.codigo === "NOMBRE_REPETIDO" ? new PasoRechazado(nombreRepetidoEnLaBiblioteca(comando.nombre)) : rechazoDe(grupo);
        }
        const { grupoId, yaExistia } = grupo.datos;

        // 3. Sus opciones. Un grupo de la biblioteca NO se toca: solo se adopta si ya tiene exactamente estas.
        let opcionIds: string[];
        if (yaExistia) {
          const activas = await tx.opcionDeGrupo.findMany({ where: { grupoId, activa: true }, orderBy: { orden: "asc" }, select: { id: true, nombre: true, esNinguna: true } });
          const activasPorNombre = new Map(activas.map((a) => [a.nombre.toLowerCase(), a]));
          let identicas = activas.length === comando.opciones.length && activasPorNombre.size === activas.length;
          opcionIds = [];
          for (const o of identicas ? comando.opciones : []) {
            const activa = activasPorNombre.get(o.nombre.toLowerCase());
            const vigente = activa && !activa.esNinguna ? await versionVigenteEnTx(tx, activa.id) : null;
            if (!activa || !vigente || !contenidoDeVersionIgual(vigente, versionDe(o.importe))) {
              identicas = false;
              break;
            }
            opcionIds.push(activa.id);
          }
          if (!identicas) throw new PasoRechazado(nombreRepetidoEnLaBiblioteca(comando.nombre));
        } else {
          opcionIds = [];
          for (const [i, o] of comando.opciones.entries()) {
            const opcion = await crearOpcionDeGrupoEnTx(tx, actor, { grupoId, nombre: o.nombre, orden: (i + 1) * PASO_DE_ORDEN, esNinguna: false, version: versionDe(o.importe), ancla: null }, azar);
            if (!opcion.ok) throw rechazoDe(opcion);
            opcionIds.push(opcion.datos.opcionId);
          }
        }

        // 4. Lo que el producto ya admite de este grupo: si está exactamente como se pide (un reintento, un doble clic) no hay nada que escribir; si está distinto, no se pisa.
        const filaGrupo = await tx.productoAdmiteGrupo.findUnique({
          where: { productoId_grupoId: { productoId: producto.id, grupoId } },
          select: { id: true, cantidadMinima: true, cantidadMaxima: true, modoPrecio: true, activo: true },
        });
        const filasDeOpciones = new Map(
          (
            await tx.productoAdmiteOpcion.findMany({
              where: { productoId: producto.id, opcionId: { in: opcionIds } },
              select: { opcionId: true, version: true, cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, activo: true },
            })
          ).map((f) => [f.opcionId, f])
        );
        if (filaGrupo) {
          const comoSePide =
            filaGrupo.activo &&
            filaGrupo.cantidadMinima === null &&
            filaGrupo.cantidadMaxima === null &&
            filaGrupo.modoPrecio === forma.modoPrecio &&
            comando.opciones.every((o, i) => {
              const f = filasDeOpciones.get(opcionIds[i]!);
              const absoluto = precioAbsolutoDe(o.importe);
              return (
                f !== undefined &&
                f.activo &&
                f.cantidadMaxima === 1 &&
                f.tipoDeDiferencia === null &&
                (absoluto === null ? f.precioAbsoluto === null : f.precioAbsoluto !== null && mismosCentavos(Number(f.precioAbsoluto), absoluto))
              );
            });
          if (!comoSePide) {
            throw new PasoRechazado(
              fracaso("NOMBRE_REPETIDO", `«${comando.nombre}» ya está (o estuvo) en «${producto.nombre}» con otras opciones o precios: no se pisa. Cambialo desde su tarjeta, o volvelo a vincular desde «Quitados».`)
            );
          }
          return exito(`«${comando.nombre}» ya estaba en «${producto.nombre}» con esas opciones: no se hizo nada más.`, { grupoId, admisionId: filaGrupo.id, yaExistia: true });
        }

        // 5. Lo que el producto admite: al final de sus grupos (leído acá, en la transacción) y con el precio de cada opción.
        const ultimo = await tx.productoAdmiteGrupo.aggregate({ where: { productoId: producto.id }, _max: { orden: true } });
        const admision = await fijarAdmisionDeGrupoEnTx(tx, actor, {
          productoId: producto.id,
          grupoId,
          versionEsperada: 0,
          orden: (ultimo._max.orden ?? 0) + PASO_DE_ORDEN,
          cantidadMinima: null,
          cantidadMaxima: null,
          modoPrecio: forma.modoPrecio,
          activo: true,
          opciones: comando.opciones.map((o, i) => ({
            opcionId: opcionIds[i]!,
            versionEsperada: filasDeOpciones.get(opcionIds[i]!)?.version ?? 0,
            cantidadMaxima: 1,
            precioAbsoluto: precioAbsolutoDe(o.importe),
            diferencia: null,
            activo: true,
          })),
        });
        // El grupo y las opciones ya están escritos: devolver el rechazo los confirmaría. Se lanza.
        if (!admision.ok) throw rechazoDe(admision);

        const mensaje = yaExistia
          ? `Listo: «${comando.nombre}» ya estaba en la biblioteca con esas mismas opciones y se agregó a «${producto.nombre}» sin cambiarlo.`
          : `Listo: «${comando.nombre}» se agregó a «${producto.nombre}» con ${cuantas(comando.opciones.length)}.`;
        return exito(mensaje, { grupoId, admisionId: admision.datos.admisionId, yaExistia });
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    // Un rechazo de las reglas de negocio: la transacción ya se deshizo (ni grupo, ni opciones, ni versiones, ni admisión, ni auditoría).
    if (e instanceof PasoRechazado) return e.resultado;
    // Defensa: todo se lee antes de escribir (un id ajeno no se ve), pero si una clave foránea igual se viola sale como rechazo de pertenencia y no como excepción cruda.
    const rechazo = rechazoDeReferenciaNoEncontrada(e, { productoId: "el producto", grupoId: "el grupo de opciones", opcionId: "la opción" }, "No se encontró una de las referencias elegidas.");
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
