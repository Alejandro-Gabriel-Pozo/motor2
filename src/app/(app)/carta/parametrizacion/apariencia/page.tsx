import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeAlgunaDelMenu } from "@/server/acceso/gate";
import { PESTANAS_DE_APARIENCIA, primeraPantallaVisible } from "@/core/carta/public";

/**
 * DEC-24 (Fase 7): la entrada «Apariencia y publicación» del menú. Antes era un tablero con dos enlaces (Tema y Portal); ahora esas dos pantallas son las pestañas de la entrada, así que esta página solo
 * decide a cuál mandar: la primera que el rol puede abrir (el tema es de la sucursal, el portal de la empresa: la guarda evalúa cada clave en su contexto, con el mismo cálculo del ítem del menú).
 */
export default async function AparienciaDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeAlgunaDelMenu(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, ["carta_tema", "carta_portal"], ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const destino = primeraPantallaVisible(PESTANAS_DE_APARIENCIA, gate.visibles);
  if (destino) redirect(destino);
  return <p className="text-error">No tenés permiso para ver esta sección.</p>;
}
