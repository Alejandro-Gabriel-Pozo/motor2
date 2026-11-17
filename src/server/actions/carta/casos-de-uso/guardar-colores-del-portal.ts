import "server-only";
import { esCodigoDePortalValido, mismaImagen, mismosDatosDelPortal, sembrarTarjetasDelPortal, type DatosDelPortal, type PartesDeImagen } from "@/core/carta/public";
import type { ComandoGuardarColoresDelPortal, ResultadoGuardarColoresDelPortal } from "@/core/features/carta/portal-colores.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { bloquearPortalDeLaEmpresa, cambiarPortal, crearPortal, crearTarjeta } from "@/server/persistencia/carta/portal-de-empresa";
import { leerLoCargadoDelPortal, leerPortalDeLaEmpresa } from "@/server/lecturas/carta/portal-de-empresa";
import { auditarPortalDeEmpresa, auditarTarjetaDelPortal } from "./auditar-portal-de-empresa";

const MENSAJE_VERSION_DESACTUALIZADA = "Otra persona cambió el portal mientras lo mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.";

/**
 * Caso de uso «guardar los colores del portal» (pantalla simple de la pestaña Portal; diseño `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md` §2.3 y `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §8). MEZCLA: cambia SOLO lo que la pantalla muestra (tres
 * fondos, línea superior, título, logo e imagen) y conserva todo lo demás del portal (variante, tarjetas, zonas, código del QR). El portal es de la EMPRESA activa (`actor.empresaId`, nunca del pedido).
 *
 * RIESGO «portal vacío al crear la fila»: si la empresa todavía no tiene su `PortalDeEmpresa`, la lectura pública sale de `SucursalPublica` y del Json; al crear la fila pasa a salir de las tablas nuevas y solo lista las sucursales que tienen tarjeta. Por eso el ALTA siembra una
 * tarjeta por cada registro público (`sembrarTarjetasDelPortal`, regla de backfill del diseño §8) en la MISMA transacción: el portal se ve igual antes y después. Si lo que hoy se ve no se puede mantener igual (un mapa, un nombre que no entra en una tarjeta) NO se crea nada y se
 * dice el motivo (`PORTAL_NO_SE_PUEDE_CREAR_IGUAL`): cierra en vez de cambiar el portal sin avisar.
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. el código y el id que armó el servidor tienen la forma de la base; 2. se toma el portal (`FOR UPDATE`); 3. sin portal: se lee lo cargado, se siembra, se crea con la auditoría de cada fila; 4. con portal: si ya está como se pide, éxito sin escribir
 * ni auditar (`yaEstaba`); si cambia, la versión que vio la pantalla tiene que ser la vigente (`PORTAL_NO_VISTO` / `VERSION_DESACTUALIZADA`) y se cambia con ella.
 *
 * @contract Deja el portal de la empresa activa con los datos pedidos (y, si no existía, con sus tarjetas sembradas), con su auditoría: todo o nada. La versión sube en cada cambio.
 * @idempotency Por estado y versión — si el portal ya está como se pide no se escribe ni se audita; la versión vista arbitra dos cambios a la vez (gana uno) y el único por empresa arbitra dos altas a la vez (queda una fila).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, el sembrado, las escrituras y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`PortalDeEmpresa` y `PortalTarjeta`, sin sucursal: es de la empresa), con el mismo `tx`. La revalidación de las cartas públicas no hace falta: el portal se lee en cada pedido.
 * @ficha permiso=carta_portal transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarColoresDelPortalCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "empresaId" | "ahora">,
  comando: ComandoGuardarColoresDelPortal,
): Promise<ResultadoGuardarColoresDelPortal> {
  if (!esCodigoDePortalValido(comando.codigoNuevo)) return fracaso("DATO_INVALIDO", "No se pudo armar el código del portal: volvé a intentar.");
  try {
    return await guardarEnTransaccion(actor, comando, actor.empresaId);
  } catch (e) {
    // Dos altas a la vez: el choque del único se repite y ve la fila de la otra. Si aun así choca es el CÓDIGO del QR repetido (con 128 bits de azar no pasa): se cierra con un mensaje.
    if (esChoqueDeIndiceUnico(e)) return fracaso("DATO_INVALIDO", "No se pudo crear el portal porque el código que se armó ya estaba en uso: volvé a intentar.");
    throw e;
  }
}

/** Lo que el pedido cambia de los datos del portal: los tres fondos, los dos textos y el logo. La variante no viaja (la elige PR-A). */
const conLoDelPedido = (base: DatosDelPortal, c: ComandoGuardarColoresDelPortal): DatosDelPortal => ({
  ...base,
  lineaSuperior: c.lineaSuperior,
  titulo: c.titulo,
  colorEncabezado: c.colorEncabezado,
  colorPagina: c.colorPagina,
  colorDetras: c.colorDetras,
  logoVisible: c.logoVisible,
});

async function guardarEnTransaccion(actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">, comando: ComandoGuardarColoresDelPortal, empresaId: string): Promise<ResultadoGuardarColoresDelPortal> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoGuardarColoresDelPortal> => {
      await bloquearPortalDeLaEmpresa(tx, empresaId);
      const existente = await leerPortalDeLaEmpresa(tx, empresaId);
      // Sin imagen en el pedido se conserva la que ya tiene; `null` la quita.
      const imagenDe = (previa: PartesDeImagen | null): PartesDeImagen | null => (comando.imagen === undefined ? previa : comando.imagen);

      if (existente === null) {
        const cargado = await leerLoCargadoDelPortal(tx, empresaId);
        const sembrado = sembrarTarjetasDelPortal({ valoresJson: cargado.valoresJson, registros: cargado.registros });
        if (!sembrado.ok) return fracaso("PORTAL_NO_SE_PUEDE_CREAR_IGUAL", sembrado.mensaje);
        const nuevo = { datos: conLoDelPedido({ variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, logoVisible: true }, comando), imagen: imagenDe(null) };
        await crearPortal(tx, { id: comando.portalId, codigo: comando.codigoNuevo, datos: nuevo.datos, imagen: nuevo.imagen, actorId: actor.usuarioId, ahora: actor.ahora });
        for (const t of sembrado.tarjetas) await crearTarjeta(tx, { portalId: comando.portalId, tarjeta: t, ahora: actor.ahora });
        await auditarPortalDeEmpresa(tx, { portalId: comando.portalId, anterior: null, nuevo, codigoDelAlta: comando.codigoNuevo, actorId: actor.usuarioId });
        for (const t of sembrado.tarjetas) await auditarTarjetaDelPortal(tx, { portalId: comando.portalId, anterior: null, nueva: t, actorId: actor.usuarioId });
        return exito("Colores del portal guardados.", { portalId: comando.portalId, version: 1, yaEstaba: false });
      }

      const deseado = { datos: conLoDelPedido(existente.datos, comando), imagen: imagenDe(existente.imagen) };
      if (mismosDatosDelPortal(existente.datos, deseado.datos) && mismaImagen(existente.imagen, deseado.imagen)) {
        return exito("El portal ya estaba así: no cambió nada.", { portalId: existente.id, version: existente.version, yaEstaba: true });
      }
      if (comando.versionEsperada === undefined) return fracaso("PORTAL_NO_VISTO", "La empresa ya tiene un portal que no viste: recargá la pantalla y volvé a intentar.");
      if (comando.versionEsperada !== existente.version) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);
      if (!(await cambiarPortal(tx, { id: existente.id, versionEsperada: existente.version, datos: deseado.datos, imagen: deseado.imagen, ahora: actor.ahora }))) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);
      await auditarPortalDeEmpresa(tx, { portalId: existente.id, anterior: { datos: existente.datos, imagen: existente.imagen }, nuevo: deseado, actorId: actor.usuarioId });
      return exito("Colores del portal guardados.", { portalId: existente.id, version: existente.version + 1, yaEstaba: false });
    },
    undefined,
    undefined,
    true,
  );
}
