import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarSucursalesParaEnviar } from "@/server/actions/traspasos/lecturas";
import { seccionesDesactivadas } from "@/server/consultas/movimientos/secciones-desactivadas";
import { EnviarForm } from "./enviar-form";

export default async function EnviarTraspasoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "traspaso_enviar_directo", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [sucursales, secciones, desactivadas] = await Promise.all([
    listarSucursalesParaEnviar(ctx.sucursalId),
    listarSeccionesActivas(ctx.sucursalId),
    // P17: una sección dada de baja solo admite SACAR mercadería: enviar a otra sucursal saca, así que se ofrece como origen.
    seccionesDesactivadas(ctx.sucursalId, ctx.db),
  ]);

  return (
    <div className="max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">Enviar una transferencia directo</h1>
      <p className="mb-4 text-sm text-tinta-tenue">
        Le mandás stock a otra sucursal sin que te lo pida (PUSH) — el stock sale de tu sección YA, al enviar. Queda &quot;Enviada&quot; hasta
        que la sucursal destino la acepte o la rechace.
      </p>
      <EnviarForm
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
        seccionesDesactivadas={desactivadas}
      />
    </div>
  );
}
