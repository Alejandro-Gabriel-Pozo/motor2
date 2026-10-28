import Link from "next/link";
import { redirect } from "next/navigation";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { CajaDesplazable } from "@/components/catalogo/caja-desplazable";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { actualizarActivaProveedor, listarProveedores } from "@/server/actions/catalogo/proveedores";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { IconoDeAccion } from "@/components/iconos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { claseDeBoton } from "@/ui/primitivas/boton";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";

/**
 * Lista de proveedores. Ya no comparte pantalla con el formulario: el alta
 * está en `/nuevo`, la ficha (solo lectura) en `/[id]` y la edición en
 * `/[id]/editar` — mismo patrón F1/F2 de Productos
 * (docs/grounding-lista-ver-editar-2026-09-18.md, F4).
 *
 * Ver ≠ escribir (DEC-33, Fase 7): «Editar» y «Activar/Desactivar» se dibujan con el «Editar» de `proveedores` (la clave de `actualizarProveedor` y `actualizarActivaProveedor`); el alta, con el de
 * `proveedor_alta`. Quien solo ve lee la lista con el aviso.
 */
export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  // Los enlaces y favoritos viejos apuntaban a `/catalogo/proveedores?editar=…` (la edición estaba en esta misma pantalla).
  if (editar) redirect(`/catalogo/proveedores/${encodeURIComponent(editar)}/editar`);

  // `/nuevo` exige `proveedor_alta`: quien solo ve proveedores no recibe el botón para descubrirlo recién al entrar.
  const [{ editar: puedeDarDeAlta }, { editar: puedeEditar }, proveedores] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedor_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db),
    listarProveedores(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Proveedores</h1>
        <div className="flex flex-wrap items-center gap-4">
          <EnlaceInterno href="/catalogo/proveedores/comparativa" className="text-sm underline">
            Comparativa de precios →
          </EnlaceInterno>
          {puedeDarDeAlta && (
            <Link href="/catalogo/proveedores/nuevo" className={claseDeBoton()}>
              + Nuevo proveedor
            </Link>
          )}
        </div>
      </div>

      {!puedeEditar && !puedeDarDeAlta && <AvisoSoloLecturaDeCatalogo que="los proveedores" />}

      <CajaDesplazable etiqueta="Tabla de proveedores">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Activo</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {proveedores.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.codigo}</td>
                <td>
                  <Link href={`/catalogo/proveedores/${p.id}`} className="underline">
                    {p.nombre}
                  </Link>
                </td>
                <td>{p.contacto ?? "—"}</td>
                <td>{p.activo ? "Sí" : "No"}</td>
                <td className="py-2">
                  {puedeEditar && (
                    <div className="flex gap-3">
                      <Link href={`/catalogo/proveedores/${p.id}/editar`} className="text-sm underline inline-flex items-center gap-1">
                        <IconoDeAccion id="editar" />
                        Editar
                      </Link>
                      <FormConResultado
                        accion={async () => {
                          "use server";
                          return actualizarActivaProveedor(p.id, !p.activo);
                        }}
                      >
                        <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                          <IconoDeAccion id="activar" />
                          {p.activo ? "Desactivar" : "Activar"}
                        </BotonDeServidor>
                      </FormConResultado>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!proveedores.length && (
              <tr>
                <td className="py-2 text-tinta-tenue" colSpan={5}>
                  Sin proveedores.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CajaDesplazable>
    </div>
  );
}
