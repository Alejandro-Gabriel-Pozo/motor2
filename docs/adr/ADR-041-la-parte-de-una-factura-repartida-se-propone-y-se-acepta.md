# ADR-041: La parte de una factura repartida se PROPONE (la sucursal que compra) y se ACEPTA (cada sucursal destino)

> 2026-10-28, etapa E3a del circuito de abastecimiento. **Estado: migración escrita y ensayada SOLO en bases locales** (subir/bajar/subir; `test/aislamiento/e3a-propuesta-subir-bajar-subir.test.ts`). **REQUIERE AUTORIZACIÓN EXPRESA para aplicarla en cada base real**, base por base, con respaldo y ensayo en una rama de Neon. Diseño completo: `docs/diseno-factura-de-proveedor-e3a-2026-10-27.md`. Complementa ADR-029 (no lo reemplaza).

## Contexto

Decisión del dueño (2026-10-27): «desde la sucursal 3 hago la compra para la 3, la 4 y la 6; ellos aceptan». El operario común tiene alcance solo de su sucursal (ADR-028) y no hay personal de central obligatorio. La parte de cada destino nace pendiente y recién al aceptarla entran su stock, su costo y su gasto; los importes tipeados son los pesos exactos del reparto (3.000.000 = 2.000.000 + 1.000.000).

Con las tablas de ADR-029 eso no se podía hacer: (1) la parte (`FacturaProveedorSucursal`) solo guarda el porcentaje en puntos básicos, que no alcanza para importes exactos, y no hay dónde guardar qué productos y cuánto le toca a una parte pendiente; (2) la app no tiene UPDATE de `operacionId`; (3) la parte es `PROPIA`: la sucursal que carga no puede insertar la de otra sin ensanchar su alcance. Reclasificar la parte como `ENTRE_SUCURSALES` tampoco: su migración de políticas (M3c, aplicada en producción) tiene que seguir siendo la salida exacta del generador (`test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts`).

## Decisión

Tres tablas NUEVAS (migraciones `20261028100000_factura_proveedor_propuesta` y `20261028101000_rls_sucursal_factura_proveedor_propuesta`); no cambia ninguna tabla, política ni migración existente.

1. **`FacturaProveedorPropuesta`** (`ENTRE_SUCURSALES`: origen = la sucursal que carga, destino = la que acepta): una por (factura, destino), con `porcentajeDeclaradoBp` (intención), `estado` `PENDIENTE` → `ACEPTADA` (CHECK; `RECHAZADA` con motivo, después) y la aceptación (`aceptadaEn`, `aceptadaPorId`, `parteId`) si y solo si está aceptada. UPDATE solo de esas cuatro columnas.
2. **`FacturaProveedorPropuestaRenglon`** (`ENTRE_SUCURSALES`, las dos sucursales de su propuesta): cantidad (> 0) y pesos (≥ 0) de cada renglón para esa destino. Clave foránea de cinco columnas hacia su propuesta (misma factura y mismas sucursales) y de tres hacia el renglón (misma factura). Solo se agrega.
3. **`AnulacionDeFacturaProveedor`** (`DE_EMPRESA`): la anulación como registro nuevo, una por factura, con motivo, clave de reintento única global y huella. La cabecera además queda con `anuladaEn`/`anuladaPorId` (libera el número).

**Aceptar** = la destino, dentro de su propio alcance y en una transacción SERIALIZABLE que empieza con `SELECT … FOR UPDATE` de la cabecera: crea su compra (`Operacion` COMPRA + Kardex copiando los renglones de la propuesta), INSERTA su `FacturaProveedorSucursal` ya `RECIBIDA` con su `operacionId`, y marca la propuesta `ACEPTADA` con `WHERE estado = 'PENDIENTE'`. El índice único existente `(facturaProveedorId, sucursalId)` de la parte es la segunda barrera contra una doble aceptación. El comando no lleva cantidades ni importes: se acepta exactamente lo propuesto.

**La cabecera nace `CONFIRMADA`** (el reparto queda declarado completo al cargar; ADR-029 §5 reserva `PENDIENTE_DE_REPARTO` para «sin repartir, sin stock», y §5b exige `CONFIRMADA` para que entre el stock de la parte propia). Lo pendiente es la recepción de cada destino, que se ve derivado («N de M partes aceptadas»). Con la factura anulada, las propuestas pendientes quedan marcadas por la anulación (estado efectivo «anulada») y no se aceptan más.

## Consecuencias

- Nadie ensancha su alcance: la sucursal que carga escribe en la «zona» de la destino solo la propuesta y sus renglones (nunca stock, compras ni partes). `conEscrituraEnLaEmpresa` no se usa.
- Lo que la base no decide (sin disparadores): que la parte propia más las propuestas sumen 10000 puntos básicos y cada renglón sume su importe y su cantidad (lo verifica el único escritor antes de escribir y una consulta de coherencia), que no se vuelva de `ACEPTADA` a `PENDIENTE` por SQL directo, que solo la destino acepte (la política deja también al origen; lo impide el caso de uso).
- La reversa de la migración aborta si hay propuestas, renglones de propuesta o anulaciones.
