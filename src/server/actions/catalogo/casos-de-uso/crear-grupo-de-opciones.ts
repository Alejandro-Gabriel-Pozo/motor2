import "server-only";
import type { ComandoCrearGrupoDeOpciones, ResultadoCrearGrupoDeOpciones } from "@/core/features/catalogo/opciones-de-venta.schema";
import { MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA, admitePrefijoEnCarta, validarGrupo } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearGrupoDeOpciones } from "@/server/persistencia/catalogo/opciones-de-venta";
import { grupoConElMismoNombre } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «crear un grupo de opciones de venta» (GO-2a; ADR-030 §1): un grupo de la EMPRESA (tamaño, variante, incluida o adicional) con sus cantidades. El tipo queda fijo
 * para siempre (la app no tiene UPDATE de esa columna).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. El permiso (`opciones_definir`) y el formato (`guardComandoCrearGrupoDeOpciones`) ya los resolvió la Server Action.
 *
 * Pasos: 1. las cantidades según el tipo (`validarGrupo`, puro); 2. en UNA transacción SERIALIZABLE: busca un grupo con el mismo nombre sin distinguir mayúsculas — si es el mismo
 * (tipo y cantidades) devuelve ese («ya existía»: un doble clic o un reintento no crea otro); si es otro, `NOMBRE_REPETIDO`; si no hay, lo crea y audita el alta por columna.
 * Dos altas simultáneas con el mismo nombre (aunque cambien las mayúsculas) chocan con el único `lower(nombre)`: la perdedora recibe 23505, se reintenta (`tambienChoqueDeUnico`)
 * y su relectura ve el grupo de la ganadora.
 *
 * @contract Deja un grupo con ese nombre, tipo y cantidades (el existente idéntico o uno nuevo) y devuelve su id.
 * @idempotency Por estado — el nombre (único sin distinguir mayúsculas) arbitra: repetir el alta encuentra el grupo creado y lo devuelve sin crear otro ni auditar de nuevo.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: el choque del único es la carrera perdida y el reintento da el resultado de negocio.
 * @sideEffects registrarCambioAuditado (el alta del grupo: nombre, tipo, cantidades y «se lee en la carta como», de null al valor), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearGrupoDeOpcionesCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoCrearGrupoDeOpciones
): Promise<ResultadoCrearGrupoDeOpciones> {
  const regla = validarGrupo(comando);
  if (!regla.ok) return fracaso("CONFIGURACION_INVALIDA", regla.mensaje);
  // Fase 4 (ADR-035): «se lee en la carta como» solo en VARIANTE y MEDIDA.
  const prefijoEnCarta = comando.prefijoEnCarta ?? null;
  if (prefijoEnCarta !== null && !admitePrefijoEnCarta(comando.tipo)) return fracaso("CONFIGURACION_INVALIDA", MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA);

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCrearGrupoDeOpciones> => {
      const existente = await grupoConElMismoNombre(tx, comando.nombre, null);
      if (existente) {
        const identico =
          existente.tipo === comando.tipo && existente.cantidadMinima === comando.cantidadMinima && existente.cantidadMaxima === comando.cantidadMaxima && existente.prefijoEnCarta === prefijoEnCarta;
        return identico
          ? exito(`Ya existía el grupo «${existente.nombre}»: no se creó otro.`, { grupoId: existente.id, yaExistia: true })
          : fracaso("NOMBRE_REPETIDO", `Ya hay un grupo llamado «${existente.nombre}». Elegí otro nombre.`);
      }
      const creado = await crearGrupoDeOpciones(tx, { ...comando, prefijoEnCarta, ahora: actor.ahora });
      const descripcion = `Grupo de opciones «${comando.nombre}»: alta.`;
      const cambios = [
        { campo: "nombre", valorNuevo: comando.nombre },
        { campo: "tipo", valorNuevo: comando.tipo },
        { campo: "cantidadMinima", valorNuevo: comando.cantidadMinima },
        { campo: "cantidadMaxima", valorNuevo: comando.cantidadMaxima },
        // Fase 4 (ADR-035): sin prefijo (null) no deja fila (no cambió nada).
        { campo: "prefijoEnCarta", valorNuevo: prefijoEnCarta },
      ];
      for (const c of cambios) {
        await registrarCambioAuditado(tx, { entidad: "GrupoDeOpciones", entidadId: creado.id, campo: c.campo, descripcion, valorAnterior: null, valorNuevo: c.valorNuevo, actorId: actor.usuarioId, sucursalId: null });
      }
      return exito(`Grupo «${comando.nombre}» creado.`, { grupoId: creado.id, yaExistia: false });
    },
    undefined,
    undefined,
    true
  );
}
