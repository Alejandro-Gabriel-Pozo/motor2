import "server-only";
import { claveDeNombreDeCarta } from "@/core/carta/public";
import { nombreDeFichaSiCambio } from "@/core/datos/nombre-de-ficha";
import type { ComandoEditarFamiliaDeProducto, ResultadoEditarFamiliaDeProducto } from "@/core/features/carta/familias.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearFamilia, cambiarFamilia, leerFamiliaPorId, leerFamiliaPorNombreClave } from "@/server/persistencia/carta/familias";

const MENSAJE_FAMILIA_NO_ENCONTRADA = "No se encontró la familia: recargá la pantalla.";

/**
 * Caso de uso «editar una familia de productos» (CU-F2 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, etapa F1): el nombre y los dos interruptores («Agrupar en la carta» y «Agrupar en el POS»), por
 * ESTADO deseado, no «alternar». «Agrupar en el POS» se guarda y nada más lo lee todavía.
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. la familia es de la empresa y se toma (`FOR UPDATE`; si no, `FAMILIA_NO_ENCONTRADA`: otra empresa responde igual que no existir); 2. el nombre, con la regla estricta de nombres
 * SOLO si cambió (`DATO_INVALIDO`); 3. si la familia ya tiene exactamente esos datos, éxito sin escribir ni auditar (`yaEstaba`); 4. la versión que vio la pantalla tiene que seguir siendo la vigente (si otra persona la
 * cambió, `VERSION_DESACTUALIZADA` y no se cambia nada); 5. otra familia con el nombre nuevo (sin distinguir mayúsculas ni tildes) → `NOMBRE_REPETIDO`; 6. se cambia con la versión esperada; 7. una fila de auditoría por
 * dato que cambió, con el mismo `tx`.
 *
 * @contract Deja la familia con el nombre y los interruptores pedidos y la versión subida en uno, con una fila de auditoría por dato que cambió: todo o nada.
 * @idempotency Por estado y versión — si la familia ya tiene esos datos no se escribe ni se audita; la versión vista arbitra dos cambios a la vez (gana uno).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas; el choque del único del nombre (dos cambios a la vez) se repite y ve el estado de la otra.
 * @sideEffects registrarCambioAuditado (`FamiliaDeProducto`: `nombre`, `agruparEnCarta`, `agruparEnPos`, sin sucursal: es de la empresa), con el mismo `tx`. Nada lee las familias todavía: no hay carta pública que revalidar.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarFamiliaDeProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">,
  comando: ComandoEditarFamiliaDeProducto,
): Promise<ResultadoEditarFamiliaDeProducto> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarFamiliaDeProducto> => {
      if (!(await bloquearFamilia(tx, comando.familiaId))) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);
      const familia = await leerFamiliaPorId(tx, comando.familiaId);
      if (!familia) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);

      // Regla de nombres: la estricta se aplica solo si el nombre CAMBIA respecto del guardado (leído por el servidor).
      const nombre = nombreDeFichaSiCambio(comando.nombre, familia.nombre, "PRODUCTO", "El nombre de la familia no puede estar vacío.");
      if (!nombre.ok) return fracaso("DATO_INVALIDO", nombre.mensaje);

      if (nombre.valor === familia.nombre && comando.agruparEnCarta === familia.agruparEnCarta && comando.agruparEnPos === familia.agruparEnPos) {
        return exito("La familia ya tenía esos datos: no cambió nada.", { yaEstaba: true });
      }
      if (familia.version !== comando.versionEsperada) return fracaso("VERSION_DESACTUALIZADA", "Otra persona cambió esta familia mientras la mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.");

      const nombreClave = claveDeNombreDeCarta(nombre.valor);
      if (nombreClave !== familia.nombreClave) {
        const repetida = await leerFamiliaPorNombreClave(tx, nombreClave);
        if (repetida && repetida.id !== familia.id) return fracaso("NOMBRE_REPETIDO", `Ya existe la familia "${repetida.nombre}".`);
      }

      const cambiado = await cambiarFamilia(tx, {
        id: familia.id,
        versionEsperada: familia.version,
        datos: { nombre: nombre.valor, nombreClave, agruparEnCarta: comando.agruparEnCarta, agruparEnPos: comando.agruparEnPos },
        ahora: actor.ahora,
      });
      if (!cambiado) return fracaso("VERSION_DESACTUALIZADA", "Otra persona cambió esta familia mientras la mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.");

      const cambios = [
        { campo: "nombre", anterior: familia.nombre, nuevo: nombre.valor, texto: `nombre «${nombre.valor}»` },
        { campo: "agruparEnCarta", anterior: familia.agruparEnCarta, nuevo: comando.agruparEnCarta, texto: `«Agrupar en la carta» ${comando.agruparEnCarta ? "encendido" : "apagado"}` },
        { campo: "agruparEnPos", anterior: familia.agruparEnPos, nuevo: comando.agruparEnPos, texto: `«Agrupar en el POS» ${comando.agruparEnPos ? "encendido" : "apagado"}` },
      ];
      for (const c of cambios) {
        await registrarCambioAuditado(tx, {
          entidad: "FamiliaDeProducto",
          entidadId: familia.id,
          campo: c.campo,
          descripcion: `Familia de productos «${familia.nombre}»: ${c.texto}`,
          valorAnterior: c.anterior,
          valorNuevo: c.nuevo,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
      }
      return exito(`Familia "${nombre.valor}" guardada.`, { yaEstaba: false });
    },
    undefined,
    undefined,
    true,
  );
}
