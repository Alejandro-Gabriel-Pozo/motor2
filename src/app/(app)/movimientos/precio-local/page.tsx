import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarPreciosLocales, setPrecioLocalProducto } from "@/server/actions/movimientos/precio-local";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { FormConResultado } from "@/components/form-con-resultado";
import { PrecioLocalForm } from "./precio-local-form";
import { fijarPrecioLocalDeOpcion } from "@/server/actions/catalogo/opciones-por-sucursal";
import { cargarGrillaDeTamanosDeLaSucursal } from "@/server/consultas/catalogo/opciones-por-sucursal";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { formatearMonto } from "@/core/pos/public";

export default async function PrecioLocalPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [precios, tamanos] = await Promise.all([listarPreciosLocales(ctx.sucursalId), cargarGrillaDeTamanosDeLaSucursal(ctx.db, ctx.sucursalId)]);
  const sucursalId = ctx.sucursalId;

  return (
    // minmax(0,1fr) y no 1fr: un `1fr` pelado tiene mínimo automático (el ancho mínimo de la tabla) y, junto a los 380 px del formulario, empujaba la
    // PÁGINA a scroll horizontal a 1024 px. Con minmax(0,…) la tabla se achica a su columna y, si no entra, scrollea dentro de su contenedor.
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Precio local (override por sucursal del precio de venta)</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Producto</th>
                <th>Precio local</th>
                <th>Precio global</th>
                <th>Habilitado</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {precios.map((p) => {
                // Primitivos fuera del closure: lo que captura un closure "use server" viaja al cliente, y un Decimal de Prisma no puede
                // viajar ("Only plain objects can be passed to Client Components...", warning del servidor de desarrollo).
                const { productoId, habilitado } = p;
                const precio = Number(p.precio);
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-2">{p.producto.nombre}</td>
                    <td>{precio}</td>
                    <td>{Number(p.producto.precioVenta)}</td>
                    <td>{habilitado ? "Sí" : "No"}</td>
                    <td>
                      <FormConResultado
                        accion={async () => {
                          "use server";
                          const r = await setPrecioLocalProducto(productoId, precio, !habilitado);
                          // El refresco se pide ACÁ y no en la acción: la acción también la usa el formulario cliente de alta, que ya hace su propio
                          // router.refresh() (ver refrescar.ts). Sin esto la columna «Habilitado» no cambiaba hasta recargar a mano.
                          // Solo si salió bien: con un error no cambió nada.
                          if (r.ok) refrescarVistaSiHaceFalta();
                          return r;
                        }}
                      >
                        <button type="submit" className="text-sm underline">
                          {habilitado ? "Deshabilitar" : "Habilitar"}
                        </button>
                      </FormConResultado>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <PrecioLocalForm sucursalId={ctx.sucursalId} />
      </div>

      {/* GO-2d (ADR-030 §5): el precio de cada TAMAÑO que un producto cobra con precio propio, en esta sucursal. Vacío = rige el de la empresa. */}
      <section aria-labelledby="titulo-precios-por-tamano" className="flex flex-col gap-3 lg:col-span-2">
        <h2 id="titulo-precios-por-tamano" className="text-lg font-medium">
          Precios por tamaño en esta sucursal
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Solo los tamaños que un producto cobra con precio propio. Si no cargás nada, en «{ctx.sucursalNombre}» rige el precio de la empresa.
        </p>
        {tamanos.length === 0 ? (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
            Ningún producto disponible acá cobra sus tamaños con precio propio.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Precios por tamaño en esta sucursal</caption>
              <thead>
                <tr className="border-b text-left text-neutral-600 dark:text-neutral-400">
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Producto y tamaño
                  </th>
                  <th scope="col" className="pr-2 font-medium">
                    Precio de la empresa
                  </th>
                  <th scope="col" className="pr-2 font-medium">
                    En esta sucursal
                  </th>
                  <th scope="col" className="font-medium">
                    Habilitado
                  </th>
                </tr>
              </thead>
              <tbody>
                {tamanos.map((t) => {
                  const { productoId, opcionId } = t;
                  const esperado = t.enLaSucursal ? { precio: t.enLaSucursal.precio, habilitado: t.enLaSucursal.habilitado } : null;
                  const etiqueta = `${t.productoNombre} · ${t.opcionNombre}`;
                  return (
                    <tr key={`${productoId}-${opcionId}`} className="border-b align-top" data-tamano={etiqueta}>
                      <td className="py-2 pr-2">
                        {t.productoNombre} · <span className="font-medium">{t.opcionNombre}</span> <span className="text-neutral-600 dark:text-neutral-400">({t.grupoNombre})</span>
                      </td>
                      <td className="py-2 pr-2 tabular-nums">{t.precioDeLaEmpresa === null ? "Sin precio" : formatearMonto(t.precioDeLaEmpresa)}</td>
                      <td className="py-2 pr-2">
                        <FormConResultado
                          ofrecerRecargar
                          accion={async (formData: FormData) => {
                            "use server";
                            return fijarPrecioLocalDeOpcion({ sucursalId, productoId, opcionId, esperado, precio: numeroDelCampo(String(formData.get("precio") ?? "")) ?? Number.NaN });
                          }}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <label htmlFor={`tamano-${productoId}-${opcionId}`} className="sr-only">
                              Precio de {etiqueta} en esta sucursal
                            </label>
                            <CampoNumero id={`tamano-${productoId}-${opcionId}`} name="precio" defaultValue={t.enLaSucursal?.habilitado ? String(t.enLaSucursal.precio) : ""} prefijo="$" tipo="importe" etiqueta="El precio" tamano="compacto" required className="w-32" />
                            {/* Un botón por tamaño: el nombre accesible dice cuál (varios «Guardar» iguales en la misma pantalla no se distinguen con un lector de pantalla). */}
                            <button type="submit" className="min-h-[44px] text-sm underline" aria-label={`Guardar el precio de ${etiqueta}`}>
                              Guardar
                            </button>
                          </div>
                        </FormConResultado>
                      </td>
                      <td className="py-2">
                        {/* El formulario se dibuja siempre (aunque no haya nada que dar de baja) para que su mensaje siga a la vista después de volver al precio de la empresa. */}
                        <FormConResultado
                          ofrecerRecargar
                          accion={async () => {
                            "use server";
                            return fijarPrecioLocalDeOpcion({ sucursalId, productoId, opcionId, esperado, precio: null });
                          }}
                        >
                          <span className="mr-2">{t.enLaSucursal?.habilitado ? "Sí" : "No"}</span>
                          {t.enLaSucursal?.habilitado && (
                            <button type="submit" className="min-h-[44px] text-sm underline" aria-label={`Volver al de la empresa en ${etiqueta}`}>
                              Volver al de la empresa
                            </button>
                          )}
                        </FormConResultado>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
