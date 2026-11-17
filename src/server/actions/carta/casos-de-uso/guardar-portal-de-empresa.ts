import "server-only";
import {
  esCodigoDePortalValido,
  mismaImagen,
  mismaTarjeta,
  mismaZona,
  mismosDatosDelPortal,
  type DatosDelPortal,
  type TarjetaDePortal,
  type ZonaDePortal,
} from "@/core/carta/public";
import type { PartesDeImagen } from "@/core/carta/public";
import type { ComandoGuardarPortalDeEmpresa, ResultadoGuardarPortalDeEmpresa } from "@/core/features/carta/portal-de-empresa.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import {
  bloquearPortalDeLaEmpresa,
  cambiarPortal,
  cambiarTarjeta,
  cambiarZona,
  crearPortal,
  crearTarjeta,
  crearZona,
  sucursalesQueNoSonDeLaEmpresa,
} from "@/server/persistencia/carta/portal-de-empresa";
import { leerPortalDeLaEmpresa, type PortalGuardado } from "@/server/lecturas/carta/portal-de-empresa";
import { auditarPortalDeEmpresa, auditarTarjetaDelPortal, auditarZonaDelPortal } from "./auditar-portal-de-empresa";

const MENSAJE_VERSION_DESACTUALIZADA = "Otra persona cambió el portal mientras lo mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.";

/** Lo que el pedido deja como portal: los datos y la imagen (si el pedido no trae imagen, la que ya tiene). */
interface Deseado {
  datos: DatosDelPortal;
  imagen: PartesDeImagen | null;
}

/** ¿El portal ya está como lo pide el pedido? Lo que el pedido no manda queda como está: solo cuenta lo que trae y difiere. */
function yaEstaComoSePide(p: PortalGuardado, d: Deseado, tarjetas: readonly TarjetaDePortal[], zonas: readonly ZonaDePortal[]): boolean {
  if (!mismosDatosDelPortal(p.datos, d.datos) || !mismaImagen(p.imagen, d.imagen)) return false;
  const guardadasT = new Map(p.tarjetas.map((t) => [t.sucursalId, t]));
  const guardadasZ = new Map(p.zonas.map((z) => [z.sucursalId, z]));
  return (
    tarjetas.every((t) => {
      const g = guardadasT.get(t.sucursalId);
      return g !== undefined && mismaTarjeta(g, t);
    }) &&
    zonas.every((z) => {
      const g = guardadasZ.get(z.sucursalId);
      return g !== undefined && mismaZona(g, z);
    })
  );
}

/**
 * Caso de uso «guardar el portal de la empresa» (diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §7; Pedernal `guardarPortalDeLaEmpresa`): UNA acción que lo crea (uno por empresa), cambia sus datos (variante, textos, colores, logo visible, imagen) y agrega o
 * cambia sus tarjetas (variante A) y sus zonas (variante B), y cambia de variante SIN tocar lo cargado en la otra. El portal es de la EMPRESA activa (`actor.empresaId`, nunca una que llegue por parámetro). Lo que el pedido no manda queda como está y nada se borra (se oculta con
 * `visible: false`); la sucursal de una tarjeta o de una zona no cambia (se identifican por ella).
 *
 * Permiso: lo pide la acción (`carta_portal`, gerente y administrador). Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final: 1. el código y el id que armó el servidor tienen la forma de la base (`DATO_INVALIDO`); 2. cada sucursal pedida es de la empresa
 * (`SUCURSAL_NO_ENCONTRADA`: una de otra empresa responde igual que una que no existe); 3. se toma el portal (`FOR UPDATE`); 4. si el portal ya está como se pide, éxito sin escribir ni auditar (`yaEstaba`: el segundo clic de un doble clic, o el reintento de un pedido que ya se aplicó, aun si el alta
 * la hizo otro con el mismo contenido); 5. si ya existe y cambia, la versión que vio la pantalla tiene que seguir siendo la vigente (`PORTAL_NO_VISTO` si el pedido no trae ninguna, `VERSION_DESACTUALIZADA` si otra persona lo cambió: no se cambia nada); 6. se crea (con el `portalId` y el código que mandó el
 * servidor: un reintento no crea dos, la base tiene un único por empresa) o se cambia con la versión esperada, con sus tarjetas y zonas nuevas o cambiadas; 7. una fila de auditoría por portal, tarjeta y zona que cambió, con el mismo `tx`.
 *
 * @contract Deja el portal de la empresa activa con los datos pedidos y las tarjetas y zonas pedidas agregadas o cambiadas (el resto, como estaba), con su auditoría: todo o nada. La versión del portal sube en cada cambio, también si solo cambió una tarjeta o una zona.
 * @idempotency Por estado y versión — si el portal ya está como se pide no se escribe ni se audita; la versión vista arbitra dos cambios a la vez (gana uno) y el único por empresa arbitra dos altas a la vez (queda una fila).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, las escrituras y la auditoría, juntas; el choque del único (dos altas a la vez) se repite y ve la fila de la otra.
 * @sideEffects registrarCambioAuditado (`PortalDeEmpresa`, `PortalTarjeta` y `PortalZona`, sin sucursal: es de la empresa), con el mismo `tx`. La revalidación de las cartas públicas la hace la Server Action.
 * @ficha permiso=carta_portal transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPortalDeEmpresaCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "empresaId" | "ahora">,
  comando: ComandoGuardarPortalDeEmpresa,
): Promise<ResultadoGuardarPortalDeEmpresa> {
  if (!esCodigoDePortalValido(comando.codigoNuevo)) return fracaso("DATO_INVALIDO", "No se pudo armar el código del portal: volvé a intentar.");
  const { empresaId } = actor;
  try {
    return await guardarEnTransaccion(actor, comando, empresaId);
  } catch (e) {
    // Con `tambienChoqueDeUnico` el choque del único se repite y ve la fila de la otra alta; si aun así el choque sigue, es el CÓDIGO (llave del QR, único en toda la plataforma) repetido: con 128 bits de azar no pasa, pero si pasara se cierra con un mensaje, no con un error 500.
    if (esChoqueDeIndiceUnico(e)) return fracaso("DATO_INVALIDO", "No se pudo crear el portal porque el código que se armó ya estaba en uso: volvé a intentar.");
    throw e;
  }
}

async function guardarEnTransaccion(actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">, comando: ComandoGuardarPortalDeEmpresa, empresaId: string): Promise<ResultadoGuardarPortalDeEmpresa> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoGuardarPortalDeEmpresa> => {
      const sucursalIds = [...new Set([...comando.tarjetas.map((t) => t.sucursalId), ...comando.zonas.map((z) => z.sucursalId)])];
      if ((await sucursalesQueNoSonDeLaEmpresa(tx, { empresaId, sucursalIds })).length > 0) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró una de las sucursales: recargá la pantalla.");

      await bloquearPortalDeLaEmpresa(tx, empresaId);
      const existente = await leerPortalDeLaEmpresa(tx, empresaId);
      // Sin imagen en el pedido se conserva la que ya tiene (cambiar de variante no pierde la imagen de la B); `null` la quita.
      const deseado: Deseado = { datos: comando.datos, imagen: comando.imagen === undefined ? (existente?.imagen ?? null) : comando.imagen };

      if (existente === null) {
        await crearPortal(tx, { id: comando.portalId, codigo: comando.codigoNuevo, datos: deseado.datos, imagen: deseado.imagen, actorId: actor.usuarioId, ahora: actor.ahora });
        for (const t of comando.tarjetas) await crearTarjeta(tx, { portalId: comando.portalId, tarjeta: t, ahora: actor.ahora });
        for (const z of comando.zonas) await crearZona(tx, { portalId: comando.portalId, zona: z, ahora: actor.ahora });
        await auditarPortalDeEmpresa(tx, { portalId: comando.portalId, anterior: null, nuevo: deseado, codigoDelAlta: comando.codigoNuevo, actorId: actor.usuarioId });
        for (const t of comando.tarjetas) await auditarTarjetaDelPortal(tx, { portalId: comando.portalId, anterior: null, nueva: t, actorId: actor.usuarioId });
        for (const z of comando.zonas) await auditarZonaDelPortal(tx, { zonaId: z.id, anterior: null, nueva: z, actorId: actor.usuarioId });
        return exito("Portal guardado.", { portalId: comando.portalId, codigo: comando.codigoNuevo, version: 1, yaEstaba: false });
      }

      if (yaEstaComoSePide(existente, deseado, comando.tarjetas, comando.zonas)) {
        return exito("El portal ya estaba así: no cambió nada.", { portalId: existente.id, codigo: existente.codigo, version: existente.version, yaEstaba: true });
      }
      if (comando.versionEsperada === undefined) return fracaso("PORTAL_NO_VISTO", "La empresa ya tiene un portal que no viste: recargá la pantalla y volvé a intentar.");
      if (comando.versionEsperada !== existente.version) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);

      if (!(await cambiarPortal(tx, { id: existente.id, versionEsperada: existente.version, datos: deseado.datos, imagen: deseado.imagen, ahora: actor.ahora }))) {
        return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);
      }
      await auditarPortalDeEmpresa(tx, { portalId: existente.id, anterior: { datos: existente.datos, imagen: existente.imagen }, nuevo: deseado, actorId: actor.usuarioId });

      const tarjetasGuardadas = new Map(existente.tarjetas.map((t) => [t.sucursalId, t]));
      for (const t of comando.tarjetas) {
        const previa = tarjetasGuardadas.get(t.sucursalId);
        if (previa === undefined) await crearTarjeta(tx, { portalId: existente.id, tarjeta: t, ahora: actor.ahora });
        else if (!mismaTarjeta(previa, t)) {
          if (!(await cambiarTarjeta(tx, { portalId: existente.id, tarjeta: t, versionEsperada: previa.version, ahora: actor.ahora }))) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);
        } else continue;
        await auditarTarjetaDelPortal(tx, { portalId: existente.id, anterior: previa ?? null, nueva: t, actorId: actor.usuarioId });
      }
      const zonasGuardadas = new Map(existente.zonas.map((z) => [z.sucursalId, z]));
      for (const z of comando.zonas) {
        const previa = zonasGuardadas.get(z.sucursalId);
        // Una zona ya cargada se identifica por su sucursal: conserva su `id` (el que trae el pedido solo vale para una zona nueva).
        const zona: ZonaDePortal = previa === undefined ? z : { ...z, id: previa.id };
        if (previa === undefined) await crearZona(tx, { portalId: existente.id, zona, ahora: actor.ahora });
        else if (!mismaZona(previa, zona)) {
          if (!(await cambiarZona(tx, { portalId: existente.id, zona, versionEsperada: previa.version, ahora: actor.ahora }))) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_VERSION_DESACTUALIZADA);
        } else continue;
        await auditarZonaDelPortal(tx, { zonaId: zona.id, anterior: previa ?? null, nueva: zona, actorId: actor.usuarioId });
      }
      return exito("Portal guardado.", { portalId: existente.id, codigo: existente.codigo, version: existente.version + 1, yaEstaba: false });
    },
    undefined,
    undefined,
    true,
  );
}
