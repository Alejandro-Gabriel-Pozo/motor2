import "server-only";
import { decidirSobreProducto, marcasDeOcultar, ocultoPor, type MotivoDeRechazo, type Quien } from "@/core/catalogo/ocultar-producto";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { tieneExistenciaDistintaDeCero } from "@/server/lecturas/catalogo/existencia-para-ocultar";
import { cambiarMarcaDeOcultar, crearMarcaDeOcultar, leerMarcasDeOcultar } from "@/server/persistencia/catalogo/ocultamiento";
import { tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";

/** Dónde se oculta: el local activo, o toda la empresa. */
export type AlcanceDeOcultamiento = "LOCAL" | "EMPRESA";

export interface ComandoOcultarProducto {
  productoId: string;
  alcance: AlcanceDeOcultamiento;
  /** El ESTADO que se quiere (no alterna): `true` oculta, `false` vuelve a mostrar. */
  oculto: boolean;
  /** Id (uuid) de la marca si hubiera que crearla: lo genera quien llama, así un reintento del mismo pedido no puede crear dos. */
  marcaId: string;
  /** Lo calcula la acción con el gate, no el caso de uso: ¿quien pide es administración con alcance sobre TODAS las sucursales (O-10)? Solo se mira con `alcance: "EMPRESA"`. */
  puedeEnLaEmpresa: boolean;
}

export type CodigoDeOcultar = "DATOS_INVALIDOS" | "PRODUCTO_NO_ENCONTRADO" | "SIN_PERMISO" | "EMPRESA_LO_OCULTA" | "TIENE_EXISTENCIA" | "VERSION_DESACTUALIZADA";
export type ResultadoOcultarProducto = ResultadoCaso<{ yaEstaba: boolean; sigueOcultoPor: "EMPRESA" | null }, CodigoDeOcultar>;

/**
 * TEXTOS PENDIENTES DE APROBACIÓN DEL DUEÑO (no se inventan: «lo que el dueño no pidió no entra»). Hasta que los apruebe, `mensaje` lleva el CÓDIGO interno cerrado, salvo el que ya existe en
 * el sistema («No se encontró el producto.», de Desactivar). La pantalla (etapa d) los traducirá a los textos aprobados.
 */
const MENSAJE_PRODUCTO_NO_ENCONTRADO = "No se encontró el producto.";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Un rechazo de la regla adentro de la transacción: tira para que la transacción se DESHAGA entera (la marca y la auditoría ya escritas no quedan). */
class RechazoQueDeshace extends Error {
  constructor(readonly motivo: MotivoDeRechazo) {
    super(motivo);
  }
}

/** Los rechazos que puede dar la regla pura al ocultar o mostrar, con el código que sale del caso de uso. */
function codigoDe(motivo: MotivoDeRechazo): CodigoDeOcultar {
  switch (motivo) {
    case "SIN_PERMISO":
    case "FUERA_DE_ALCANCE":
      return "SIN_PERMISO";
    case "EMPRESA_LO_OCULTA":
      return "EMPRESA_LO_OCULTA";
    case "TIENE_EXISTENCIA":
      return "TIENE_EXISTENCIA";
    default:
      return "SIN_PERMISO"; // todo nace cerrado: un motivo que acá no se espera no abre nada
  }
}

/**
 * Caso de uso «Ocultar» / «Volver a mostrar» un producto en el local ACTIVO o en toda la empresa (docs/diseno-ocultar-como-pedernal-2026-11-15.md, CU-1 a CU-3; Pedernal
 * `casos-de-uso/ocultar-producto.ts`). Fija un ESTADO, no alterna. La regla de qué se permite es la del núcleo puro (`decidirSobreProducto`, oráculo R-11 a R-15); acá se arman los hechos y se escribe.
 *
 * Orden (todo en UNA transacción): permiso → fila del producto tomada (`FOR UPDATE`: dos ocultar a la vez, o ocultar y desactivar, se ponen en fila) → marcas del producto → «ya estaba»
 * (no escribe ni audita) → MOSTRAR: un local no muestra lo que la empresa oculta → la marca se ESCRIBE → OCULTAR: recién entonces se mira la existencia del alcance (como Pedernal: si stock suma a la vez,
 * ve la marca); con existencia distinta de cero (también negativa) el rechazo DESHACE la transacción, la marca y la auditoría no quedan → auditoría. «Oculto» y «desactivado» son independientes: no toca `DisponibilidadProducto`.
 *
 * Permisos (O-10): en el local, quien tiene `producto_disponibilidad` EDITAR en la sucursal activa (lo verifica la acción); en toda la empresa, solo administración con alcance total (`puedeEnLaEmpresa`, calculado por la
 * acción, que además ensancha la transacción a toda la empresa: sin eso la existencia de otras sucursales no se vería). Sin ello, `SIN_PERMISO` y no se toca nada. Escribe en `actor.sucursalId` (nunca una que llegue por parámetro).
 *
 * Todavía NO bloquea nada en ventas ni en stock (etapa c) ni tiene pantalla (etapa d): solo guarda la marca.
 *
 * @contract Deja el producto oculto o visible en el alcance pedido, con su fila de auditoría si cambió: todo o nada.
 * @idempotency Por estado — si la marca ya está en el estado pedido no se escribe ni se audita; el `marcaId` es la clave del alta (un reintento no crea una segunda marca: la base tiene un único por producto y alcance).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: la fila del producto tomada (`FOR UPDATE`), las marcas, la escritura, la existencia y la auditoría, todo junto; el rechazo por existencia la deshace. SERIALIZABLE (y no READ COMMITTED) porque anular una venta —que DEVUELVE existencia— ya corre serializable: con las dos del mismo lado, ocultar y anular a la vez no pueden dejar «oculto y con existencia» (una aborta y relee). Lo decidió la prueba de concurrencia (test/movimientos/anular-venta-producto-oculto.test.ts).
 * @sideEffects registrarCambioAuditado (`OcultamientoProducto`, `oculto`, con la sucursal o nula si es de la empresa), en la misma transacción. La revalidación de la carta pública la hará la Server Action.
 * @ficha permiso=producto_disponibilidad transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function ocultarProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre" | "ahora">,
  comando: ComandoOcultarProducto,
): Promise<ResultadoOcultarProducto> {
  if (!comando.productoId || !ES_UUID.test(comando.marcaId)) return fracaso("DATOS_INVALIDOS", "DATOS_INVALIDOS");
  const operacion = comando.oculto ? "ocultar" : "mostrar";
  const alcance = comando.alcance === "EMPRESA" ? "empresa" : "local";
  const quien: Quien = comando.alcance === "EMPRESA" ? (comando.puedeEnLaEmpresa ? "admin_alcance_total" : "sin_permiso") : "operador_de_este_local";
  const sucursalDeLaMarca = comando.alcance === "EMPRESA" ? null : actor.sucursalId;
  const sinHechos = { desactivar: "activo", ocultar: { empresa: false, local: false }, saldo: "cero", conteoSinResolver: false, enRecetaVigente: false } as const;
  // El permiso se decide ANTES de tocar la base.
  const permiso = decidirSobreProducto({ hechos: sinHechos, operacion, quien, alcance });
  if (!permiso.ok) return fracaso(codigoDe(permiso.motivo), permiso.motivo);

  try {
    return await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoOcultarProducto> => {
      await tomarFilaDeProducto(tx, comando.productoId);
      const producto = await tx.producto.findUnique({ where: { id: comando.productoId }, select: { id: true, nombre: true } });
      if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", MENSAJE_PRODUCTO_NO_ENCONTRADO);

      const marcas = await leerMarcasDeOcultar(tx, producto.id);
      const actual = marcas.find((m) => m.sucursalId === sucursalDeLaMarca);
      const sigueOcultoPor = (): "EMPRESA" | null => (ocultoPor(marcas, actor.sucursalId) === "EMPRESA" ? "EMPRESA" : null);
      if ((actual?.oculto ?? false) === comando.oculto) return exito("YA_ESTABA", { yaEstaba: true, sigueOcultoPor: sigueOcultoPor() });

      // Mostrar en un local lo que la empresa oculta: la regla pura lo rechaza (R-15).
      const hechos = { ...sinHechos, ocultar: marcasDeOcultar(marcas, actor.sucursalId) };
      const sobreMarcas = decidirSobreProducto({ hechos, operacion, quien, alcance });
      if (!sobreMarcas.ok) return fracaso(codigoDe(sobreMarcas.motivo), sobreMarcas.motivo);

      if (actual) {
        if (!(await cambiarMarcaDeOcultar(tx, { id: actual.id, versionEsperada: actual.version, oculto: comando.oculto, actorId: actor.usuarioId, ahora: actor.ahora }))) {
          throw new RechazoQueDeshace("SIN_PERMISO"); // no se usa el motivo: abajo se traduce a VERSION_DESACTUALIZADA
        }
      } else {
        await crearMarcaDeOcultar(tx, { id: comando.marcaId, productoId: producto.id, sucursalId: sucursalDeLaMarca, oculto: comando.oculto, actorId: actor.usuarioId, ahora: actor.ahora });
      }
      if (comando.oculto) {
        // La marca YA está escrita: recién ahora se mira la existencia del alcance. Si hay, la transacción se deshace entera.
        const hayExistencia = await tieneExistenciaDistintaDeCero(tx, producto.id, sucursalDeLaMarca);
        const conExistencia = decidirSobreProducto({ hechos: { ...hechos, saldo: hayExistencia ? "positivo" : "cero" }, operacion, quien, alcance });
        if (!conExistencia.ok) throw new RechazoQueDeshace(conExistencia.motivo);
      }
      await registrarCambioAuditado(tx, {
        entidad: "OcultamientoProducto",
        entidadId: `${sucursalDeLaMarca ?? "EMPRESA"}:${producto.id}`,
        campo: "oculto",
        descripcion: `Producto "${producto.nombre}" ${sucursalDeLaMarca === null ? "en toda la empresa" : `en "${actor.sucursalNombre}"`}: oculto`,
        valorAnterior: actual?.oculto ?? false,
        valorNuevo: comando.oculto,
        actorId: actor.usuarioId,
        sucursalId: sucursalDeLaMarca,
      });
      const despues = actual ? marcas.map((m) => (m.id === actual.id ? { ...m, oculto: comando.oculto } : m)) : [...marcas, { sucursalId: sucursalDeLaMarca, oculto: comando.oculto }];
      return exito(comando.oculto ? "OCULTADO" : "MOSTRADO", { yaEstaba: false, sigueOcultoPor: ocultoPor(despues, actor.sucursalId) === "EMPRESA" ? "EMPRESA" : null });
    }, undefined, undefined, true);
  } catch (e) {
    if (!(e instanceof RechazoQueDeshace)) throw e;
    return e.motivo === "TIENE_EXISTENCIA" ? fracaso("TIENE_EXISTENCIA", "TIENE_EXISTENCIA") : fracaso("VERSION_DESACTUALIZADA", "VERSION_DESACTUALIZADA");
  }
}
