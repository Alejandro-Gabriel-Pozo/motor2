/**
 * DIMENSIONES DEL IMPORTADOR (regla del dueño «Combinaciones», 2026-10-28; diseño §10 y ADENDA A.8): cada columna que el importador LEE, cada campo que ESCRIBE y cada clave del archivo de
 * correcciones, con si afecta (dinero, permisos, visibilidad o stock) y por qué. El guardián `test/catalogo/importacion/dimensiones-del-importador.test.ts` falla si el normalizador acepta una
 * columna, el plan o la persistencia escriben un campo, o el archivo de correcciones admite una clave que no está acá (y al revés: una declaración que ya no se usa).
 *
 * `afecta`:
 *  - `SI`: cambia lo que se escribe (dinero, disponibilidad, carta);
 *  - `CONTROL`: no se escribe, pero se valida contra otra hoja (una diferencia es error);
 *  - `AVISO`: solo produce avisos en la vista previa;
 *  - `NO`: se lee y no cambia nada (informativa); se muestra en «No se importa».
 */
export type Afecta = "SI" | "CONTROL" | "AVISO" | "NO";

interface Dimension {
  afecta: Afecta;
  motivo: string;
}

export const DIMENSIONES_DEL_IMPORTADOR = {
  hojas: {
    Catálogo: {
      SKU: { afecta: "SI", motivo: "Clave natural del producto: `Producto.codigo` tal cual; idempotencia por código." },
      Categoría: { afecta: "SI", motivo: "Decide la sección de la carta por el mapeo de secciones (A.2); sin sección no hay contenido de carta." },
      "Producto base": { afecta: "SI", motivo: "Forma el nombre del producto (base + variantes)." },
      "Variante 1": { afecta: "SI", motivo: "Forma el nombre del producto." },
      "Variante 2": { afecta: "SI", motivo: "Forma el nombre del producto." },
      "Variante 3": { afecta: "SI", motivo: "Forma el nombre del producto." },
      "Marca / bodega": { afecta: "NO", motivo: "No se carga marca ni bodega (S4 del diseño)." },
      Huinganco: { afecta: "CONTROL", motivo: "Tiene que coincidir con el precio de «Precios por local» (I8)." },
      "Los Miches": { afecta: "CONTROL", motivo: "Tiene que coincidir con el precio de «Precios por local» (I8)." },
      Varvarco: { afecta: "CONTROL", motivo: "Tiene que coincidir con el precio de «Precios por local» (I8)." },
      "Manzano Amargo": { afecta: "CONTROL", motivo: "Tiene que coincidir con el precio de «Precios por local» (I8)." },
      "Las Ovejas": { afecta: "CONTROL", motivo: "Tiene que coincidir con el precio de «Precios por local» (I8)." },
      "Precio mín": { afecta: "NO", motivo: "Derivada de los precios por local: informativa." },
      "Precio máx": { afecta: "NO", motivo: "Derivada de los precios por local: informativa." },
      "Precio difiere": { afecta: "NO", motivo: "Derivada de los precios por local: informativa (el plan recalcula el precio único)." },
      "Sin stock en": { afecta: "NO", motivo: "Derivada de «Disponible» de «Precios por local»: informativa." },
    },
    "Precios por local": {
      SKU: { afecta: "SI", motivo: "Ata la fila a su producto de «Catálogo»." },
      "Producto base": { afecta: "CONTROL", motivo: "Tiene que coincidir con el de «Catálogo» (I8)." },
      Local: { afecta: "SI", motivo: "La sucursal (nombre exacto, una de las 5) de la disponibilidad y del contenido de carta." },
      Precio: { afecta: "SI", motivo: "Entra en el precio único por empresa (A.1) y decide si la fila va a la carta (sin precio no va)." },
      Disponible: { afecta: "SI", motivo: "`DisponibilidadProducto.disponible` de esa sucursal." },
      "Nombre en la carta": { afecta: "NO", motivo: "No existe nombre por sucursal (`ContenidoCartaProducto` no lo tiene): se reporta en la vista previa, no se carga." },
      "Descripción en la carta": { afecta: "SI", motivo: "`ContenidoCartaProducto.descripcion` de esa sucursal (validada como en la carta, I11)." },
    },
    Productos: {
      Categoría: { afecta: "AVISO", motivo: "Se compara con «Catálogo» solo para avisar (el Excel se contradice: 70 bases contra 71 pares)." },
      "Producto base": { afecta: "AVISO", motivo: "Se compara con «Catálogo» solo para avisar (par categoría-base)." },
      "Eje variante 1": { afecta: "AVISO", motivo: "Aviso de un eje declarado sin valores (Espumante: Tamaño)." },
      "Eje variante 2": { afecta: "AVISO", motivo: "Aviso de un eje declarado sin valores." },
      "Eje variante 3": { afecta: "AVISO", motivo: "Aviso de un eje declarado sin valores." },
      "Cant. SKUs": { afecta: "NO", motivo: "Derivada: informativa." },
      "Cant. locales": { afecta: "NO", motivo: "Derivada: informativa." },
      Locales: { afecta: "NO", motivo: "Derivada: informativa." },
    },
    Inconsistencias: {
      Tipo: { afecta: "AVISO", motivo: "Se copia tal cual a la hoja «Avisos» de la vista previa." },
      "SKU / producto": { afecta: "AVISO", motivo: "Se copia tal cual a la hoja «Avisos»." },
      Detalle: { afecta: "AVISO", motivo: "Se copia tal cual a la hoja «Avisos»." },
    },
  } satisfies Record<string, Record<string, Dimension>>,

  /** Hojas que se aceptan y no se leen. */
  hojasQueNoSeLeen: {
    Leeme: "Texto explicativo para personas: no tiene datos.",
  } as Record<string, string>,

  /** Campos que se ESCRIBEN, por modelo, con su motivo. */
  escribe: {
    Producto: {
      codigo: "El SKU (clave natural).",
      nombre: "Base + variantes (o la corrección «nombre»).",
      tipo: "PV: todo SKU se vende.",
      unidadStockId: "La unidad «unidad» (defecto declarado, 4.3).",
      factorConversion: "1 (defecto declarado, 4.3).",
      precioVenta: "El precio único por empresa (A.1), con IVA incluido, en ARS.",
      modoDeVenta: "DIRECTO (defecto declarado; las opciones son la Etapa 2).",
      seProduce: "false (defecto declarado).",
    },
    DisponibilidadProducto: {
      sucursalId: "El local de la fila.",
      productoId: "El producto creado.",
      disponible: "«Disponible» de la fila.",
    },
    RegistroAuditoria: {
      entidad: "Producto o ContenidoCartaProducto.",
      entidadId: "El id del producto, o `sucursal:producto` del contenido (como «Agregar a la carta»).",
      descripcion: "Con la huella y el origen del precio.",
      campo: "precioVenta o visibleEnCarta.",
      valorAnterior: "null (es un alta).",
      valorNuevo: "El precio o true.",
      actorId: "El usuario del actor (--actor).",
      sucursalId: "null en el producto (es de la empresa); la sucursal en el contenido.",
    },
  } as Record<string, Record<string, string>>,

  /** Claves del archivo de correcciones (`correcciones.json`), por parte. */
  correcciones: {
    archivo: {
      version: "Versión del formato (1).",
      reglaDePrecioUnico: "Si el dueño aceptó la regla del precio único (afecta el precio de los SKU con precios distintos).",
      correcciones: "Las correcciones nominales (afectan precio o nombre).",
      mapeoDeSecciones: "Categoría → sección de carta (afecta la carta).",
    },
    regla: { regla: "La regla (una sola existe).", fecha: "Cuándo la decidió el dueño.", motivo: "Por qué." },
    precioUnico: {
      tipo: "precioUnico.",
      sku: "El SKU corregido.",
      preciosEnElExcel: "Lo que trae el Excel (si cambia, error: I12).",
      valorACargar: "El precio único a cargar (manda sobre la regla).",
      fecha: "Cuándo.",
      motivo: "Por qué.",
    },
    nombre: {
      tipo: "nombre.",
      sku: "El SKU corregido.",
      valorEnElExcel: "El nombre que arma el Excel (si cambia, error: I12).",
      valorACargar: "El nombre a cargar.",
      fecha: "Cuándo.",
      motivo: "Por qué.",
    },
  } as Record<string, Record<string, string>>,
} as const;
