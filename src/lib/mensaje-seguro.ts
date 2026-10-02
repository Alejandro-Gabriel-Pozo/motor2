const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const BEARER = /\bBearer\s+[\w.~+/=-]{8,}/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN_LARGO = /\b[A-Za-z0-9_-]{32,}\b/g;

export function limpiarTexto(texto: string): string {
  return texto.replace(EMAIL, "[email]").replace(BEARER, "Bearer [token]").replace(JWT, "[token]").replace(TOKEN_LARGO, "[token]");
}

export function esErrorDePrisma(tipo: string | undefined, valor: string | undefined): boolean {
  return /^Prisma.*Error$/.test(tipo ?? "") || /\bprisma\.\w+\.\w+\(/.test(valor ?? "");
}

/** Los errores de Prisma traen en el mensaje la consulta con sus argumentos (emails, importes): se reducen a su código. */
export function resumenErrorDePrisma(valor: string | undefined): string {
  const codigo = /\bP\d{4}\b/.exec(valor ?? "")?.[0];
  return `Error de base de datos${codigo ? ` ${codigo}` : ""} (mensaje omitido)`;
}

/** Texto de un error para dejarlo en los registros del servidor (`console.error`) sin datos personales ni de negocio. Nunca el objeto entero ni su stack. */
export function mensajeSeguro(e: unknown): string {
  const tipo = e instanceof Error ? e.name : undefined;
  const valor = e instanceof Error ? e.message : String(e);
  return esErrorDePrisma(tipo, valor) ? resumenErrorDePrisma(valor) : limpiarTexto(valor);
}
