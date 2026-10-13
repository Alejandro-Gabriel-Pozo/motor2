import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { NivelDeAccion } from "../../../src/core/permisos/acciones";
import { esArchivoUseServer } from "./analizador";
import { archivosTs, exportadasQueAlcanzan, grafoDeImports, importadoresDe, lectoresEnFuente, modelosDelSchema, paginasQueAlcanzan } from "./lectores-de-campos";

/**
 * La lista de campos sensibles de GT-1 y el recorrido que dice QUIÉN los pide y A QUÉ PÁGINAS llegan (tanda T14 del plan de endurecimiento de seguridad). La comparten
 * `campos-sensibles-lectores.test.ts` (GT-1: cada página con el piso del campo) y `grupos-de-datos-con-sus-claves.test.ts` (GT-2: cada grupo de datos con SUS claves).
 */

export type Piso = NivelDeAccion | "NUNCA";
export interface CampoSensible {
  piso: Piso;
  dato: string;
}

/** `Modelo.campo` (o `Modelo.relación`) → el piso que merece y de qué dato se trata. */
export const CAMPOS: Readonly<Record<string, CampoSensible>> = {
  "Producto.precioConsignacion": { piso: "administrador", dato: "el costo de consignación (S-12, D8: `pagar_consignante`)" },
  "Producto.proveedorConsignacionId": { piso: "administrador", dato: "el consignante del producto (S-12, D8)" },
  "MovimientoStock.precioTotal": { piso: "administrador", dato: "el importe de una línea del Kardex" },
  "MovimientoStock.precioPorUnidadStock": { piso: "administrador", dato: "el costo por unidad de una línea del Kardex" },
  "MovimientoStock.costoUnitarioVenta": { piso: "administrador", dato: "el costo congelado de lo vendido" },
  "MovimientoStock.precioListaUnitario": { piso: "administrador", dato: "el precio de lista congelado de lo vendido" },
  "Operacion.nroFactura": { piso: "administrador", dato: "el N.º de factura de una compra (`reporte_historial_importes`, S-14)" },
  "Operacion.proveedorId": { piso: "administrador", dato: "el proveedor de una operación (`reporte_historial_importes`, S-14)" },
  "Operacion.proveedor": { piso: "administrador", dato: "el proveedor de una operación, como relación (el nombre; `reporte_historial_importes`, S-14)" },
  "Producto.proveedorConsignacion": { piso: "administrador", dato: "el consignante del producto, como relación (S-12, D8)" },
  "PagoConsignante.importe": { piso: "administrador", dato: "lo pagado a un consignante" },
  "FacturaProveedor.importeTotal": { piso: "administrador", dato: "el total de una factura de proveedor (Paquete 3, M3b; copia con IVA incluido, como `MovimientoStock.precioTotal`)" },
  "FacturaProveedorRenglon.precioTotal": { piso: "administrador", dato: "el importe de un renglón de factura de proveedor (Paquete 3, M3b)" },
  "FacturaProveedorRenglon.precioPorUnidadStock": { piso: "administrador", dato: "el costo por unidad de un renglón de factura de proveedor (Paquete 3, M3b)" },
  "FacturaProveedor.importeNeto": { piso: "administrador", dato: "el neto del comprobante de una factura de proveedor (Paquete 3, M3d)" },
  "FacturaProveedor.importeIva": { piso: "administrador", dato: "el IVA del comprobante de una factura de proveedor (Paquete 3, M3d)" },
  "FacturaProveedorRenglon.importeNeto": { piso: "administrador", dato: "el neto de un renglón de factura de proveedor (Paquete 3, M3d)" },
  "FacturaProveedorRenglon.importeIva": { piso: "administrador", dato: "el IVA de un renglón de factura de proveedor (Paquete 3, M3d)" },
  "FacturaProveedorRenglon.importeIvaComputable": { piso: "administrador", dato: "el IVA computable de un renglón de factura de proveedor (Paquete 3, M3d)" },
  "FacturaProveedorTributo.importe": { piso: "administrador", dato: "un tributo (percepción o impuesto) de una factura de proveedor (Paquete 3, M3d)" },
  "ImputacionDeGasto.importe": { piso: "administrador", dato: "lo que le toca a una sucursal de un gasto cargado en una factura de proveedor (Paquete 3, M4.3; con IVA incluido)" },
  "ImputacionDeGasto.importeIvaComputable": { piso: "administrador", dato: "el IVA computable de lo que le toca a una sucursal de un gasto (Paquete 3, M4.3)" },
  "NotaCreditoProveedor.importeTotal": { piso: "administrador", dato: "el total de una nota de crédito de proveedor (Paquete 4, M6; con IVA incluido, como `FacturaProveedor.importeTotal`)" },
  "NotaCreditoProveedor.importeNeto": { piso: "administrador", dato: "el neto del comprobante de una nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedor.importeIva": { piso: "administrador", dato: "el IVA del comprobante de una nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorLinea.importe": { piso: "administrador", dato: "lo acreditado por una línea de nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorLinea.importeNeto": { piso: "administrador", dato: "el neto de una línea de nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorLinea.importeIva": { piso: "administrador", dato: "el IVA de una línea de nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorLinea.importeIvaComputable": { piso: "administrador", dato: "el IVA computable de una línea de nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorImputacion.importe": { piso: "administrador", dato: "lo que le toca a una sucursal de una línea de nota de crédito de proveedor (Paquete 4, M6; con IVA incluido)" },
  "NotaCreditoProveedorImputacion.importeIvaComputable": { piso: "administrador", dato: "el IVA computable de lo que le toca a una sucursal de una nota de crédito de proveedor (Paquete 4, M6)" },
  "NotaCreditoProveedorTributo.importe": { piso: "administrador", dato: "un tributo (percepción o impuesto) de una nota de crédito de proveedor (Paquete 4, M6)" },
  "DistribucionCostoLinea.importe": { piso: "administrador", dato: "lo que le toca a un centro de costos de un gasto distribuido (Paquete 5, M7; con IVA incluido)" },
  "DistribucionCostoLinea.importeIvaComputable": { piso: "administrador", dato: "el IVA computable de lo que le toca a un centro de costos de un gasto distribuido (Paquete 5, M7)" },
  "Venta.importeTotal": { piso: "administrador", dato: "el total cobrado de una venta (copia en la cabecera; como `MovimientoStock.precioTotal`, M2, DEC-E)" },
  "Proveedor.cuit": { piso: "administrador", dato: "el CUIT de un proveedor" },
  "Proveedor.email": { piso: "administrador", dato: "el correo de un proveedor" },
  "Proveedor.telefono": { piso: "administrador", dato: "el teléfono de un proveedor" },
  "Proveedor.contacto": { piso: "administrador", dato: "la persona de contacto de un proveedor" },
  "Proveedor.condicionesPago": { piso: "administrador", dato: "las condiciones de pago de un proveedor" },
  "Proveedor.notas": { piso: "administrador", dato: "las notas internas sobre un proveedor" },
  "User.email": { piso: "administrador_sistema", dato: "el correo de una cuenta" },
  "Invitacion.hashToken": { piso: "NUNCA", dato: "el hash del token de una invitación" },
  "Account.refresh_token": { piso: "NUNCA", dato: "el token de actualización de Google" },
  "Account.access_token": { piso: "NUNCA", dato: "el token de acceso de Google" },
  "Account.id_token": { piso: "NUNCA", dato: "el id_token de Google" },
  "Session.sessionToken": { piso: "NUNCA", dato: "el token de una sesión de la app" },
  "VerificationToken.token": { piso: "NUNCA", dato: "el token de verificación de Auth.js" },
  "AdminPlataforma.secretoTotp": { piso: "NUNCA", dato: "el secreto TOTP cifrado de un administrador de la consola" },
  "CodigoDeIngresoPlataforma.hashCodigo": { piso: "NUNCA", dato: "el HMAC del código de ingreso de la consola" },
  "CodigoDeRecuperacionPlataforma.hashCodigo": { piso: "NUNCA", dato: "el HMAC de un código de recuperación de la consola" },
  "SesionPlataforma.hashToken": { piso: "NUNCA", dato: "el hash del token de sesión de la consola" },
};

export interface Hallado {
  ruta: string;
  /** Los `Modelo.campo` que el archivo pide, ordenados. */
  campos: string[];
  /** Las páginas (`page.tsx`/`route.ts`) que lo muestran, por el grafo de imports. */
  paginas: string[];
  /** ¿Es una Server Action ("use server") de `src/server/actions`? Entonces es además una puerta HTTP. */
  esAccionUseServer: boolean;
}

const CARPETAS = ["src", "plataforma/src", "scripts"];

/** Todo archivo que pida a Prisma uno de los `CAMPOS`, con las páginas a las que llega. */
export function hallarLectores(raiz: string): { modelos: ReturnType<typeof modelosDelSchema>; hallados: Hallado[] } {
  const modelos = modelosDelSchema(readFileSync(join(raiz, "prisma/schema.prisma"), "utf8"));
  const sensibles = new Map<string, Set<string>>();
  for (const clave of Object.keys(CAMPOS)) {
    const [modelo, campo] = clave.split(".") as [string, string];
    sensibles.set(modelo, new Set([...(sensibles.get(modelo) ?? []), campo]));
  }
  const importadores = importadoresDe(grafoDeImports(raiz));
  const hallados: Hallado[] = [];
  for (const dir of CARPETAS) {
    for (const f of archivosTs(join(raiz, dir))) {
      const ruta = relative(raiz, f).split(sep).join("/");
      const codigo = readFileSync(f, "utf8");
      const hits = lectoresEnFuente(codigo, ruta, modelos, sensibles);
      if (!hits.length) continue;
      const funciones = [...new Set(hits.map((h) => h.funcion))];
      hallados.push({
        ruta,
        campos: [...new Set(hits.map((h) => h.campo))].sort(),
        paginas: paginasQueAlcanzan(ruta, importadores, exportadasQueAlcanzan(codigo, funciones, ruta)),
        esAccionUseServer: esArchivoUseServer(codigo, ruta) && ruta.startsWith("src/server/actions/"),
      });
    }
  }
  return { modelos, hallados };
}
