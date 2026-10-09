import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { type TemaAdmin, CLAVES_TEMA_V1 } from "@/core/carta/public";
import { cargarTemaAdmin } from "@/server/consultas/carta/admin";
import { cambiarAplicacionTema, guardarTemaCarta } from "@/server/actions/carta/tema";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { EditorTema } from "@/components/carta/editor-tema";

/**
 * Tema de la carta (docs/plan-tema-carta-2026-09-24.md, M9, D11): los colores, textos, tipografía y layout de la carta pública de
 * la sucursal ACTIVA — lo que lee la carta pública interna (ADR-006). Mismo estilo que /carta y /carta/portal: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/tema.ts (conPermiso("carta_tema")) y el refresco lo piden los closures de acá. Los closures capturan solo el
 * id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 *
 * Guardar y Aplicar/Desaplicar son formularios separados (D4): un tema guardado sin aplicar es un borrador.
 */
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/** Las 66 claves del catálogo, como texto (un campo vacío llega como ""; guardarTemaCarta lo omite). */
const valoresDelFormulario = (fd: FormData) => Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));

function estadoDelTema(d: TemaAdmin): string {
  const portal = !d.publica ? "no está en el portal" : `/carta/${d.publica.slug}${d.publica.publicada ? "" : " (sin publicar)"}`;
  const tema = !d.tema ? "sin tema (la carta usa el estilo por defecto)" : d.tema.aplicarEnCarta ? "tema aplicado" : "borrador (la carta usa el estilo por defecto)";
  return `Portal: ${portal} · Tema: ${tema}`;
}

export default async function TemaCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_tema", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const datos = await cargarTemaAdmin(ctx.sucursalId, ctx.db);
  if (!datos) return <p className="text-red-600">No se encontró la sucursal activa.</p>;
  const sucursalId = datos.sucursalId;
  const aplicado = datos.tema?.aplicarEnCarta ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Tema de la carta</h1>
        <p className="text-sm text-neutral-500">
          Colores, textos, tipografía y layout de la carta pública de «{datos.nombre}». Mientras el tema no esté
          aplicado es un borrador y la carta usa el estilo por defecto; aplicado, la carta lo toma en hasta 5 minutos. Vacío = default de la carta.
        </p>
        <p className="text-sm" data-estado-tema>
          {estadoDelTema(datos)}
        </p>
        {!datos.publica && (
          <p className="text-sm text-neutral-500">
            Se puede preparar igual; no tiene efecto hasta agregar la sucursal en el{" "}
            <EnlaceInterno href="/carta/portal" className="underline">
              Portal de sucursales
            </EnlaceInterno>
            .
          </p>
        )}
        <p className="text-sm text-neutral-500">
          Los precios usan la convención del sistema: es-AR, con el símbolo $ a la izquierda (ej. $12.500). No se editan acá.
        </p>
      </div>

      <EditorTema
        valoresIniciales={datos.tema?.valores ?? {}}
        version={datos.tema?.actualizadoEn.toISOString() ?? "sin-tema"}
        accion={async (fd: FormData) => {
          "use server";
          return refrescarSiOk(await guardarTemaCarta(sucursalId, valoresDelFormulario(fd)));
        }}
      />

      <section aria-labelledby="titulo-aplicar-tema" className="flex flex-col gap-2 border-t pt-4">
        <h2 id="titulo-aplicar-tema" className="text-lg font-medium">
          {aplicado ? "Tema aplicado en la carta" : "Aplicar en la carta"}
        </h2>
        {/* UN solo formulario (el mismo en los dos estados): al aplicar, la página se refresca y cambia de estado, y el mensaje de resultado
            de FormConResultado tiene que seguir a la vista. Cada closure captura solo el id de la sucursal. */}
        <FormConResultado
          accion={
            aplicado
              ? async () => {
                  "use server";
                  return refrescarSiOk(await cambiarAplicacionTema(sucursalId, false));
                }
              : async () => {
                  "use server";
                  return refrescarSiOk(await cambiarAplicacionTema(sucursalId, true));
                }
          }
        >
          <p className="text-sm text-neutral-500">
            {aplicado
              ? "Desaplicarlo es la vuelta atrás: la carta vuelve al estilo por defecto y los valores se conservan."
              : "Aplica lo GUARDADO (guardá antes los cambios). No se puede aplicar un tema vacío."}
          </p>
          <button type="submit" className="mt-2 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            {aplicado ? "Desaplicar el tema" : "Aplicar el tema"}
          </button>
        </FormConResultado>
      </section>
    </div>
  );
}
