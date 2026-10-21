import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { crearSeccion, actualizarActivaSeccion, actualizarRespaldoSeccion, renombrarSeccion, listarSeccionesParaPanel } from "@/server/actions/movimientos/secciones";
import { FormConResultado } from "@/components/form-con-resultado";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";

export default async function SeccionesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "secciones", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const secciones = await listarSeccionesParaPanel(ctx.sucursalId);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Secciones (depósitos/ubicaciones de esta sucursal)</h1>
        <p className="text-sm text-tinta-suave">
          Si una sección no sirve de respaldo, las ventas del salón solo la usan cuando es la sección habitual de un producto.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
            <th className="py-2">Nombre</th>
            <th>Activa</th>
            <th>Respaldo automático en ventas</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {secciones.map((s) => (
            <tr key={s.id} className="border-b align-top">
              <td className="py-2">
                <FormConResultado
                  accion={async (formData: FormData) => {
                    "use server";
                    return renombrarSeccion(s.id, String(formData.get("nombre") ?? ""));
                  }}
                  className="flex gap-1"
                >
                  <div className="w-40">
                    <Campo name="nombre" aria-label={`Nombre de la sección "${s.nombre}"`} defaultValue={s.nombre} tamano="compacto" />
                  </div>
                  <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                    <IconoDeAccion id="editar" />
                    Renombrar
                  </BotonDeServidor>
                </FormConResultado>
              </td>
              <td>{s.activa ? "Sí" : "No"}</td>
              <td>
                {/* Sí/No y su botón en la MISMA celda (el flex va en el form, no en el <td>): la celda «Activa» sigue siendo la única que dice solo «Sí»/«No». */}
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarRespaldoSeccion(s.id, !s.sirveDeRespaldoEnVentas);
                  }}
                  className="flex items-baseline gap-2"
                >
                  <span>{s.sirveDeRespaldoEnVentas ? "Sí" : "No"}</span>
                  <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                    {s.sirveDeRespaldoEnVentas ? "Quitar del respaldo" : "Usar de respaldo"}
                  </BotonDeServidor>
                </FormConResultado>
              </td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivaSeccion(s.id, !s.activa);
                  }}
                >
                  <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                    <IconoDeAccion id="activar" />
                    {s.activa ? "Desactivar" : "Activar"}
                  </BotonDeServidor>
                </FormConResultado>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <FormConResultado
        accion={async (formData: FormData) => {
          "use server";
          return crearSeccion(String(formData.get("nombre") ?? ""));
        }}
        className="flex max-w-md gap-2"
      >
        <div className="flex-1">
          <Campo name="nombre" aria-label="Nombre de la sección" placeholder="nombre de la sección" required />
        </div>
        <BotonDeServidor type="submit">Crear</BotonDeServidor>
      </FormConResultado>
    </div>
  );
}
