/**
 * INTERRUPTOR del estilo de Pedernal en las listas de Proveedores y de Clientes con descuento (Frente 6, pantallas, paso 8 del plan; decisión del dueño, 2026-11-17: «4a», a la pregunta por proveedores y clientes:
 * «SOLO pantalla: buscador, alta rápida con solo el nombre, ocultar desactivados; la unión queda para después»). La maqueta es `directorio.html` de Pedernal. Una sola constante. Con `true` (hoy):
 *  - las dos listas tienen un BUSCADOR («Buscar»: por nombre, código o contacto, sin mayúsculas ni acentos, todas las palabras en cualquier orden);
 *  - los DESACTIVADOS no se ven salvo que se tilde «Mostrar desactivados» (la dirección lleva `?desactivados=1`); no se borra ni se archiva nada: desactivar y reactivar siguen igual;
 *  - el ALTA de un proveedor pide solo el nombre (el resto de los datos queda plegado en «Más datos, si los tenés»: contacto, teléfono, email, CUIT, condiciones de pago y notas; nada deja de poder cargarse).
 * Con `false` vuelven las dos listas y el alta de siempre. NO cambia el modelo de datos, los permisos ni las Server Actions. Lo que NO entra (decisión pendiente del dueño): unir proveedores y clientes en un solo
 * directorio, y un alta de cliente «solo con el nombre» (hoy el cliente existe para llevar un % de descuento, que sigue siendo obligatorio).
 * Lo comprueba `test/catalogo/directorio-de-la-lista.test.ts(x)` (los dos estados). Para volver al estado anterior: poner `false`.
 */
export const DIRECTORIO_AL_ESTILO_DE_PEDERNAL: boolean = true;

/** Lo que se pide en la dirección de la lista: el texto a buscar y si se muestran los desactivados. */
export interface BusquedaDelDirectorio {
  q: string;
  mostrarDesactivados: boolean;
}

/** El largo máximo de lo que se busca (más largo se recorta: la búsqueda es en memoria y no necesita más). */
const LARGO_MAXIMO_DE_LA_BUSQUEDA = 100;

/** Lo que vino en la dirección → la búsqueda. `q` se recorta y se limita; `desactivados` solo vale con el texto exacto «1» (cualquier otra cosa, o repetido, es «no»). */
export function leerBusquedaDelDirectorio(entrada: { q?: string | string[] | undefined; desactivados?: string | string[] | undefined }): BusquedaDelDirectorio {
  const q = typeof entrada.q === "string" ? entrada.q.trim().slice(0, LARGO_MAXIMO_DE_LA_BUSQUEDA) : "";
  return { q, mostrarDesactivados: entrada.desactivados === "1" };
}

/** ¿Hay algo puesto (para ofrecer «Limpiar»)? */
export function hayBusquedaDelDirectorio(b: BusquedaDelDirectorio): boolean {
  return b.q !== "" || b.mostrarDesactivados;
}

/** Sin mayúsculas ni acentos ni espacios de más: «José  PÉREZ» y «jose perez» son lo mismo. */
function normalizarParaBuscarEnElDirectorio(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Las filas que se ven: con el interruptor apagado, todas (como siempre). Con el interruptor encendido, sin los desactivados salvo que se pidan, y solo las que tienen TODAS las palabras buscadas en alguno de sus
 * textos (nombre, código, contacto…). Una búsqueda vacía coincide con todo. No cambia el orden ni las filas.
 */
export function filasDelDirectorio<T extends { activo: boolean }>(
  filas: readonly T[],
  busqueda: BusquedaDelDirectorio,
  textosDe: (fila: T) => readonly (string | null | undefined)[],
  estiloDePedernal: boolean = DIRECTORIO_AL_ESTILO_DE_PEDERNAL,
): T[] {
  if (!estiloDePedernal) return [...filas];
  const palabras = normalizarParaBuscarEnElDirectorio(busqueda.q).split(" ").filter(Boolean);
  return filas.filter((f) => {
    if (!f.activo && !busqueda.mostrarDesactivados) return false;
    if (palabras.length === 0) return true;
    const texto = normalizarParaBuscarEnElDirectorio(textosDe(f).filter((t): t is string => typeof t === "string").join(" "));
    return palabras.every((p) => texto.includes(p));
  });
}
