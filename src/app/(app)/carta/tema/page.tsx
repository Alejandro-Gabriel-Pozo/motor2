import { EnlaceInterno } from "@/components/enlace-interno";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { AvisoSoloLectura } from "@/components/carta/datos-solo-lectura";
import { CLAVES_TEMA_V1, PESTANAS_DE_APARIENCIA, type TemaAdmin } from "@/core/carta/public";
import { cargarTemaAdmin } from "@/server/consultas/carta/admin";
import { guardarTemaCarta } from "@/server/actions/carta/tema";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { EditorTema } from "@/components/carta/editor-tema";

/**
 * Tema de la carta (docs/plan-tema-carta-2026-09-24.md, M9, D11): los colores, textos, tipografía y layout de la carta pública de
 * la sucursal ACTIVA — lo que lee la carta pública interna (ADR-006). Mismo estilo que /carta y /carta/portal: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/tema.ts (conPermiso("carta_tema")) y el refresco lo piden los closures de acá. Los closures capturan solo el
 * id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 *
 * Guardar = aplicar: no hay borrador; volver al aspecto por defecto = vaciar el tema.
 */
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/** Las 65 claves del catálogo, como texto (un campo vacío llega como ""; guardarTemaCarta lo omite). */
const valoresDelFormulario = (fd: FormData) => Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));

/**
 * Los valores del formulario, con la INTENCIÓN de los botones del color de marca (decisión del dueño, 2026-11-13: «Botón explícito»): «pasar» fija la marca elegida y el marcador `marca_derivada = «si»`;
 * «volver» quita solo el marcador (los colores sueltos no se tocan); sin intención («Guardar tema») es el guardado de siempre. El servidor revalida todo (M1, M2 y M3) en el guard.
 */
function valoresConLaIntencion(fd: FormData): Record<string, string> {
  const valores = valoresDelFormulario(fd);
  const intencion = String(fd.get("intencion") ?? "");
  if (intencion === "pasar") return { ...valores, color_marca: String(fd.get("marca_elegida") ?? ""), marca_derivada: "si" };
  if (intencion === "volver") return { ...valores, marca_derivada: "" };
  return valores;
}

function estadoDelTema(d: TemaAdmin): string {
  const portal = !d.publica ? "no está en el portal" : `/carta/${d.publica.slug}${d.publica.publicada ? "" : " (sin publicar)"}`;
  const tema = !d.tema ? "sin tema (la carta usa el estilo por defecto)" : d.tema.aplicarEnCarta ? "tema aplicado" : "borrador (la carta usa el estilo por defecto)";
  return `Portal: ${portal} · Tema: ${tema}`;
}

export default async function TemaCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_tema", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // DEC-33 (ver ≠ escribir): con «Ver» y sin «Editar» de `carta_tema`, el editor sale deshabilitado y sin «Guardar»; las acciones igual lo exigen (`conPermiso`).
  const [{ editar: puedeEditar }, datos] = await Promise.all([obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_tema", ctx.db), cargarTemaAdmin(ctx.sucursalId, ctx.db)]);
  if (!datos) return <p className="text-error">No se encontró la sucursal activa.</p>;
  const sucursalId = datos.sucursalId;

  return (
    <div className="flex flex-col gap-6">
      <FilaDeCarta ctx={ctx} etiqueta="Apariencia y publicación" pestanas={PESTANAS_DE_APARIENCIA} ruta="/carta/tema" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Tema de la carta</h1>
        <p className="text-sm text-tinta-tenue">
          Colores, textos, tipografía y layout de la carta pública de «{datos.nombre}». Al guardar, la carta lo toma
          en hasta 5 minutos. Vacío = default de la carta.
        </p>
        <p className="text-sm" data-estado-tema>
          {estadoDelTema(datos)}
        </p>
        {!datos.publica && (
          <p className="text-sm text-tinta-tenue">
            Se puede preparar igual; no tiene efecto hasta agregar la sucursal en el{" "}
            <EnlaceInterno href="/carta/portal" className="underline">
              Portal de sucursales
            </EnlaceInterno>
            .
          </p>
        )}
        <p className="text-sm text-tinta-tenue">
          Los precios usan la convención del sistema: es-AR, con el símbolo $ a la izquierda (ej. $12.500). No se editan acá.
        </p>
        {!puedeEditar && <AvisoSoloLectura />}
      </div>

      <EditorTema
        valoresIniciales={datos.tema?.valores ?? {}}
        version={datos.tema?.actualizadoEn.toISOString() ?? "sin-tema"}
        soloLectura={!puedeEditar}
        accion={async (fd: FormData) => {
          "use server";
          return refrescarSiOk(await guardarTemaCarta(sucursalId, valoresConLaIntencion(fd)));
        }}
      />
    </div>
  );
}
