import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeAlgunaDelMenu, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_MAESTROS } from "@/core/catalogo/public";
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

/**
 * Catálogo › Maestros (Fase 7, DEC-13; diseño en `docs/diseno-modulo-catalogo-2026-10-28.md` §8): la entrada del menú y su primera pestaña, «Insumos» (con el árbol de grupos). La entrada reúne las cuatro
 * tablas de base de la empresa, así que la guarda es la de «alguna de» con el cálculo del menú; las claves son las del `algunaDe` del ítem del menú (un test lo comprueba). La tabla de insumos tiene su
 * propia guarda, la de siempre (`grupos_familia`); sin su «Ver», la fila de pestañas lleva a lo que el rol sí ve.
 *
 * Ver ≠ escribir (DEC-33): cada control se dibuja con el «Editar» de LA clave que exige su comando: el grupo de un insumo, «Activar/Desactivar» y el árbol de grupos con `grupos_familia`; el alta con
 * `insumo_alta`; renombrar (o fusionar) con `insumo_renombrar_fusionar`. Quien no puede ninguno lee las tablas con el aviso de solo lectura.
 */
export default async function InsumosGruposPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeAlgunaDelMenu(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, ["grupos_familia", "categorias", "unidades", "margen_objetivo_editar"], ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const fila = <FilaDeCatalogo ctx={ctx} etiqueta="Qué maestro" pestanas={PESTANAS_DE_MAESTROS} ruta="/catalogo/insumos-grupos" visibles={gate.visibles} />;
  // La tabla de insumos (y sus lecturas, `listarInsumos` y `listarGrupos`) se protege con SU clave, como antes de ser la entrada de Maestros.
  const gateInsumos = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_familia", ctx.db);
  if (!gateInsumos.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Maestros</h1>
        {fila}
        <p className="text-sm text-tinta-suave">Tu rol no ve los insumos. Elegí arriba qué maestro abrir.</p>
      </div>
    );
  }

  const [insumos, grupos, { editar: puedeEditarGrupos }, { editar: puedeDarDeAlta }, { editar: puedeRenombrar }] = await Promise.all([
    listarInsumos(),
    listarGrupos(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_familia", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "insumo_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "insumo_renombrar_fusionar", ctx.db),
  ]);
  // El árbol se lee UNA vez (antes: una lectura por nivel y por grupo).
  const cadenas = await cadenasDeGrupos(grupos.map((g) => g.id), ctx.db);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="mb-1 text-xl font-semibold">Maestros · Insumos</h1>
          <p className="text-sm text-tinta-tenue">
            Un insumo junta los productos que para el negocio son lo mismo aunque cada proveedor los llame distinto (por ejemplo, «Ojo de bife»). El grupo los ordena en un árbol.
          </p>
        </div>
        {fila}
        {!puedeEditarGrupos && !puedeDarDeAlta && !puedeRenombrar && <AvisoSoloLecturaDeCatalogo que="los insumos y sus grupos" />}
      </div>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <section className="space-y-6">
          <h2 className="text-lg font-semibold">Insumos</h2>
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
                      {puedeRenombrar ? <FormRenombrarInsumo insumoId={i.id} nombreActual={i.nombre} /> : i.nombre}
                    </td>
                    <td className="px-2 py-2">
                      {puedeEditarGrupos ? (
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
                      ) : (
                        i.grupo?.nombre ?? <span className="text-tinta-tenue">Sin grupo</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{i.activo ? "Sí" : "No"}</td>
                    <td className="px-2 py-2">
                      {puedeEditarGrupos && (
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
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {puedeDarDeAlta && (
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
          )}
        </section>

        <section className="space-y-6">
          <h2 className="text-lg font-semibold">Árbol de grupos</h2>
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
                      {puedeEditarGrupos && (
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
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {puedeEditarGrupos && (
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
          )}
        </section>
      </div>
    </div>
  );
}
