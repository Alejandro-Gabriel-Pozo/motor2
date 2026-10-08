import { cumplePaso, mensajeCantidadNoCumplePaso } from "@/core/catalogo/public";

/**
 * Las REGLAS PURAS de una línea de venta (Hito 5, pieza 5.1: mudadas TAL CUAL desde `armarLinea`, que vive en `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`).
 * `armarLinea` sigue siendo el ORQUESTADOR — decide en qué orden se lee y se rechaza (hay salidas tempranas que los goldens de la venta registran, así que no se puede «cargar todo
 * y después decidir») — y llama a estas funciones EN EL MISMO LUGAR donde antes estaba el `if`. Acá no hay lectura ni escritura: solo el criterio y el texto de cada rechazo.
 * P0: sin `@prisma/client` (ni siquiera `import type`), por eso el tipo del producto es estructural (`tipo: string`, `pasoVenta: number | null`) y la conversión de `Decimal` a `number`
 * la hace quien lee. La red que fija todo esto: `test/movimientos/venta-linea-caracterizacion.test.ts` (qué mensaje gana cuando fallan dos cosas a la vez), las matrices de la venta y
 * `test/core/linea-de-venta.test.ts` (los textos byte a byte).
 */

type CantidadVendida = { tipo: "saltear" } | { tipo: "invalida"; mensaje: string } | { tipo: "valida"; cantidad: number };

/**
 * Qué hacer con la cantidad de una línea. Una cantidad que no es un número finito y no negativo es un error, no «sin cantidad»: salteada en silencio, el resto de la venta se registraría
 * igual. Solo el 0 (o la cantidad ausente) saltea la línea. Recibe `unknown` porque la línea puede llegar del borde sin validar.
 */
export function leerCantidadVendida(cantidad: unknown): CantidadVendida {
  if (cantidad === undefined || cantidad === null || cantidad === 0) return { tipo: "saltear" };
  if (typeof cantidad !== "number" || !Number.isFinite(cantidad) || cantidad < 0) return { tipo: "invalida", mensaje: "La cantidad vendida no es un número válido." };
  return { tipo: "valida", cantidad };
}

/** El mensaje cuando el producto de la línea no existe. */
export const MENSAJE_PRODUCTO_NO_EXISTE = `El producto no existe.`;

/** El mensaje cuando el producto (o una materia prima de su receta) existe pero no está disponible en la sucursal que vende. */
export function mensajeNoDisponibleEnSucursal(nombre: string, sucursalNombre: string): string {
  return `«${nombre}» no está disponible en «${sucursalNombre}».`;
}

/** Lo único que la regla mira del producto vendido: su nombre, su tipo («PV» es lo único vendible) y su paso de venta (ya como número, o `null` si no tiene). */
interface ProductoVendido {
  nombre: string;
  tipo: string;
  pasoVenta: number | null;
}

/**
 * Por qué el producto NO se puede vender en esa cantidad, o `null` si se puede. El TIPO se mira primero y el paso después: un producto que no es PV y además tiene un paso con una
 * cantidad fuera de él rechaza por el tipo. Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): la validación del paso es ADICIONAL, específica de esta venta — no
 * reemplaza ninguna validación de decimales general. Comparte el núcleo con `cerrarCuenta` (POS): cada línea que llega ya pasó por `validarCantidadPedido` al cargarse (múltiplo exacto del
 * paso), y la SUMA de múltiplos exactos sigue siendo un múltiplo exacto — así que esto nunca debería disparar desde el POS, solo desde la venta de mostrador directa (`registrarVenta`).
 */
export function rechazoDelProductoVendido(producto: ProductoVendido, cantidad: number): string | null {
  if (producto.tipo !== "PV") {
    return `"${producto.nombre}" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).`;
  }
  if (producto.pasoVenta !== null) {
    if (!cumplePaso(cantidad, producto.pasoVenta)) return `"${producto.nombre}": ${mensajeCantidadNoCumplePaso(producto.pasoVenta)}`;
  }
  return null;
}
