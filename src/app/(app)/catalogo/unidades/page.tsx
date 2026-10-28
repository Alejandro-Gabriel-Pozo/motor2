import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { CajaDesplazable } from "@/components/catalogo/caja-desplazable";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_MAESTROS } from "@/core/catalogo/public";
import {
  crearUnidad,
  actualizarActivaUnidad,
  actualizarDecimalesUnidad,
  listarUnidadesParaPanel,
  detectarInsumosConUnidadMezclada,
} from "@/server/actions/catalogo/unidades";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

/**
 * Catálogo › Maestros › Unidades (DEC-13). Ver ≠ escribir (DEC-33): los decimales, «Activar/Desactivar» y el alta se dibujan con el «Editar» de `unidades` (la clave de sus tres comandos); quien solo ve
 * lee la tabla (los decimales como texto) con el aviso de solo lectura.
 */
/** Cómo se lee cada magnitud (la columna guarda la palabra en mayúsculas del esquema). */
const NOMBRE_DE_LA_MAGNITUD: Record<string, string> = { PESO: "Peso", VOLUMEN: "Volumen", CANTIDAD: "Cantidad" };

export default async function UnidadesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "unidades", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [unidades, mezclados, { editar: puedeEditar }] = await Promise.all([
    listarUnidadesParaPanel(),
    detectarInsumosConUnidadMezclada(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "unidades", ctx.db),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Maestros · Unidades de medida</h1>
        <FilaDeCatalogo ctx={ctx} etiqueta="Qué maestro" pestanas={PESTANAS_DE_MAESTROS} ruta="/catalogo/unidades" />
        {!puedeEditar && <AvisoSoloLecturaDeCatalogo que="las unidades de medida" />}
      </div>

      <CajaDesplazable etiqueta="Tabla de unidades de medida">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Nombre</th>
              <th>Magnitud</th>
              <th>Decimales</th>
              <th>Activa</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {unidades.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.nombre}</td>
                <td>{NOMBRE_DE_LA_MAGNITUD[u.magnitud]}</td>
                <td>
                  {puedeEditar ? (
                    <FormConResultado
                      accion={async (formData: FormData) => {
                        "use server";
                        // Vacío → NaN (la acción lo rechaza); con `Number("")` llegaría como 0 y se guardaría sin avisar.
                        const bruto = String(formData.get("decimales") ?? "").trim();
                        return actualizarDecimalesUnidad(u.id, bruto === "" ? NaN : Number(bruto));
                      }}
                      className="space-y-1"
                    >
                      <div className="flex items-center gap-1">
                        <div className="w-20">
                          <Campo name="decimales" type="number" required aria-label={`Decimales de ${u.nombre}`} min={0} max={6} defaultValue={u.decimales} />
                        </div>
                        <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                          Guardar
                        </BotonDeServidor>
                      </div>
                    </FormConResultado>
                  ) : (
                    u.decimales
                  )}
                </td>
                <td>{u.activa ? "Sí" : "No"}</td>
                <td>
                  {puedeEditar && (
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivaUnidad(u.id, !u.activa);
                      }}
                    >
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {u.activa ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CajaDesplazable>

      {puedeEditar && (
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return crearUnidad({
              nombre: String(formData.get("nombre") ?? ""),
              magnitud: formData.get("magnitud") as "PESO" | "VOLUMEN" | "CANTIDAD",
            });
          }}
          className="flex max-w-md flex-col gap-2"
        >
          <h2 className="font-medium">Nueva unidad</h2>
          <Campo aria-label="Nombre de la unidad" name="nombre" placeholder="nombre (ej. kg)" required />
          <Selector etiqueta="Magnitud" etiquetaOculta name="magnitud" required>
            <option value="PESO">Peso</option>
            <option value="VOLUMEN">Volumen</option>
            <option value="CANTIDAD">Cantidad</option>
          </Selector>
          <BotonDeServidor type="submit">Crear</BotonDeServidor>
        </FormConResultado>
      )}

      {mezclados.ok && mezclados.datos.length > 0 && (
        <div className="rounded border border-aviso bg-aviso-tinte p-3 text-sm">
          <h2 className="mb-2 font-medium">Insumos con unidad de stock mezclada</h2>
          <ul className="list-disc pl-5">
            {mezclados.datos.map((m) => (
              <li key={m.insumo}>
                {m.insumo}: {m.unidades.join(", ")} ({m.cantidadProductos} productos)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
