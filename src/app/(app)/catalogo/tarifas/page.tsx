import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearGrupoDePrecio, editarGrupoDePrecio, fijarPrecioLocalDeCombinacion } from "@/server/actions/catalogo/combinaciones";
import { cargarTarifas } from "@/server/consultas/catalogo/combinaciones";
import { formatearMonto } from "@/core/pos/public";
import { FormConResultado } from "@/components/form-con-resultado";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";

const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const CLASE_INPUT = "min-h-[44px] rounded border px-2 py-1";
const CLASE_BOTON = "min-h-[44px] rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900";

/**
 * «Tarifas» (GO-3b, ADR-032, F6 paso U3): los GRUPOS DE PRECIO compartidos por varias combinaciones («Café grande» a $ 3.000 para el flat white, el latte y el cappuccino grandes: se cambia en un
 * solo lugar). De la EMPRESA, con la clave `grupos_de_precio_definir` (piso administrador); el precio de cada tarifa en ESTA sucursal, con `precio_local`. Una tarifa no se borra: se desactiva (y no
 * mientras tenga combinaciones). Entrar pide «Ver»; cambiar, «Editar» (cortesía: cada acción vuelve a exigirlo, con la versión que vio la pantalla).
 */
export default async function TarifasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_de_precio_definir", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [nivel, nivelLocal, tarifas] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "grupos_de_precio_definir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db),
    cargarTarifas(ctx.db, ctx.sucursalId),
  ]);
  const sucursalId = ctx.sucursalId;

  return (
    <GrupoDeFormularios className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Tarifas</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Un precio compartido por varias combinaciones (se asigna en las combinaciones de cada producto). Cambiar el precio de una tarifa cambia el de todas las que la usan, desde la próxima venta.
        </p>
      </div>

      {nivel.editar && (
        <section aria-labelledby="titulo-nueva-tarifa" className="flex flex-col gap-2">
          <h2 id="titulo-nueva-tarifa" className="text-lg font-medium">
            Nueva tarifa
          </h2>
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return crearGrupoDePrecio({ nombre: campo(fd, "nombre"), precio: campo(fd, "precio") });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-sm">
              Nombre
              <input name="nombre" required maxLength={80} placeholder="Ej.: Café grande" className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Precio
              <input name="precio" required inputMode="decimal" className={`${CLASE_INPUT} w-28`} />
            </label>
            <button type="submit" className={CLASE_BOTON}>
              Crear tarifa
            </button>
          </FormConResultado>
        </section>
      )}

      {tarifas.length === 0 ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Todavía no hay tarifas.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tarifas.map((t) => {
            const grupoDePrecioId = t.grupoDePrecioId;
            const versionEsperada = t.version;
            const localVisto = t.precioLocal;
            return (
              <li key={t.grupoDePrecioId} className="rounded border p-3" data-tarifa={t.nombre}>
                <p className="text-sm">
                  <span className="font-medium">{t.nombre}</span> · {formatearMonto(t.precio)} · {t.activo ? "activa" : "desactivada"} · {t.miembros} combinación{t.miembros === 1 ? "" : "es"}
                  {t.precioLocal ? ` · en «${ctx.sucursalNombre}»: ${formatearMonto(t.precioLocal.precio)}${t.precioLocal.habilitado ? "" : " (deshabilitado)"}` : ""}
                </p>
                {nivel.editar && (
                  <FormConResultado
                    accion={async (fd: FormData) => {
                      "use server";
                      return editarGrupoDePrecio({ grupoDePrecioId, versionEsperada, nombre: campo(fd, "nombre"), precio: campo(fd, "precio"), activo: fd.get("activo") === "on" });
                    }}
                    className="mt-2 flex flex-wrap items-end gap-2 text-sm"
                  >
                    <label className="flex flex-col gap-1">
                      Nombre
                      <input name="nombre" required maxLength={80} defaultValue={t.nombre} className={CLASE_INPUT} />
                    </label>
                    <label className="flex flex-col gap-1">
                      Precio
                      <input name="precio" required inputMode="decimal" defaultValue={t.precio} className={`${CLASE_INPUT} w-28`} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="activo" defaultChecked={t.activo} /> Activa
                    </label>
                    <button type="submit" className={CLASE_BOTON}>
                      Guardar tarifa
                    </button>
                  </FormConResultado>
                )}
                {nivelLocal.editar && (
                  <FormConResultado
                    accion={async (fd: FormData) => {
                      "use server";
                      const texto = campo(fd, "precioLocal").trim();
                      return fijarPrecioLocalDeCombinacion({ sucursalId, grupoDePrecioId, esperado: localVisto, precio: texto === "" ? null : texto });
                    }}
                    className="mt-2 flex flex-wrap items-end gap-2 text-sm"
                  >
                    <label className="flex flex-col gap-1">
                      Precio en «{ctx.sucursalNombre}» (vacío = el de la empresa)
                      <input name="precioLocal" inputMode="decimal" defaultValue={localVisto?.precio ?? ""} className={`${CLASE_INPUT} w-28`} />
                    </label>
                    <button type="submit" className={CLASE_BOTON}>
                      Guardar precio de esta sucursal
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </GrupoDeFormularios>
  );
}
