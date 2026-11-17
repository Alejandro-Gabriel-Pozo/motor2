import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { tarjetasDelUsuario } from "@/server/acceso/menu";

/**
 * Pantalla de inicio (como la de Pedernal): título, dónde estás y la ranura «Lo que falta». Es a donde se entra y a donde apunta «Motor2»; solo quien tiene únicamente el salón entra directo al mapa de
 * mesas. Sin ninguna pantalla habilitada en el menú (la misma consulta de permisos), explica por qué (el rol no tiene pantallas habilitadas) en vez de dejar un mensaje de «no tenés permiso» en alguna página.
 */
export default async function InicioPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const tarjetas = await tarjetasDelUsuario(ctx);

  if (tarjetas.length === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">Todavía no tenés pantallas habilitadas</h1>
        <p className="text-sm text-tinta-tenue">
          Tu rol no tiene permiso para ver ninguna sección en esta sucursal. Pedile a un admin que te lo habilite desde Administración → Permisos.
        </p>
      </div>
    );
  }

  // Inicio como el de Pedernal (`PantallaDeInicio.tsx`, ZuluHub-ERP): el título, dónde estás y la ranura «Lo que falta». Los accesos a cada módulo van en el menú (que arma la misma consulta de
  // permisos); `tarjetas` solo decide si hay algo habilitado. Pedernal además avisa cuando la empresa no opera: acá ese corte lo hace la guarda de la empresa antes de llegar a esta pantalla.
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Inicio</h1>
      <p>Estás en {ctx.empresaNombre}.</p>
      <section aria-labelledby="pendientes-titulo" className="space-y-2">
        <h2 id="pendientes-titulo" className="text-lg font-semibold">
          Lo que falta
        </h2>
        {/* SUPUESTO(DEC-0026): Motor2 todavía no tiene un módulo que aporte pendientes a esta ranura; mientras tanto siempre dice que no hay nada (el texto es el de Pedernal). */}
        <p className="text-tinta-suave">No hay nada pendiente por ahora.</p>
      </section>
    </div>
  );
}
