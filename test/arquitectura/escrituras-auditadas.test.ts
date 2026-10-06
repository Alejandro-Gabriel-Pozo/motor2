import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: lo que mueve plata y se edita a mano deja su rastro en la auditoría administrativa (`RegistroAuditoria`).
 * Hoy son cinco modelos: `Cliente` (su % de descuento se congela en cada cuenta), `DescuentoProductoSucursal` (el % de un producto en una
 * sucursal), `PrecioLocalProducto` (el precio propio de una sucursal), `RendimientoLocalIngrediente` (el rendimiento propio de una sucursal,
 * que mueve el costo) y `DisponibilidadProducto` (qué se vende en cada sucursal). Un archivo de `src/` que escriba una de esas tablas (create/update/upsert/delete y sus variantes en lote) tiene que llamar a
 * `registrarCambioAuditado` — es el único punto de escritura del registro. Sin esto, una acción nueva que edite el % por otro camino no
 * deja quién ni cuándo, y TypeScript no lo detecta.
 *
 * Además, hay archivos donde la auditoría es obligatoria aunque no escriban esos modelos: `asignarClienteACuenta` pone o saca el cliente
 * (y su % congelado) de una cuenta, y la `Operacion` de la venta solo guarda a quien cerró la cuenta.
 *
 * Cómo se controla: lectura estática del código fuente, fuera de los comentarios.
 */
const RAIZ = join(__dirname, "../../src");
const MODELOS_AUDITADOS = ["cliente", "descuentoProductoSucursal", "precioLocalProducto", "rendimientoLocalIngrediente", "disponibilidadProducto"];
/** La persistencia (`server/persistencia/`) solo escribe lo que le pide un caso de uso: la auditoría la deja ese caso de uso, y está en la lista de abajo. */
const CARPETA_DE_PERSISTENCIA = "server/persistencia/";
const ARCHIVOS_CON_AUDITORIA_OBLIGATORIA = ["server/actions/pos/cuenta-apertura.ts", "server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts"];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((linea) => {
      const t = linea.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
    })
    .join("\n");
}

const ESCRIBE_MODELO_AUDITADO = new RegExp(`\\.(${MODELOS_AUDITADOS.join("|")})\\s*\\.\\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`);
const AUDITA = /\bregistrarCambioAuditado\s*\(/;

describe("escrituras auditadas: lo que mueve plata deja quién y cuándo", () => {
  const rutas = archivos(RAIZ).map((ruta) => ({ nombre: relative(RAIZ, ruta).split(sep).join("/"), codigo: sinComentarios(readFileSync(ruta, "utf8")) }));

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("todo archivo que escribe un modelo auditado (cliente, descuento, precio local, rendimiento local, disponibilidad) llama a registrarCambioAuditado", () => {
    const escritores = rutas.filter((r) => !r.nombre.startsWith(CARPETA_DE_PERSISTENCIA) && ESCRIBE_MODELO_AUDITADO.test(r.codigo));
    expect(escritores.length, "ya no hay escritores de los modelos auditados: ¿se renombró un modelo y la regla quedó vacía?").toBeGreaterThan(0);
    const sinAuditoria = escritores.filter((r) => !AUDITA.test(r.codigo)).map((r) => r.nombre);
    expect(
      sinAuditoria,
      `Estos archivos escriben ${MODELOS_AUDITADOS.join(" / ")} sin dejar fila en la auditoría (usá registrarCambioAuditado de core/permisos/auditoria):\n${sinAuditoria.join("\n")}`
    ).toEqual([]);
  });

  it("los archivos con auditoría obligatoria existen y la llaman", () => {
    for (const nombre of ARCHIVOS_CON_AUDITORIA_OBLIGATORIA) {
      const archivo = rutas.find((r) => r.nombre === nombre);
      expect(archivo, `${nombre} ya no existe: actualizá la lista`).toBeDefined();
      expect(AUDITA.test(archivo!.codigo), `${nombre} no llama a registrarCambioAuditado`).toBe(true);
    }
  });
});
