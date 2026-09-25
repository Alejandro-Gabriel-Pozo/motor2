import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { cargarTemaAdmin, type TemaAdmin } from "@/core/carta/admin-consulta";
import { CLAVES_TEMA_V1 } from "@/core/carta/tema";
import { cambiarAplicacionTema, guardarTemaCarta } from "@/server/actions/carta/tema";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { EditorTema } from "@/components/carta/editor-tema";

/**
 * Tema de la carta (docs/plan-tema-carta-2026-09-24.md, M9, D11): los colores, textos, tipografía y layout de la carta pública de
 * la sucursal ACTIVA — lo que restaurant-menu-design lee por GET /api/carta/[sucursal]/tema en lugar de la tab "Config" de la
 * sheet del tenant. Mismo estilo que /catalogo/carta y /catalogo/carta/portal: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/tema.ts (conPermiso("carta")) y el refresco lo piden los closures de acá. Los closures capturan solo el
 * id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 *
 * Guardar y Aplicar/Desaplicar son formularios separados (D4): un tema guardado sin aplicar es un borrador.
 */
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/** Las 67 claves del catálogo, como texto (un campo vacío llega como ""; guardarTemaCarta lo omite). */
const valoresDelFormulario = (fd: FormData) => Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));

function estadoDelTema(d: TemaAdmin): string {
  const portal = !d.publica ? "no está en el portal" : `/carta/${d.publica.slug}${d.publica.publicada ? "" : " (sin publicar)"}`;
  const tema = !d.tema ? "sin tema en motor2 (la carta usa la tab Config de la sheet)" : d.tema.aplicarEnCarta ? "tema aplicado" : "borrador (la carta sigue con la sheet)";
  return `Portal: ${portal} · Tema: ${tema}`;
}

export default async function TemaCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const datos = await cargarTemaAdmin(ctx.sucursalId);
  if (!datos) return <p className="text-red-600">No se encontró la sucursal activa.</p>;
  const sucursalId = datos.sucursalId;
  const aplicado = datos.tema?.aplicarEnCarta ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Tema de la carta</h1>
        <p className="text-sm text-neutral-500">
          Colores, textos, tipografía y layout de la carta pública de «{datos.nombre}»: lo que hoy es la tab Config de su sheet. Mientras el tema no esté
          aplicado es un borrador y la carta sigue con la sheet; aplicado, la carta lo toma en hasta 5 minutos. Vacío = default de la carta.
        </p>
        <p className="text-sm" data-estado-tema>
          {estadoDelTema(datos)}
        </p>
        {!datos.publica && (
          <p className="text-sm text-neutral-500">
            Se puede preparar igual; no tiene efecto hasta agregar la sucursal en el{" "}
            <Link href="/catalogo/carta/portal" className="underline">
              Portal de sucursales
            </Link>
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
              ? "Desaplicarlo es la vuelta atrás: la carta vuelve a la tab Config de la sheet y los valores se conservan."
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
