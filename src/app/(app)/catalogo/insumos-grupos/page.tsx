import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import {
  crearInsumo,
  actualizarActivoInsumo,
  actualizarGrupoDeInsumo,
  crearOActualizarGrupo,
  actualizarActivoGrupo,
  listarInsumos,
  listarGrupos,
} from "@/server/actions/catalogo/insumos";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { cadenasDeGrupos } from "@/server/consultas/catalogo/grupos";
import { FormRenombrarInsumo } from "@/components/catalogo/form-renombrar-insumo";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

export default async function InsumosGruposPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_familia", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [insumos, grupos] = await Promise.all([listarInsumos(), listarGrupos()]);
  // El árbol se lee UNA vez (antes: una lectura por nivel y por grupo).
  const cadenas = await cadenasDeGrupos(grupos.map((g) => g.id), ctx.db);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      <section className="space-y-6">
        <h1 className="text-xl font-semibold">Insumos</h1>
        {/* Cada tabla va en su propio contenedor con scroll: a 1280 px la de Insumos no entra en media pantalla y, sin esto, se salía de su
            sección y se pintaba ENCIMA de la de grupos (que viene después en el DOM), que se quedaba con los clics de «Desactivar». Mismo patrón que
            capacidades-sucursal y permisos-matriz. Lo cubre test/e2e/catalogo-insumos-grupos-maquetacion.spec.ts: sacar este contenedor reintroduce el bug. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th className="px-2 py-2 first:pl-0">Nombre</th>
                <th className="px-2">Grupo</th>
                <th className="px-2">Activo</th>
                <th className="px-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {insumos.map((i) => (
                <tr key={i.id} className="border-b align-top">
                  <td className="px-2 py-2 first:pl-0">
                    <FormRenombrarInsumo insumoId={i.id} nombreActual={i.nombre} />
                  </td>
                  <td className="px-2 py-2">
                    <FormConResultado
                      accion={async (formData: FormData) => {
                        "use server";
                        const grupoId = String(formData.get("grupoId") ?? "");
                        return actualizarGrupoDeInsumo(i.id, grupoId || null);
                      }}
                      className="space-y-1"
                    >
                      <div className="flex gap-1">
                        <div className="min-w-0">
                          <Selector etiqueta={`Grupo de ${i.nombre}`} etiquetaOculta name="grupoId" defaultValue={i.grupoId ?? ""}>
                            <option value="">Sin grupo</option>
                            {grupos.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.nombre}
                              </option>
                            ))}
                          </Selector>
                        </div>
                        <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                          Guardar
                        </BotonDeServidor>
                      </div>
                    </FormConResultado>
                  </td>
                  <td className="px-2 py-2">{i.activo ? "Sí" : "No"}</td>
                  <td className="px-2 py-2">
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivoInsumo(i.id, !i.activo);
                      }}
                    >
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {i.activo ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            const r = await crearInsumo(String(formData.get("nombre") ?? ""));
            // El refresco se pide ACÁ y no en la acción: la acción también la usan el alta rápida y el AsistenteHermanar del formulario de Producto (ver refrescar.ts).
            // Solo si salió bien: con un error no cambió nada y no hay nada que redibujar.
            if (r.ok) refrescarVistaSiHaceFalta();
            return r;
          }}
          className="max-w-md space-y-1"
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <Campo aria-label="Nombre del insumo" name="nombre" placeholder="nombre del insumo" required />
            </div>
            <BotonDeServidor type="submit">Crear</BotonDeServidor>
          </div>
        </FormConResultado>
      </section>

      <section className="space-y-6">
        <h1 className="text-xl font-semibold">Árbol de grupos</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th className="px-2 py-2 first:pl-0">Cadena</th>
                <th className="px-2">Activo</th>
                <th className="px-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, idx) => (
                <tr key={g.id} className="border-b">
                  <td className="px-2 py-2 first:pl-0">{cadenas[idx]}</td>
                  <td className="px-2 py-2">{g.activo ? "Sí" : "No"}</td>
                  <td className="px-2 py-2">
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivoGrupo(g.id, !g.activo);
                      }}
                    >
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {g.activo ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            const grupoPadreId = String(formData.get("grupoPadreId") ?? "");
            return crearOActualizarGrupo(String(formData.get("nombre") ?? ""), grupoPadreId || null);
          }}
          className="flex max-w-md flex-col gap-2"
        >
          <h2 className="font-medium">Nuevo grupo / actualizar padre</h2>
          <Campo aria-label="Nombre del grupo" name="nombre" placeholder="nombre del grupo (nuevo o existente)" required />
          <Selector etiqueta="Grupo padre" etiquetaOculta name="grupoPadreId">
            <option value="">Sin padre (raíz)</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </Selector>
          <BotonDeServidor type="submit">Guardar</BotonDeServidor>
        </FormConResultado>
      </section>
    </div>
  );
}
