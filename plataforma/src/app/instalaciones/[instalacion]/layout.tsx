import Link from "next/link";
import { rutaDeEmpresas } from "../../../rutas";
import { contextoDePagina } from "../../../servidor/contexto";

/**
 * El marco de toda pantalla de una instalación (ADR-025): el selector entre instalaciones. Pide la sesión y valida la instalación de la ruta (404 si no existe); no consulta ninguna base,
 * así que una instalación caída no rompe el selector.
 */
export default async function LayoutDeInstalacion({ children, params }: { children: React.ReactNode; params: Promise<{ instalacion: string }> }) {
  const { instalacion, instalaciones } = await contextoDePagina((await params).instalacion);
  return (
    <>
      <nav aria-label="Instalaciones" className="filtros">
        {instalaciones.map((i) => (
          <Link key={i.id} href={rutaDeEmpresas(i.id)} aria-current={i.id === instalacion.id ? "page" : undefined}>
            {i.nombre}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
