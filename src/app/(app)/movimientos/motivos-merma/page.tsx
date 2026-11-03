import { PanelDeMaestroSimple } from "@/components/stock/panel-de-maestro-simple";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearMotivoMerma, actualizarActivoMotivoMerma, listarMotivosMermaParaPanel } from "@/server/actions/movimientos/motivos";

/**
 * Administración del catálogo Motivo de Merma (antes una lista fija en el código, ui-config.ts; plan "motivos de Consumo/Merma como
 * catálogo administrable", 2026-09-23). Gateada por su propia clave `motivos_merma` (una clave por catálogo, 2026-09-30). Mismo patrón
 * que /catalogo/categorias: activar/desactivar en vez de borrar (Operacion.motivoId referencia estas filas con ON DELETE RESTRICT).
 */
export default async function MotivosMermaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_merma", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [motivos, { editar: puedeEditar }] = await Promise.all([
    listarMotivosMermaParaPanel(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_merma", ctx.db),
  ]);

  return (
    <PanelDeMaestroSimple
      ctx={ctx}
      titulo="Configuración · Motivos de merma"
      ruta="/movimientos/motivos-merma"
      quePuedeVer="los motivos de merma"
      items={motivos}
      puedeEditar={puedeEditar}
      activar={actualizarActivoMotivoMerma}
      crear={async (formData: FormData) => {
        "use server";
        return crearMotivoMerma(String(formData.get("nombre") ?? ""), String(formData.get("descripcion") ?? ""));
      }}
      etiquetaNombre="Nombre del motivo"
      placeholderNombre="nombre del motivo"
    />
  );
}
