import Link from "next/link";
import s from "./carta-mant.module.css";

/**
 * CARTA-MANT (prototipo aprobado): arriba de toda la carta, las dos puertas —«Mantenimiento» (lo de todos los días: se acabó algo, un precio, qué se muestra) y «Parametrización» (lo que se
 * cambia pocas veces: secciones, géneros, agrupados, promociones, apariencia)— y la barra azul noche con «Carta · <dónde estás>» y la sucursal activa. Sin estado: dos enlaces.
 */
export function EncabezadoDeCarta({ puerta, subtitulo, sucursal }: { puerta: "mantenimiento" | "parametrizacion"; subtitulo: string; sucursal: string }) {
  return (
    <>
      <nav className={s.pestanas} aria-label="Carta">
        <div className={s.seg}>
          <Link href="/carta" aria-current={puerta === "mantenimiento" ? "page" : undefined}>
            Mantenimiento
          </Link>
          <Link href="/carta/parametrizacion" aria-current={puerta === "parametrizacion" ? "page" : undefined}>
            Parametrización
          </Link>
        </div>
      </nav>
      <div className={s.appbar}>
        <h1>Carta</h1>
        <span>{subtitulo}</span>
        <span className={s.suc}>{sucursal}</span>
      </div>
    </>
  );
}
