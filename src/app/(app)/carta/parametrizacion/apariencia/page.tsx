import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { EncabezadoDeCarta } from "../../encabezado-de-carta";
import s from "../../carta-mant.module.css";

/**
 * CARTA-MANT: Parametrización › Apariencia y publicación (prototipo aprobado). Las dos pantallas que ya existían, sin cambios: el tema de la carta de la sucursal (`/carta/tema`, colores y logo) y el
 * portal de sucursales (`/carta/portal`, dónde y si se publica). Cada una se protege con su propia clave; los enlaces se dibujan como texto si el rol no puede abrirlas (`EnlaceInterno`).
 */
export default async function AparienciaDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  return (
    <div className={s.raiz}>
      <EncabezadoDeCarta puerta="parametrizacion" subtitulo="Parametrización · Apariencia y publicación" sucursal={ctx.sucursalNombre} />
      <div className={s.contenido}>
        <div className={s.pad}>
          <Link href="/carta/parametrizacion" className={`${s.boton} ${s.botonSuave} ${s.volver}`}>
            ← Volver
          </Link>
          <h2 className={s.h2}>Apariencia y publicación</h2>
          <nav className={s.hub} aria-label="Apariencia y publicación">
            <EnlaceInterno href="/carta/tema" className={s.hubFila}>
              <div>
                <b>Tema de la carta</b>
                <span>Colores, logo y tipografía de la carta pública de esta sucursal</span>
              </div>
              <i className={s.flecha} aria-hidden="true">
                ›
              </i>
            </EnlaceInterno>
            <EnlaceInterno href="/carta/portal" className={s.hubFila}>
              <div>
                <b>Portal de sucursales</b>
                <span>Si la carta de cada sucursal se publica y dónde aparece en el portal</span>
              </div>
              <i className={s.flecha} aria-hidden="true">
                ›
              </i>
            </EnlaceInterno>
          </nav>
        </div>
      </div>
    </div>
  );
}
