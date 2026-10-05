"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * Lo que se ve cuando la base de UNA instalación no responde o falla una consulta (ADR-025): la consola sigue andando para las demás. Nunca muestra `error.message` (puede traer datos de la
 * conexión). Un componente de error no envuelve el layout de su mismo segmento: el selector de instalaciones sigue arriba. No importa nada de la aplicación de empresas.
 */
export default function ErrorDeInstalacion({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { instalacion } = useParams<{ instalacion: string }>();
  return (
    <section className="tarjeta">
      <h1>No pudimos conectar con esta instalación</h1>
      <p className="error" role="alert">
        La instalación «{instalacion}» no responde ahora. Las demás siguen disponibles.
      </p>
      <div className="acciones">
        <button type="button" onClick={() => retry()}>
          Reintentar
        </button>
        <p className="ayuda">
          <Link href="/">Volver al inicio</Link>
        </p>
      </div>
    </section>
  );
}
