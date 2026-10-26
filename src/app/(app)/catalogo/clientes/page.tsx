import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { altaCliente, actualizarActivoCliente, actualizarCliente, listarClientes } from "@/server/actions/clientes/cliente";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";

/**
 * Catálogo de Clientes con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md): un único % fijo por cliente (D1, no
 * varía por categoría de producto), que un mozo asigna a una cuenta desde el salón (`asignarClienteACuenta`) y que se aplica al
 * cerrarla (`precioConDescuento`). Mismo molde de una sola pantalla que Categorías (lista + alta al pie); a diferencia de esa, acá
 * el nombre SÍ se puede corregir (no hay un "código" separado que sea la identidad) — con un `<details>` de edición inline por
 * fila, sin una ruta `/editar` aparte (dos campos no ameritan una pantalla propia).
 */
export default async function ClientesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "clientes", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const clientes = await listarClientes();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Clientes con descuento</h1>
        <p className="text-sm text-tinta-tenue">Un % fijo de descuento por cliente, que un mozo asigna a la cuenta de una mesa desde el salón.</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
            <th className="py-2">Nombre</th>
            <th className="text-right">Descuento</th>
            <th>Activo</th>
            <th>
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-b align-top">
              <td className="py-2">{c.nombre}</td>
              <td className="text-right tabular-nums">{Number(c.descuentoPorcentaje).toLocaleString("es-AR")}%</td>
              <td>{c.activo ? "Sí" : "No"}</td>
              <td className="py-2">
                <div className="flex flex-col gap-1">
                  <details>
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-sm underline"><IconoDeAccion id="editar" />Editar</summary>
                    <FormConResultado
                      accion={async (formData: FormData) => {
                        "use server";
                        const r = await actualizarCliente(c.id, String(formData.get("nombre") ?? ""), formData.get("descuentoPorcentaje"));
                        if (r.ok) refrescarVistaSiHaceFalta();
                        return r;
                      }}
                      className="mt-2 flex flex-col gap-2 rounded border p-2"
                    >
                      <Campo etiqueta="Nombre" name="nombre" defaultValue={c.nombre} required />
                      <Campo etiqueta="% de descuento" name="descuentoPorcentaje" defaultValue={Number(c.descuentoPorcentaje).toString()} required />
                      <BotonDeServidor type="submit" tamano="chico" className="self-start">
                        Guardar
                      </BotonDeServidor>
                    </FormConResultado>
                  </details>
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return actualizarActivoCliente(c.id, !c.activo);
                    }}
                  >
                    <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                      <IconoDeAccion id="activar" />
                      {c.activo ? "Desactivar" : "Activar"}
                    </BotonDeServidor>
                  </FormConResultado>
                </div>
              </td>
            </tr>
          ))}
          {!clientes.length && (
            <tr>
              <td className="py-2 text-tinta-tenue" colSpan={4}>
                Sin clientes.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <FormConResultado
        accion={async (formData: FormData) => {
          "use server";
          const r = await altaCliente(String(formData.get("nombre") ?? ""), formData.get("descuentoPorcentaje"));
          if (r.ok) refrescarVistaSiHaceFalta();
          return r;
        }}
        className="max-w-md space-y-1"
      >
        <div className="flex gap-2">
          <div className="flex-1">
            <Campo aria-label="Nombre del cliente" name="nombre" placeholder="nombre del cliente" required />
          </div>
          <div className="w-32">
            <Campo aria-label="% de descuento" name="descuentoPorcentaje" placeholder="% descuento" required />
          </div>
          <BotonDeServidor type="submit">Crear</BotonDeServidor>
        </div>
      </FormConResultado>
    </div>
  );
}
