import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
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
import { textoCadenaDeGrupos } from "@/core/catalogo/public-servidor";
import { FormRenombrarInsumo } from "@/components/catalogo/form-renombrar-insumo";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function InsumosGruposPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_familia", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [insumos, grupos] = await Promise.all([listarInsumos(), listarGrupos()]);
  const cadenas = await Promise.all(grupos.map((g) => textoCadenaDeGrupos(g.id, ctx.db)));

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
              <tr className="border-b text-left text-neutral-500">
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
                        <select name="grupoId" aria-label={`Grupo de ${i.nombre}`} defaultValue={i.grupoId ?? ""} className="rounded border px-2 py-1">
                          <option value="">Sin grupo</option>
                          {grupos.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.nombre}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="text-sm underline">
                          Guardar
                        </button>
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
                      <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                        <IconoDeAccion id="activar" />
                        {i.activo ? "Desactivar" : "Activar"}
                      </button>
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
            <input name="nombre" placeholder="nombre del insumo" required className="flex-1 rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Crear
            </button>
          </div>
        </FormConResultado>
      </section>

      <section className="space-y-6">
        <h1 className="text-xl font-semibold">Árbol de grupos</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
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
                      <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                        <IconoDeAccion id="activar" />
                        {g.activo ? "Desactivar" : "Activar"}
                      </button>
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
          <input name="nombre" placeholder="nombre del grupo (nuevo o existente)" required className="rounded border px-3 py-2" />
          <select name="grupoPadreId" aria-label="Grupo padre" className="rounded border px-3 py-2">
            <option value="">Sin padre (raíz)</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Guardar
          </button>
        </FormConResultado>
      </section>
    </div>
  );
}
