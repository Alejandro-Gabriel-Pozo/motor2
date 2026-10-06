/**
 * Un id que llega de afuera (argumento de una Server Action: el cliente puede mandar cualquier cosa) tiene que ser un string no
 * vacío antes de ir a un `where`: Prisma trata `undefined` como "sin filtro", así que un `findFirst`/`deleteMany` con `{ sucursalId: undefined }`
 * toca la primera fila, o todas.
 */
export function esIdentificador(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}
