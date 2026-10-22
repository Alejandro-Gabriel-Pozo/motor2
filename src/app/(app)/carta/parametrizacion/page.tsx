import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resumirParametrizacionDeCarta } from "@/server/consultas/carta/mantenimiento";
import { EncabezadoDeCarta } from "../encabezado-de-carta";
import s from "../carta-mant.module.css";

/**
 * CARTA-MANT: Parametrización de la carta (prototipo aprobado): lo que se cambia pocas veces, separado de Mantenimiento (lo de todos los días). Un hub de tarjetas: Secciones (y la ficha de cada
 * producto), Géneros, Agrupados, Promociones y Apariencia y publicación; cada una abre los MISMOS formularios de siempre, con sus permisos. Entrar pide «Ver» de `carta_ver`.
 *
 * Decisión declarada: el prototipo muestra un aviso de «cambios sin publicar» y «se publican con un solo botón». En el código NO existe un borrador de la carta (cada cambio rige al guardarse y
 * revalida la carta pública), así que ese aviso no se dibuja: inventarlo cambiaría el modelo. Lo que sí existe es si la carta de la sucursal está publicada en el portal (`publicada`), y eso se muestra.
 */
export default async function ParametrizacionDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const r = await resumirParametrizacionDeCarta(ctx.db, ctx.sucursalId);
  const ocultas = r.secciones.filter((x) => !x.activa).length;

  const tarjetas: { href: string; titulo: string; cuenta: string; detalle: string }[] = [
    {
      href: "/carta/parametrizacion/secciones",
      titulo: "Secciones",
      cuenta: `${r.secciones.length}${ocultas ? ` · ${ocultas} oculta${ocultas > 1 ? "s" : ""}` : ""}`,
      detalle: "Cómo se agrupan, en qué orden se ven y cuáles se muestran; la ficha de cada producto",
    },
    { href: "/carta/parametrizacion/generos", titulo: "Géneros", cuenta: String(r.generos), detalle: "Carpetas del selector del POS, como «Cerveza» o «Vinos»" },
    { href: "/carta/agrupados", titulo: "Agrupados", cuenta: String(r.agrupados), detalle: "Varios productos que se eligen como uno" },
    { href: "/carta/parametrizacion/promociones", titulo: "Promociones", cuenta: `${r.promosActivas} activa${r.promosActivas === 1 ? "" : "s"}`, detalle: "Combos, cupos, precio de esta sucursal y vigencia" },
    {
      href: "/carta/parametrizacion/apariencia",
      titulo: "Apariencia y publicación",
      cuenta: r.publicada === null ? "Sin publicar en el portal" : r.publicada ? "Publicada" : "Sin publicar",
      detalle: "Colores, logo y carta pública",
    },
  ];

  return (
    <div className={s.raiz}>
      <EncabezadoDeCarta puerta="parametrizacion" subtitulo="Parametrización" sucursal={ctx.sucursalNombre} />
      <div className={s.contenido}>
        <div className={s.pad}>
          <div className={`${s.nota} ${s.notaOk}`}>
            <b>Esto se cambia pocas veces.</b> Para lo de todos los días (se acabó algo, un precio) andá a Mantenimiento.
          </div>
          <Link href="/carta" className={`${s.boton} ${s.botonSuave}`}>
            Ir a Mantenimiento de la carta
          </Link>
          <nav className={s.hub} aria-label="Parametrización de la carta">
            {tarjetas.map((t) => {
              const contenido = (
                <>
                  <div>
                    <b>
                      {t.titulo} <span>· {t.cuenta}</span>
                    </b>
                    <span>{t.detalle}</span>
                  </div>
                  <i className={s.flecha} aria-hidden="true">
                    ›
                  </i>
                </>
              );
              // Todas con `EnlaceInterno` (el guardián de enlaces no admite un `Link` con `href` variable): las que son de la carta abren con el mismo «Ver»; las de otra pantalla quedan en
              // texto si el rol no puede abrirlas.
              return (
                <EnlaceInterno key={t.href} href={t.href} className={s.hubFila}>
                  {contenido}
                </EnlaceInterno>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
