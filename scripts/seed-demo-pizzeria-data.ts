// AUTO-GENERADO desde datos_demo_pizzeria.xlsx (compartido por el usuario) — ver scripts/seed-demo-pizzeria.ts para el mapeo y las decisiones de diseño.

export interface DatoProveedor { codigo: string; nombre: string; contacto?: string; telefono?: string; email?: string; cuit?: string; condicionesPago?: string; notas?: string; activo: boolean; }
export const PROVEEDORES: DatoProveedor[] = [
  { codigo: "PRV_HARINAS", nombre: "Molino San Cayetano", contacto: "Diego Ferreyra", telefono: "11-4555-2310", email: "ventas@sancayetano.com.ar", cuit: "30-70812345-1", condicionesPago: "Cta cte 15 días", notas: "Harinas y aceites; entrega martes y viernes", activo: true },
  { codigo: "PRV_LACTEOS", nombre: "Distribuidora Láctea Los Aromos", contacto: "Marina Suárez", telefono: "11-4890-1122", email: "pedidos@losaromos.com.ar", cuit: "30-65321988-8", condicionesPago: "Contado con 5% desc.", notas: "Muzzarella y quesos; pedido mínimo 20kg", activo: true },
  { codigo: "PRV_VERDULERIA", nombre: "Verdulería El Quinto Sabor", contacto: "Hugo Paz", telefono: "11-4023-7788", email: undefined, cuit: "27-30456123-3", condicionesPago: "Contado", notas: "Verdura y fruta fresca, entrega diaria", activo: true },
  { codigo: "PRV_FIAMBRES", nombre: "Fiambrería Rossi Hnos.", contacto: "Claudio Rossi", telefono: "11-4670-9944", email: "ventas@fiambresrossi.com.ar", cuit: "30-58900123-7", condicionesPago: "Cta cte 7 días", notas: "Jamón, panceta y fiambres", activo: true },
  { codigo: "PRV_BEBIDAS", nombre: "Distribuidora Full Drinks SRL", contacto: "Lucía Fernández", telefono: "11-4321-6600", email: "comercial@fulldrinks.com.ar", cuit: "30-71234567-1", condicionesPago: "Cta cte 30 días", notas: "Cerveza, gaseosas, agua y vinos", activo: true },
  { codigo: "PRV_DESCARTABLES", nombre: "Envases y Cajas del Sur", contacto: "Martín Ibarra", telefono: "11-4988-3321", email: "ventas@cajasdelsur.com.ar", cuit: "20-28765432-5", condicionesPago: "Contado", notas: "Cajas de pizza, descartables y limpieza", activo: true },
  { codigo: "PRV_ALMACEN", nombre: "Almacén Mayorista San Martín", contacto: "Rita Gómez", telefono: "11-4777-5511", email: "mayorista@sanmartin.com.ar", cuit: "30-69988776-1", condicionesPago: "Cta cte 15 días", notas: "Aceite, sal, levadura, conservas y condimentos", activo: true },
  { codigo: "PRV_EXPROVEEDOR", nombre: "Fiambrería del Barrio (ya no compramos)", contacto: "Norma Díaz", telefono: "11-4200-1010", email: undefined, cuit: "27-20112233-9", condicionesPago: "Contado", notas: "Se dejó de usar por precio; queda como ejemplo de proveedor inactivo", activo: false },
];

export interface DatoProducto { codigo: string; nombre: string; tipo: 'MP' | 'PV'; categoria: string; unidadCompra?: string; unidadStock: string; factorConversion: number; activo: boolean; observaciones?: string; precioVenta: number; seProduce: boolean; }
export const PRODUCTOS: DatoProducto[] = [
  { codigo: "MP001", nombre: "Harina 000", tipo: "MP", categoria: "Cocina", unidadCompra: "BOL", unidadStock: "KG", factorConversion: 25, activo: true, observaciones: "Bolsa x25kg", precioVenta: 0, seProduce: false },
  { codigo: "MP002", nombre: "Levadura fresca", tipo: "MP", categoria: "Cocina", unidadCompra: "PAQ", unidadStock: "KG", factorConversion: 0.5, activo: true, observaciones: "Paquete x500g", precioVenta: 0, seProduce: false },
  { codigo: "MP003", nombre: "Sal fina", tipo: "MP", categoria: "Cocina", unidadCompra: "BOL", unidadStock: "KG", factorConversion: 5, activo: true, observaciones: "Bolsa x5kg", precioVenta: 0, seProduce: false },
  { codigo: "MP004", nombre: "Aceite de oliva", tipo: "MP", categoria: "Cocina", unidadCompra: "CJ", unidadStock: "LT", factorConversion: 4, activo: true, observaciones: "Caja x4 litros", precioVenta: 0, seProduce: false },
  { codigo: "MP005", nombre: "Tomate triturado", tipo: "MP", categoria: "Cocina", unidadCompra: "LATA", unidadStock: "KG", factorConversion: 3, activo: true, observaciones: "Lata x3kg, base de la salsa", precioVenta: 0, seProduce: false },
  { codigo: "MP006", nombre: "Muzzarella", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: "A granel", precioVenta: 0, seProduce: false },
  { codigo: "MP007", nombre: "Queso parmesano rallado", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP008", nombre: "Jamón cocido", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP009", nombre: "Panceta ahumada", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP010", nombre: "Aceitunas verdes descarozadas", tipo: "MP", categoria: "Cocina", unidadCompra: "BALDE", unidadStock: "KG", factorConversion: 2, activo: true, observaciones: "Balde x2kg", precioVenta: 0, seProduce: false },
  { codigo: "MP011", nombre: "Morrón rojo", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP012", nombre: "Cebolla", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP013", nombre: "Champiñones", tipo: "MP", categoria: "Cocina", unidadCompra: "LATA", unidadStock: "KG", factorConversion: 0.8, activo: true, observaciones: "Lata x800g", precioVenta: 0, seProduce: false },
  { codigo: "MP014", nombre: "Orégano seco", tipo: "MP", categoria: "Cocina", unidadCompra: "PAQ", unidadStock: "KG", factorConversion: 0.1, activo: true, observaciones: "Paquete x100g", precioVenta: 0, seProduce: false },
  { codigo: "MP015", nombre: "Ajo", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP016", nombre: "Tomate perita fresco", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: "Para la napolitana", precioVenta: 0, seProduce: false },
  { codigo: "MP017", nombre: "Provolone", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP018", nombre: "Roquefort", tipo: "MP", categoria: "Cocina", unidadCompra: "KG", unidadStock: "KG", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 0, seProduce: false },
  { codigo: "MP019", nombre: "Cajas de pizza grande", tipo: "MP", categoria: "Salón", unidadCompra: "PAQ", unidadStock: "UN", factorConversion: 50, activo: true, observaciones: "Paquete x50 unidades", precioVenta: 0, seProduce: false },
  { codigo: "MP020", nombre: "Cajas de pizza chica", tipo: "MP", categoria: "Salón", unidadCompra: "PAQ", unidadStock: "UN", factorConversion: 50, activo: true, observaciones: "Paquete x50 unidades", precioVenta: 0, seProduce: false },
  { codigo: "OT001", nombre: "Detergente para vajilla", tipo: "MP", categoria: "Vajilla", unidadCompra: "BOT", unidadStock: "BOT", factorConversion: 1, activo: true, observaciones: "Stock vajilla", precioVenta: 0, seProduce: false },
  { codigo: "OT002", nombre: "Lavandina", tipo: "MP", categoria: "Limpieza", unidadCompra: "LT", unidadStock: "LT", factorConversion: 1, activo: true, observaciones: "Limpieza general", precioVenta: 0, seProduce: false },
  { codigo: "MPZ01", nombre: "Prepizza masa grande (28cm)", tipo: "MP", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se produce por lote (bollos estibados); no se vende suelta", precioVenta: 0, seProduce: true },
  { codigo: "MPZ02", nombre: "Prepizza masa chica (20cm)", tipo: "MP", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se produce por lote (bollos estibados); no se vende suelta", precioVenta: 0, seProduce: true },
  { codigo: "MX002", nombre: "Cerveza rubia porrón caja x24", tipo: "MP", categoria: "Barra", unidadCompra: "CJ", unidadStock: "UN", factorConversion: 24, activo: true, observaciones: "Se compra por caja; lo que se vende es PV007", precioVenta: 0, seProduce: false },
  { codigo: "PV007", nombre: "Cerveza rubia porrón 473ml", tipo: "PV", categoria: "Barra", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Lo que ve el cliente", precioVenta: 3200, seProduce: false },
  { codigo: "MX003", nombre: "Gaseosa cola caja x24 latas", tipo: "MP", categoria: "Barra", unidadCompra: "CJ", unidadStock: "UN", factorConversion: 24, activo: true, observaciones: "Se compra por caja; lo que se vende es PV008", precioVenta: 0, seProduce: false },
  { codigo: "PV008", nombre: "Gaseosa cola lata 354ml", tipo: "PV", categoria: "Barra", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 1800, seProduce: false },
  { codigo: "MX004", nombre: "Agua mineral s/gas caja x12", tipo: "MP", categoria: "Barra", unidadCompra: "CJ", unidadStock: "UN", factorConversion: 12, activo: true, observaciones: "Se compra por caja; lo que se vende es PV009", precioVenta: 0, seProduce: false },
  { codigo: "PV009", nombre: "Agua mineral 500ml", tipo: "PV", categoria: "Barra", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 1500, seProduce: false },
  { codigo: "MX005", nombre: "Vino tinto de la casa caja x6", tipo: "MP", categoria: "Barra", unidadCompra: "CJ", unidadStock: "UN", factorConversion: 6, activo: true, observaciones: "Se compra por caja; se vende por copa o por botella", precioVenta: 0, seProduce: false },
  { codigo: "PV010", nombre: "Copa de vino tinto", tipo: "PV", categoria: "Barra", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "1 botella rinde 6 copas", precioVenta: 2200, seProduce: false },
  { codigo: "PV011", nombre: "Botella de vino tinto 750ml", tipo: "PV", categoria: "Barra", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: undefined, precioVenta: 9500, seProduce: false },
  { codigo: "PV020", nombre: "Pizza Muzzarella grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender, consume 1 Prepizza grande", precioVenta: 9800, seProduce: false },
  { codigo: "PV021", nombre: "Pizza Muzzarella chica", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender, consume 1 Prepizza chica", precioVenta: 6200, seProduce: false },
  { codigo: "PV022", nombre: "Pizza Napolitana grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 10800, seProduce: false },
  { codigo: "PV023", nombre: "Pizza Fugazzeta grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 11500, seProduce: false },
  { codigo: "PV024", nombre: "Pizza Especial grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 12200, seProduce: false },
  { codigo: "PV025", nombre: "Pizza Calabresa grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 11800, seProduce: false },
  { codigo: "PV026", nombre: "Pizza Cuatro Quesos grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 12800, seProduce: false },
  { codigo: "PV027", nombre: "Pizza Vegetariana grande", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se arma al vender", precioVenta: 11200, seProduce: false },
  { codigo: "PV099", nombre: "Pizza Rúcula y jamón crudo", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: false, observaciones: "Fuera de carta a propósito (ejemplo de inactivo)", precioVenta: 0, seProduce: false },
  { codigo: "MP099", nombre: "Harina integral (descontinuada)", tipo: "MP", categoria: "Cocina", unidadCompra: "BOL", unidadStock: "KG", factorConversion: 25, activo: false, observaciones: "MP fuera de uso (ejemplo de inactivo)", precioVenta: 0, seProduce: false },
  // Agregado manualmente (no viene del xlsx), mismo criterio que MP011B: falta un caso donde un PV "se produce" — el
  // resto de la carta "se arma al vender" (sin stock propio significativo, ver docstring de obtenerResumenOperativo).
  // Horneada por bandeja de antemano y vendida por porción: acá el saldo del PV SÍ es información real (§5, docs/planes-
  // demo-y-claridad-reportes-2026-09-21.md).
  { codigo: "PV030", nombre: "Pizza al corte (porción)", tipo: "PV", categoria: "Cocina", unidadCompra: "UN", unidadStock: "UN", factorConversion: 1, activo: true, observaciones: "Se produce por bandeja horneada de antemano (12 porciones); se vende por porción — a diferencia del resto de la carta, no se arma al momento.", precioVenta: 3800, seProduce: true },
];

export interface DatoPrecioProveedor { productoCodigo: string; proveedorCodigo: string; precioUnitarioCompra: number; unidadCompra: string; precioPorUnidadStock: number; }
export const PRECIOS_REFERENCIA: DatoPrecioProveedor[] = [
  { productoCodigo: "MP001", proveedorCodigo: "PRV_HARINAS", precioUnitarioCompra: 21500, unidadCompra: "BOL", precioPorUnidadStock: 860 },
  { productoCodigo: "MP001", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 22300, unidadCompra: "BOL", precioPorUnidadStock: 892 },
  { productoCodigo: "MP002", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 2100, unidadCompra: "PAQ", precioPorUnidadStock: 4200 },
  { productoCodigo: "MP003", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 3500, unidadCompra: "BOL", precioPorUnidadStock: 700 },
  { productoCodigo: "MP004", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 34800, unidadCompra: "CJ", precioPorUnidadStock: 8700 },
  { productoCodigo: "MP004", proveedorCodigo: "PRV_HARINAS", precioUnitarioCompra: 36200, unidadCompra: "CJ", precioPorUnidadStock: 9050 },
  { productoCodigo: "MP005", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 6300, unidadCompra: "LATA", precioPorUnidadStock: 2100 },
  { productoCodigo: "MP006", proveedorCodigo: "PRV_LACTEOS", precioUnitarioCompra: 9800, unidadCompra: "KG", precioPorUnidadStock: 9800 },
  { productoCodigo: "MP006", proveedorCodigo: "PRV_FIAMBRES", precioUnitarioCompra: 10400, unidadCompra: "KG", precioPorUnidadStock: 10400 },
  { productoCodigo: "MP007", proveedorCodigo: "PRV_LACTEOS", precioUnitarioCompra: 15600, unidadCompra: "KG", precioPorUnidadStock: 15600 },
  { productoCodigo: "MP008", proveedorCodigo: "PRV_FIAMBRES", precioUnitarioCompra: 12300, unidadCompra: "KG", precioPorUnidadStock: 12300 },
  { productoCodigo: "MP009", proveedorCodigo: "PRV_FIAMBRES", precioUnitarioCompra: 13800, unidadCompra: "KG", precioPorUnidadStock: 13800 },
  { productoCodigo: "MP010", proveedorCodigo: "PRV_VERDULERIA", precioUnitarioCompra: 8200, unidadCompra: "BALDE", precioPorUnidadStock: 4100 },
  { productoCodigo: "MP011", proveedorCodigo: "PRV_VERDULERIA", precioUnitarioCompra: 2600, unidadCompra: "KG", precioPorUnidadStock: 2600 },
  { productoCodigo: "MP012", proveedorCodigo: "PRV_VERDULERIA", precioUnitarioCompra: 1100, unidadCompra: "KG", precioPorUnidadStock: 1100 },
  { productoCodigo: "MP013", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 3900, unidadCompra: "LATA", precioPorUnidadStock: 4875 },
  { productoCodigo: "MP014", proveedorCodigo: "PRV_ALMACEN", precioUnitarioCompra: 2300, unidadCompra: "PAQ", precioPorUnidadStock: 23000 },
  { productoCodigo: "MP015", proveedorCodigo: "PRV_VERDULERIA", precioUnitarioCompra: 3200, unidadCompra: "KG", precioPorUnidadStock: 3200 },
  { productoCodigo: "MP016", proveedorCodigo: "PRV_VERDULERIA", precioUnitarioCompra: 1800, unidadCompra: "KG", precioPorUnidadStock: 1800 },
  { productoCodigo: "MP017", proveedorCodigo: "PRV_LACTEOS", precioUnitarioCompra: 11200, unidadCompra: "KG", precioPorUnidadStock: 11200 },
  { productoCodigo: "MP018", proveedorCodigo: "PRV_LACTEOS", precioUnitarioCompra: 16800, unidadCompra: "KG", precioPorUnidadStock: 16800 },
  { productoCodigo: "MP019", proveedorCodigo: "PRV_DESCARTABLES", precioUnitarioCompra: 9500, unidadCompra: "PAQ", precioPorUnidadStock: 190 },
  { productoCodigo: "MP020", proveedorCodigo: "PRV_DESCARTABLES", precioUnitarioCompra: 7200, unidadCompra: "PAQ", precioPorUnidadStock: 144 },
  { productoCodigo: "OT001", proveedorCodigo: "PRV_DESCARTABLES", precioUnitarioCompra: 4200, unidadCompra: "BOT", precioPorUnidadStock: 4200 },
  { productoCodigo: "OT002", proveedorCodigo: "PRV_DESCARTABLES", precioUnitarioCompra: 1900, unidadCompra: "LT", precioPorUnidadStock: 1900 },
  { productoCodigo: "MX002", proveedorCodigo: "PRV_BEBIDAS", precioUnitarioCompra: 52800, unidadCompra: "CJ", precioPorUnidadStock: 2200 },
  { productoCodigo: "MX003", proveedorCodigo: "PRV_BEBIDAS", precioUnitarioCompra: 31200, unidadCompra: "CJ", precioPorUnidadStock: 1300 },
  { productoCodigo: "MX004", proveedorCodigo: "PRV_BEBIDAS", precioUnitarioCompra: 10800, unidadCompra: "CJ", precioPorUnidadStock: 900 },
  { productoCodigo: "MX005", proveedorCodigo: "PRV_BEBIDAS", precioUnitarioCompra: 42000, unidadCompra: "CJ", precioPorUnidadStock: 7000 },
];

export interface DatoIngredienteReceta { insumoCodigo: string; cantidad: number; unidad: string; mermaPorcentaje: number; observaciones?: string; }
export interface DatoReceta { productoCodigo: string; ingredientes: DatoIngredienteReceta[]; }
export const RECETAS: DatoReceta[] = [
  { productoCodigo: "MPZ01", ingredientes: [
    { insumoCodigo: "MP001", cantidad: 0.32, unidad: "KG", mermaPorcentaje: 3, observaciones: "Harina para el bollo" },
    { insumoCodigo: "MP002", cantidad: 0.008, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP003", cantidad: 0.006, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP004", cantidad: 0.025, unidad: "LT", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "MPZ02", ingredientes: [
    { insumoCodigo: "MP001", cantidad: 0.2, unidad: "KG", mermaPorcentaje: 3, observaciones: "Harina para el bollo" },
    { insumoCodigo: "MP002", cantidad: 0.005, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP003", cantidad: 0.004, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP004", cantidad: 0.015, unidad: "LT", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV020", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "Se consume AL VENDER, no al producir" },
    { insumoCodigo: "MP005", cantidad: 0.12, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.25, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP014", cantidad: 0.004, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV021", ingredientes: [
    { insumoCodigo: "MPZ02", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "Se consume AL VENDER, no al producir" },
    { insumoCodigo: "MP005", cantidad: 0.08, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.16, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP014", cantidad: 0.003, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP020", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV022", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP005", cantidad: 0.1, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.18, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP016", cantidad: 0.1, unidad: "KG", mermaPorcentaje: 5, observaciones: "En rodajas" },
    { insumoCodigo: "MP015", cantidad: 0.01, unidad: "KG", mermaPorcentaje: 0, observaciones: "Laminado" },
    { insumoCodigo: "MP014", cantidad: 0.005, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV023", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.32, unidad: "KG", mermaPorcentaje: 5, observaciones: "Extra muzzarella" },
    { insumoCodigo: "MP012", cantidad: 0.18, unidad: "KG", mermaPorcentaje: 8, observaciones: "Se reduce al cocinar" },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV024", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP005", cantidad: 0.1, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.2, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP008", cantidad: 0.08, unidad: "KG", mermaPorcentaje: 3, observaciones: undefined },
    { insumoCodigo: "MP011", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP010", cantidad: 0.03, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV025", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP005", cantidad: 0.1, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.2, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP009", cantidad: 0.08, unidad: "KG", mermaPorcentaje: 3, observaciones: undefined },
    { insumoCodigo: "MP011", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV026", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.18, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP007", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP017", cantidad: 0.08, unidad: "KG", mermaPorcentaje: 3, observaciones: undefined },
    { insumoCodigo: "MP018", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 3, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV027", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP005", cantidad: 0.1, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.15, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP011", cantidad: 0.06, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP013", cantidad: 0.06, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP012", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 8, observaciones: undefined },
    { insumoCodigo: "MP010", cantidad: 0.03, unidad: "KG", mermaPorcentaje: 0, observaciones: undefined },
    { insumoCodigo: "MP019", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: undefined },
  ] },
  { productoCodigo: "PV007", ingredientes: [
    { insumoCodigo: "MX002", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "1 unidad de stock por venta" },
  ] },
  { productoCodigo: "PV008", ingredientes: [
    { insumoCodigo: "MX003", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "1 unidad de stock por venta" },
  ] },
  { productoCodigo: "PV009", ingredientes: [
    { insumoCodigo: "MX004", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "1 unidad de stock por venta" },
  ] },
  { productoCodigo: "PV010", ingredientes: [
    { insumoCodigo: "MX005", cantidad: 0.1667, unidad: "UN", mermaPorcentaje: 0, observaciones: "1 botella rinde 6 copas" },
  ] },
  { productoCodigo: "PV011", ingredientes: [
    { insumoCodigo: "MX005", cantidad: 1, unidad: "UN", mermaPorcentaje: 0, observaciones: "1 unidad de stock por venta" },
  ] },
  // PV030 (agregado manual, ver PRODUCTOS): a diferencia del resto, esta receta se consume al PRODUCIR (la bandeja), no al
  // vender — la venta solo descuenta el stock propio del PV, ya horneado.
  { productoCodigo: "PV030", ingredientes: [
    { insumoCodigo: "MPZ01", cantidad: 0.125, unidad: "UN", mermaPorcentaje: 0, observaciones: "1/8 de una prepizza grande por porción" },
    { insumoCodigo: "MP005", cantidad: 0.05, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
    { insumoCodigo: "MP006", cantidad: 0.06, unidad: "KG", mermaPorcentaje: 5, observaciones: undefined },
  ] },
];
