import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "@/server/actions/carta/generos";
import { FormConResultado } from "@/components/form-con-resultado";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { EncabezadoDeCarta } from "../../encabezado-de-carta";
import estilos from "../../carta-mant.module.css";
import { CLASE_BOTON, CLASE_ENLACE_DE_ACCION, CamposGenero } from "../formularios";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";

/** Ayudantes puros de los closures "use server" de esta página (locales a propósito: `use-server-solo-donde-corresponde` solo los acepta definidos en el mismo archivo). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/**
 * CARTA-MANT: Parametrización › Géneros (prototipo aprobado). Los géneros de la carta de la sucursal activa (carpetas del selector del POS), con el MISMO bloque que antes estaba apilado en `/carta`:
 * entrar pide «Ver» de `carta_ver`; los formularios se dibujan solo con «Editar» de `carta_generos` (cortesía de la interfaz: la acción vuelve a exigirlo).
 */
export default async function GenerosDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const nivelGeneros = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_generos", ctx.db);
  const puedeEditarGeneros = nivelGeneros.editar;
  const datos = await cargarAdminCarta(ctx.sucursalId, ctx.db, new Date());

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta puerta="parametrizacion" subtitulo="Parametrización · Géneros" sucursal={ctx.sucursalNombre} />
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          <Link href="/carta/parametrizacion" className={`${estilos.boton} ${estilos.botonSuave} ${estilos.volver}`}>
            ← Volver
          </Link>
          <div className={`${estilos.formulario} flex flex-col gap-10`}>
            {!puedeEditarGeneros && <AvisoSoloLectura />}
      {/* 2. Géneros de carta (docs/plan-genero-carta-2026-09-26.md): carpetas VISUALES del POS, globales como las secciones. */}
      <section aria-labelledby="titulo-generos" className="flex flex-col gap-3">
        <h2 id="titulo-generos" className="text-lg font-medium">
          Géneros de carta
        </h2>
        <p className="text-sm text-neutral-500">
          Carpetas del selector del POS (ej. «Cerveza»): agrupan, dentro de una sección, tanto productos sueltos como ítems agrupados que comparten género. No
          implican mismo precio ni sustituibilidad (eso lo maneja «Ítems agrupados de la carta»); no cambian la carta pública que ve el cliente. Un producto sin
          género (o con uno apagado) sigue apareciendo suelto.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.generos.map((g) => {
            const id = g.id;
            const activo = g.activo;
            return (
              <li key={g.id} className="rounded border p-3" data-genero-carta={g.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
                    <span className="font-medium">{g.nombre}</span> · orden {g.orden} · {g.activo ? "activo" : "apagado"}
                  </summary>
                  {puedeEditarGeneros ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(await guardarGeneroCarta({ id, nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposGenero valores={g} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar género
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Nombre">{g.nombre}</Dato>
                      <Dato etiqueta="Orden">{g.orden}</Dato>
                    </DatosSoloLectura>
                  )}
                </details>
                {puedeEditarGeneros && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivoGeneroCarta(id, !activo));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                      {g.activo ? `Apagar «${g.nombre}»` : `Prender «${g.nombre}»`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.generos.length && <li className="text-sm text-neutral-500">Todavía no hay géneros.</li>}
        </ul>

        {puedeEditarGeneros && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(await guardarGeneroCarta({ nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nuevo género</h3>
            <CamposGenero ordenSugerido={datos.generos.length} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear género
              </button>
            </div>
          </FormConResultado>
        )}
      </section>

          </div>
        </div>
      </div>
    </div>
  );
}
