import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { RUTA_SECCIONES } from "@/core/carta/public";

/**
 * El viejo tablero «Parametrización» de la carta (CARTA-MANT): desde DEC-24 (Fase 7) lo reemplazan las tres entradas del menú (Carta, Promociones, Apariencia y publicación) con sus pestañas. La URL
 * sigue respondiendo (marcadores, enlaces viejos): con el «Ver» de la carta manda a «Carta › Secciones y géneros».
 */
export default async function ParametrizacionDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  redirect(RUTA_SECCIONES);
}
