/**
 * INTERRUPTOR de las pantallas candidatas a baja (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, ocultarlas sin borrar (Recomendada)», paso 4 del plan de pantallas;
 * regla de poda del 2026-10-28). Una sola constante. Con `false` (hoy) las seis pantallas de abajo NO se ofrecen: ni en el menú, ni en las pestañas, ni en los enlaces de otras pantallas.
 * No se borra nada: las páginas, las Server Actions, los casos de uso, los permisos y los datos quedan como estaban y las pantallas siguen abriéndose por su dirección (con su permiso de siempre).
 * Con `true` vuelve todo tal cual. El borrado definitivo es una etapa aparte que exige la confirmación expresa del dueño.
 *
 * QUÉ DEJA DE ESTAR A MANO (declarado, una por una):
 *  1. «Precio local» (`/movimientos/precio-local`): pestaña de Catálogo › Productos y el enlace «Precio local» de la pestaña Precios de la ficha. Se pierde: la tabla para comparar y cambiar el
 *     precio de venta de TODOS los productos de la sucursal de una vez, incluido el de otras sucursales. El precio de UN producto en la sucursal activa se sigue cambiando en la ficha.
 *  2. «Limpiar opciones» (`/catalogo/opciones/limpiar`): el botón de Catálogo › Biblioteca de opciones. Se pierde: archivar varias opciones de una vez según un criterio, con vista previa.
 *  3. «Carga de ventas sin ticket» (`/movimientos/venta`): el ítem del menú Movimientos. Se pierde: cargar a mano ventas que no pasaron por el salón (el mostrador de Salón › Mostrador sigue).
 *  4. «Comparativa de precios» (`/catalogo/proveedores/comparativa`): los enlaces desde la lista y la ficha de proveedores y desde la ficha del producto. Se pierde: ver lado a lado el precio
 *     de un mismo producto en cada proveedor.
 *  5. «Géneros» (`/carta/parametrizacion/generos`): la pestaña de Carta › Secciones y géneros y el enlace «Géneros» en Secciones. Se pierde: administrar las carpetas del selector del POS.
 *  6. «Ítems agrupados» (`/carta/agrupados`): la pestaña de Carta y el enlace en la ficha del producto en la carta. Se pierde: armar y editar los renglones que agrupan opciones en la carta.
 * Lo comprueba `test/navegacion/candidatas-a-baja-interruptor.test.ts` (los dos estados). Para volver a mostrarlas: poner `true`.
 */
export const CANDIDATAS_A_BAJA_VISIBLES: boolean = false;

/** Las rutas de las seis pantallas candidatas (una por candidata). */
export const RUTAS_CANDIDATAS_A_BAJA: readonly string[] = [
  "/movimientos/precio-local",
  "/catalogo/opciones/limpiar",
  "/movimientos/venta",
  "/catalogo/proveedores/comparativa",
  "/carta/parametrizacion/generos",
  "/carta/agrupados",
];

/** ¿Se ofrece esta ruta (menú, pestaña o enlace)? Siempre sí salvo que sea una candidata y el interruptor esté apagado. */
export function rutaOfrecida(href: string, visibles: boolean = CANDIDATAS_A_BAJA_VISIBLES): boolean {
  return visibles || !RUTAS_CANDIDATAS_A_BAJA.includes(href);
}

/**
 * Las pestañas que se ofrecen: cada una con sus pantallas ofrecidas (`rutaOfrecida`) y sin las que se quedan sin ninguna. Con el interruptor encendido devuelve las mismas pestañas. Es la fuente única de «qué pestañas
 * de Carta se ofrecen»: la usan la fila de pestañas y el lugar a donde se redirige a quien no ve la principal (`primeraPantallaVisible`), para que ninguna lleve a una pantalla oculta.
 */
export function pestanasOfrecidas<P extends { readonly pantallas: readonly { readonly href: string }[] }>(pestanas: readonly P[], visibles: boolean = CANDIDATAS_A_BAJA_VISIBLES): P[] {
  if (visibles) return [...pestanas];
  return pestanas.flatMap((p) => {
    const pantallas = p.pantallas.filter((x) => rutaOfrecida(x.href, false));
    return pantallas.length > 0 ? [{ ...p, pantallas } as P] : [];
  });
}
