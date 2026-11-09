import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Apartado de planilla (docs/diseno-estilo-de-planilla-2026-11-09.md): un bloque de la pantalla con su propio contorno, una banda de título (título, UNA línea de explicación y, si hace falta,
 * el enlace «Ver todo →») y el cuerpo (una `BarraDeFiltros` y una `TablaDeDatos`, un formulario…). Separa un apartado de otro con el aire de `RejillaDeSecciones` o de la columna de la pantalla.
 * Sin negocio ni estado: solo tokens del sistema visual y sin modo oscuro (DEC-04). Mobile first: la banda apila el título y el enlace en celular y los pone en fila desde `md:`.
 *
 * El título es un `h2` (el `h1` es el de la pantalla). `idDelTitulo` solo hace falta si la pantalla tiene dos apartados con el mismo título.
 */
export function ApartadoDePlanilla({
  titulo,
  descripcion,
  verTodo,
  idDelTitulo,
  children,
}: {
  titulo: string;
  descripcion?: string;
  /** Enlace «Ver todo →» de la banda: a una pantalla que muestra el resto (un apartado que resume). Nunca a la misma pantalla. */
  verTodo?: { href: string; texto?: string };
  idDelTitulo?: string;
  children: ReactNode;
}) {
  const id = idDelTitulo ?? `apartado-${titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded border border-borde-control/60 bg-superficie">
      <header className="flex flex-col gap-1 border-b border-borde-control/60 bg-superficie px-4 py-3 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <div className="min-w-0">
          <h2 id={id} className="font-semibold">
            {titulo}
          </h2>
          {descripcion ? <p className="text-sm text-tinta-suave">{descripcion}</p> : null}
        </div>
        {verTodo ? (
          <Link href={verTodo.href} className="shrink-0 text-sm text-tinta-suave underline hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco">
            {verTodo.texto ?? "Ver todo →"}
          </Link>
        ) : null}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}
