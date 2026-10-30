import { leerOpcionEnCarta, primeraEnMinuscula } from "./lectura-en-carta";

/**
 * El NOMBRE de una línea vendida con opciones («Café solo chico», «Milanesa napolitana de pollo»; decisión del dueño 2026-10-29, `docs/diseno-nombre-de-linea-configurada-2026-10-29.md`).
 * Puro y de LECTURA: se compone cada vez que se imprime o se lista a partir de la foto de lo elegido (`OpcionElegidaEnLinea`), nunca se guarda como texto, así que reimprimir da lo mismo.
 *
 * Reglas (todas del dueño):
 *  - producto DIRECTO: arranca con el nombre del producto y sigue con una parte por opción, en el orden de la foto (el orden del producto, congelado al vender);
 *  - producto BASE («se vende por opción»): el nombre del plato sale de la opción de la MEDIDA tal cual («Milanesa napolitana»; NO se imprime el nombre del producto) y sigue con las partes de las
 *    demás opciones;
 *  - cada parte es la opción leída «en la carta» (con el prefijo de su grupo si lo tiene, «de» + «pollo») con la primera letra en minúscula; la «ninguna» entra con su nombre, sin prefijo;
 *  - una cantidad mayor a 1 se muestra «×N» («papas fritas ×2»);
 *  - lo INCLUIDO (guarniciones) NO va en el nombre: va en el `detalle`, unido con « · » («nalga · puré de papa»);
 *  - los ADICIONALES no entran: son renglones propios («+ 1 × Huevo frito») con su precio.
 * El prefijo se lee VIGENTE (hoy la foto no lo congela; en producción ningún grupo tiene prefijo cargado todavía).
 */

/** Lo que el nombre lee de cada opción de la foto, tal como la anida la consulta: lo congelado (tipo, nombre, cantidad) más el prefijo del grupo y la marca «ninguna» de la opción, que se leen vigentes. */
export interface FotoParaElNombre {
  tipoGrupo: string;
  nombreOpcion: string;
  cantidad: number;
  grupo: { prefijoEnCarta: string | null };
  opcion: { esNinguna: boolean };
}

export interface NombreDeLinea {
  /** El producto (o el plato, en una base) más sus partes, en un solo renglón. */
  nombre: string;
  /** Lo incluido, debajo del nombre; ausente si no hay. */
  detalle?: string;
}

export function nombreDeLineaConfigurada(productoNombre: string, esBase: boolean, fotos: readonly FotoParaElNombre[]): NombreDeLinea {
  const parte = (f: FotoParaElNombre) => {
    const texto = primeraEnMinuscula(leerOpcionEnCarta(f.grupo.prefijoEnCarta, { nombre: f.nombreOpcion, esNinguna: f.opcion.esNinguna }));
    return f.cantidad > 1 ? `${texto} ×${f.cantidad}` : texto;
  };
  const propias = fotos.filter((f) => f.tipoGrupo !== "ADICIONAL");
  const plato = esBase ? propias.find((f) => f.tipoGrupo === "MEDIDA") : undefined;
  const incluidas = propias.filter((f) => f.tipoGrupo === "INCLUIDA");
  const partes = propias.filter((f) => f !== plato && f.tipoGrupo !== "INCLUIDA").map(parte);
  return { nombre: [plato?.nombreOpcion ?? productoNombre, ...partes].join(" "), ...(incluidas.length ? { detalle: incluidas.map(parte).join(" · ") } : {}) };
}
