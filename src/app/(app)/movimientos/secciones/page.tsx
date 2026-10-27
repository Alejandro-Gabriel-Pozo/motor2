import { IconoDeAccion } from "@/components/iconos";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
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

  const [secciones, { editar: puedeEditar }] = await Promise.all([
    listarSeccionesParaPanel(ctx.sucursalId),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "secciones", ctx.db),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Configuración · Depósitos</h1>
        <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta="/movimientos/secciones" />
        {/* DEC-33: con «Ver» solo, la tabla sin formularios ni botones (el servidor rechaza igual cualquier cambio). */}
        {!puedeEditar && <AvisoSoloLecturaDeStock que="los depósitos" />}
        <p className="text-sm text-tinta-suave">
          Si un depósito no sirve de respaldo, las ventas del salón solo lo usan cuando es el depósito habitual de un producto.
        </p>
      </div>

      <div role="region" aria-label="Depósitos de esta sucursal" tabIndex={0} className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Nombre</th>
              <th>Activo</th>
              <th>Respaldo automático en ventas</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {secciones.map((s) => (
              <tr key={s.id} className="border-b align-top">
                <td className="py-2">
                  {puedeEditar ? (
                    <FormConResultado
                      accion={async (formData: FormData) => {
                        "use server";
                        return renombrarSeccion(s.id, String(formData.get("nombre") ?? ""));
                      }}
                      className="flex gap-1"
                    >
                      <div className="w-40">
                        <Campo name="nombre" aria-label={`Nombre del depósito "${s.nombre}"`} defaultValue={s.nombre} tamano="compacto" />
                      </div>
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="editar" />
                        Renombrar
                      </BotonDeServidor>
                    </FormConResultado>
                  ) : (
                    s.nombre
                  )}
                </td>
                <td>{s.activa ? "Sí" : "No"}</td>
                <td>
                  {/* Sí/No y su botón en la MISMA celda (el flex va en el form, no en el <td>): la celda «Activa» sigue siendo la única que dice solo «Sí»/«No». */}
                  {puedeEditar ? (
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
                  ) : (
                    <span>{s.sirveDeRespaldoEnVentas ? "Sí" : "No"}</span>
                  )}
                </td>
                <td>
                  {puedeEditar && (
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
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {puedeEditar && (
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return crearSeccion(String(formData.get("nombre") ?? ""));
          }}
          className="flex max-w-md gap-2"
        >
          <div className="flex-1">
            <Campo name="nombre" aria-label="Nombre del depósito" placeholder="nombre del depósito" required />
          </div>
          <BotonDeServidor type="submit">Crear</BotonDeServidor>
        </FormConResultado>
      )}
    </div>
  );
}
