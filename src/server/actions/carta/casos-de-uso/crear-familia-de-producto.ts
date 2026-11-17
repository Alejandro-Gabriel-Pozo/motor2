import "server-only";
import { claveDeNombre } from "@/core/datos/fichas-de-texto";
import type { ComandoCrearFamiliaDeProducto, ResultadoCrearFamiliaDeProducto } from "@/core/features/carta/familias.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearFamilia, leerFamiliaPorId, leerFamiliaPorNombreClave } from "@/server/persistencia/carta/familias";

/**
 * Caso de uso «crear una familia de productos» (CU-F1 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, etapa F1). La familia es de la EMPRESA: la empresa sale del contexto del servidor, nunca del comando.
 * Nace con los dos interruptores APAGADOS y activa (todo nace cerrado); lleva solo el nombre (decisión del dueño, 2026-11-17: «Solo el nombre, como Pedernal»).
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. si ya existe una familia con ese `id`: con el mismo nombre es el mismo pedido repetido (`yaExistia`, sin escribir ni auditar) y con otro contenido `ID_REUTILIZADO` (no se
 * pisa nada); 2. otra familia con ese nombre (sin distinguir mayúsculas ni tildes) → `NOMBRE_REPETIDO`; 3. se crea; 4. la auditoría (`nombre`, de nada al nombre), con el mismo `tx`. Dos altas a la vez con el mismo
 * nombre: gana una (único `(empresa, nombreClave)`); la otra se repite y ve a la ganadora (`tambienChoqueDeUnico`).
 *
 * @contract Deja creada la familia con el nombre pedido, sin miembros y con los interruptores apagados, con su fila de auditoría: todo o nada.
 * @idempotency Por clave y estado — el `id` que manda quien llama es la clave del alta: repetirlo con el mismo contenido da `yaExistia` sin escribir; con otro contenido, `ID_REUTILIZADO`.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: la lectura que decide, la escritura y la auditoría, juntas; el choque del único (dos altas a la vez) se repite y ve la fila de la otra.
 * @sideEffects registrarCambioAuditado (`FamiliaDeProducto`, `nombre`, sin sucursal: es de la empresa), con el mismo `tx`. Nada lee las familias todavía: no hay carta pública que revalidar.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearFamiliaDeProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">,
  comando: ComandoCrearFamiliaDeProducto,
): Promise<ResultadoCrearFamiliaDeProducto> {
  const nombreClave = claveDeNombre(comando.nombre);
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCrearFamiliaDeProducto> => {
      const conEseId = await leerFamiliaPorId(tx, comando.id);
      if (conEseId) {
        if (conEseId.nombre === comando.nombre) return exito("La familia ya estaba creada: no cambió nada.", { id: conEseId.id, nombre: conEseId.nombre, yaExistia: true });
        return fracaso("ID_REUTILIZADO", "El pedido no es válido: recargá la pantalla.");
      }
      const repetida = await leerFamiliaPorNombreClave(tx, nombreClave);
      if (repetida) return fracaso("NOMBRE_REPETIDO", `Ya existe la familia "${repetida.nombre}".`);

      await crearFamilia(tx, { id: comando.id, nombre: comando.nombre, nombreClave, actorId: actor.usuarioId, ahora: actor.ahora });
      await registrarCambioAuditado(tx, {
        entidad: "FamiliaDeProducto",
        entidadId: comando.id,
        campo: "nombre",
        descripcion: `Familia de productos «${comando.nombre}»: creada`,
        valorAnterior: null,
        valorNuevo: comando.nombre,
        actorId: actor.usuarioId,
        sucursalId: null,
      });
      return exito(`Familia "${comando.nombre}" creada.`, { id: comando.id, nombre: comando.nombre, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
