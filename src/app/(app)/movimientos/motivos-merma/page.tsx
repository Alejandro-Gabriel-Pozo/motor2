import { IconoDeAccion } from "@/components/iconos";
import { FilaDeStock } from "@/components/fila-de-stock";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearMotivoMerma, actualizarActivoMotivoMerma, listarMotivosMermaParaPanel } from "@/server/actions/movimientos/motivos";
import { FormConResultado } from "@/components/form-con-resultado";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";

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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Configuración · Motivos de merma</h1>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta="/movimientos/motivos-merma" />
      {!puedeEditar && <AvisoSoloLecturaDeStock que="los motivos de merma" />}

      <section className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Nombre</th>
              <th>Activo</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {motivos.map((m) => (
              <tr key={m.id} className="border-b align-top">
                <td className="py-2">
                  <div>{m.nombre}</div>
                  {m.descripcion && <div className="text-xs text-tinta-tenue">{m.descripcion}</div>}
                </td>
                <td>{m.activo ? "Sí" : "No"}</td>
                <td>
                  {puedeEditar && (
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivoMotivoMerma(m.id, !m.activo);
                      }}
                    >
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {m.activo ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {puedeEditar && (
          <FormConResultado
            accion={async (formData: FormData) => {
              "use server";
              return crearMotivoMerma(String(formData.get("nombre") ?? ""), String(formData.get("descripcion") ?? ""));
            }}
            className="max-w-md space-y-1"
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <Campo name="nombre" aria-label="Nombre del motivo" placeholder="nombre del motivo" required />
              </div>
              <BotonDeServidor type="submit">Crear</BotonDeServidor>
            </div>
            <Campo name="descripcion" aria-label="Descripción (opcional)" placeholder="descripción (opcional)" />
          </FormConResultado>
        )}
      </section>
    </div>
  );
}
