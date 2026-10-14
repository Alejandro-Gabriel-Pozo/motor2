import "server-only";
import type { ComandoCrearGrupoDePrecio, ResultadoCrearGrupoDePrecio } from "@/core/features/catalogo/combinaciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearGrupoDePrecio } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «crear una TARIFA compartida» (un grupo de precio: «Café mediano $ 3.300»; GO-3b, ADR-032, D-4, paso AB4). De la EMPRESA. El nombre es único sin importar mayúsculas (índice sobre
 * `lower(nombre)`): uno repetido es `NOMBRE_REPETIDO`, también si dos la crean a la vez (el único y el reintento, que relee). El precio llega validado (0,01 o más, hasta 2 decimales). Auditoría del
 * alta (`GrupoDePrecio`: `nombre` y `precio`, del `null` al valor), en la misma transacción.
 *
 * @contract Crea la tarifa con su nombre y su precio, con su auditoría, si el nombre no está usado.
 * @idempotency No aplica — un alta repetida con el mismo nombre se rechaza (`NOMBRE_REPETIDO`): el nombre es la identidad para quien la carga.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: la lectura del nombre, el alta y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`GrupoDePrecio`: `nombre`, `precio`), con el mismo `tx`.
 * @ficha permiso=grupos_de_precio_definir transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearGrupoDePrecioCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">, comando: ComandoCrearGrupoDePrecio): Promise<ResultadoCrearGrupoDePrecio> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCrearGrupoDePrecio> => {
      const repetido = await tx.grupoDePrecio.findFirst({ where: { nombre: { equals: comando.nombre, mode: "insensitive" } }, select: { id: true } });
      if (repetido) return fracaso("NOMBRE_REPETIDO", `Ya hay una tarifa «${comando.nombre}».`);
      const { id } = await crearGrupoDePrecio(tx, { nombre: comando.nombre, precio: comando.precio, ahora: actor.ahora });
      for (const [campo, valor] of [["nombre", comando.nombre], ["precio", comando.precio]] as const) {
        await registrarCambioAuditado(tx, { entidad: "GrupoDePrecio", entidadId: id, campo, descripcion: `Tarifa «${comando.nombre}»`, valorAnterior: null, valorNuevo: valor, actorId: actor.usuarioId });
      }
      return exito(`Tarifa «${comando.nombre}» creada.`, { grupoDePrecioId: id });
    },
    undefined,
    undefined,
    true,
  );
}
