/**
 * M.2 (P6): la parte de la PANTALLA de la clave fina `producto_campos_sensibles`. El precio de venta, el factor de conversión, las unidades de un producto y el factor de sus presentaciones de
 * compra los cambia solo quien tiene esa clave; a quien no la tiene el formulario se los muestra como SOLO LECTURA, con el valor guardado y una línea que dice qué permiso hace falta.
 *
 * Es cortesía de la interfaz, no la barrera: el servidor decide (`SIN_PERMISO_CAMPOS_SENSIBLES`) y vuelve a chequear en cada acción. El permiso lo calcula el servidor (la página, con el gate) y baja como dato.
 * Un componente de servidor o de cliente puede usarlo: no tiene estado ni eventos.
 */

/** El nombre del permiso tal como se lo dice a la persona (la clave `producto_campos_sensibles` del catálogo de acciones; la matriz de permisos la lista con esa clave). */
const PERMISO = "«campos sensibles del producto» (producto_campos_sensibles, en Administración → Permisos)";

/** Un campo de producto que esta persona no puede cambiar: la etiqueta y el valor guardado, sin ningún control que se pueda editar. `campo` identifica el dato (para las pruebas). */
export function ValorSoloLectura({ campo, etiqueta, children }: { campo: string; etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5" data-solo-lectura={campo}>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{etiqueta}</span>
      <span className="rounded border border-dashed px-3 py-2 text-sm">{children}</span>
    </div>
  );
}

/** La línea que explica por qué esos campos están en solo lectura y qué permiso hace falta. `children` dice qué pasa en esa pantalla (por ejemplo, con qué valores se crea el producto). */
export function AvisoCamposSensibles({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-neutral-500 dark:text-neutral-400" data-aviso-campos-sensibles>
      Solo lectura: para cambiar el precio de venta, el factor de conversión y las unidades hace falta el permiso {PERMISO}. {children}
    </p>
  );
}

/** Lo mismo para la gestión de presentaciones de compra, que vive dentro del formulario de edición (que ya tiene su aviso): una línea corta, sin repetir la explicación. */
export function AvisoPresentacionesSinPermiso() {
  return (
    <p className="text-xs text-neutral-500 dark:text-neutral-400" data-aviso-presentaciones-sin-permiso>
      Agregar una presentación nueva (con su factor de conversión) necesita el permiso {PERMISO}. Las que ya están se pueden activar o desactivar.
    </p>
  );
}
