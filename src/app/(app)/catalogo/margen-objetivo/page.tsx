import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { CajaDesplazable } from "@/components/catalogo/caja-desplazable";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_MAESTROS } from "@/core/catalogo/public";
import { FOOD_COST_OBJETIVO_PCT, resolverObjetivoFoodCost } from "@/core/reportes/public";
import { cargarObjetivosDeMargen } from "@/server/consultas/reportes/margen-objetivo-consulta";
import { guardarMargenObjetivo } from "@/server/actions/reportes/margen-objetivo";
import { listarCategoriasActivas } from "@/server/consultas/catalogo/categorias";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";

/**
 * Catálogo › Maestros › Margen objetivo (DEC-13). Ver ≠ escribir (DEC-33): los campos se dibujan con el «Editar» de `margen_objetivo_editar` (la clave de `guardarMargenObjetivo`); quien solo ve lee los
 * objetivos como texto, con el aviso de solo lectura.
 */
export default async function MargenObjetivoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "margen_objetivo_editar", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [objetivos, categorias, { editar: puedeEditar }] = await Promise.all([
    cargarObjetivosDeMargen(ctx.db),
    listarCategoriasActivas(ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "margen_objetivo_editar", ctx.db),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Maestros · Margen objetivo (food cost)</h1>
        <FilaDeCatalogo ctx={ctx} etiqueta="Qué maestro" pestanas={PESTANAS_DE_MAESTROS} ruta="/catalogo/margen-objetivo" />
        <p className="max-w-2xl text-sm text-tinta-tenue">
          El food cost objetivo es el porcentaje del precio de venta (el de la carta, con IVA incluido) que puede irse en comida y bebida, sin contar el packaging ni la limpieza.
          Con él, el reporte de Costos marca «Food cost alto» y calcula el precio mínimo de cada plato. Rige el de la categoría del producto; si la categoría no
          tiene uno, el de la empresa; y si la empresa tampoco, {FOOD_COST_OBJETIVO_PCT} %. Dejá el campo vacío para volver al objetivo que corresponde.
        </p>
        {!puedeEditar && <AvisoSoloLecturaDeCatalogo que="el margen objetivo" />}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">De toda la empresa</h2>
        {puedeEditar ? (
          <FormConResultado
            accion={async (formData: FormData) => {
              "use server";
              return guardarMargenObjetivo(null, String(formData.get("porcentaje") ?? ""));
            }}
            className="max-w-md space-y-1"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="objetivo-empresa" className="text-sm">
                Food cost objetivo (%)
              </label>
              <div className="w-40">
                <Campo nombradoPorFuera id="objetivo-empresa" name="porcentaje" inputMode="decimal" defaultValue={objetivos.empresaPct ?? ""} placeholder={`${FOOD_COST_OBJETIVO_PCT} (por defecto)`} />
              </div>
              <BotonDeServidor type="submit">Guardar</BotonDeServidor>
            </div>
          </FormConResultado>
        ) : (
          <p className="text-sm">
            Food cost objetivo: {(objetivos.empresaPct ?? FOOD_COST_OBJETIVO_PCT).toLocaleString("es-AR")} %{objetivos.empresaPct === null ? " (el que rige por defecto)" : ""}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Por categoría</h2>
        {categorias.length === 0 ? (
          <p className="text-sm text-tinta-tenue">Todavía no hay categorías activas.</p>
        ) : (
          <CajaDesplazable etiqueta="Tabla del margen objetivo por categoría">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-tinta-tenue">
                  <th className="py-2">Categoría</th>
                  <th>Rige</th>
                  <th>Objetivo propio (%)</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2">{c.nombre}</td>
                    <td>{resolverObjetivoFoodCost(objetivos, c.id)} %</td>
                    <td>
                      {puedeEditar ? (
                        <FormConResultado
                          accion={async (formData: FormData) => {
                            "use server";
                            return guardarMargenObjetivo(c.id, String(formData.get("porcentaje") ?? ""));
                          }}
                        >
                          <div className="flex items-center gap-2 py-1">
                            <div className="w-40">
                              <Campo
                                name="porcentaje"
                                aria-label={`Food cost objetivo de ${c.nombre} (%)`}
                                inputMode="decimal"
                                defaultValue={objetivos.porCategoria.get(c.id) ?? ""}
                                placeholder="el de la empresa"
                              />
                            </div>
                            <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                              Guardar
                            </BotonDeServidor>
                          </div>
                        </FormConResultado>
                      ) : objetivos.porCategoria.has(c.id) ? (
                        `${objetivos.porCategoria.get(c.id)?.toLocaleString("es-AR")} %`
                      ) : (
                        <span className="text-tinta-tenue">El de la empresa</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CajaDesplazable>
        )}
      </section>
    </div>
  );
}
