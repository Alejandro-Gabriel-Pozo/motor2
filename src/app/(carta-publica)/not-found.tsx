/**
 * 404 de la carta pública (ADR-006): se dispara con `notFound()` desde las páginas cuando la empresa o la sucursal no
 * existen, o no están publicadas — los tres casos dan el mismo 404, para no revelar cuál es (mismo criterio que hoy).
 */
export default function NoEncontradoCarta() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-xl font-semibold">No encontramos esta carta</h1>
      <p className="text-sm opacity-70">El enlace puede estar mal escrito, o la carta todavía no está publicada.</p>
    </div>
  );
}
