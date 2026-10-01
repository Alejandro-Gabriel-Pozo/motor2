import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (ADR-009): todo modelo por sucursal (con columna `sucursalId` en `prisma/schema.prisma`) tiene una FAMILIA de "qué
 * significa que NO haya fila", un EMBUDO (el archivo de `src/` donde se resuelve esa ausencia) y un MOTIVO. Un modelo nuevo por sucursal sin
 * entrada acá rompe el test: obliga a decidir la semántica de la ausencia a propósito, en vez de que cada lector la invente (la fuente típica
 * de inconsistencias: "sin fila = no disponible" en un lugar y "sin fila = disponible" en otro).
 *
 * Familias:
 *  - optin:    sin fila = NO (no disponible, no ofrecida, no publicada).
 *  - override: sin fila = vale el valor de la empresa.
 *  - ajuste:   sin fila = no aplica (sin descuento, sin mínimo, sin frecuencia, sin sección habitual).
 *  - optout:   sin fila = SÍ (capacidad habilitada).
 *  - propio:   la fila ES el dato de la sucursal (no hay "valor de empresa" ni "default" que la ausencia reemplace); el embudo no aplica.
 */
const RAIZ = join(__dirname, "../..");
const FAMILIAS = ["optin", "override", "ajuste", "optout", "propio"] as const;
type Familia = (typeof FAMILIAS)[number];

interface Entrada {
  familia: Familia;
  embudo: string | null;
  motivo: string;
}

const REGISTRO: Record<string, Entrada> = {
  DisponibilidadProducto: { familia: "optin", embudo: "src/core/catalogo/disponibilidad-producto.ts", motivo: "un producto sin fila de disponibilidad en la sucursal NO está disponible ahí (resolverDisponibilidad)." },
  PromoCartaSucursal: { familia: "optin", embudo: "src/core/carta/promo-sucursal.ts", motivo: "una promo sin fila activa en la sucursal NO se ofrece ahí (wherePromoOfrecidaEn); la fila además trae el precioLocal opcional." },
  SucursalPublica: { familia: "optin", embudo: "src/core/carta/publica-consulta.ts", motivo: "una sucursal sin fila de publicación NO tiene carta pública." },
  TemaCartaSucursal: { familia: "override", embudo: "src/core/carta/publica-consulta.ts", motivo: "sin tema propio la sucursal usa el tema de la empresa." },
  PrecioLocalProducto: { familia: "override", embudo: "src/core/catalogo/precio-local.ts", motivo: "sin precio local habilitado rige el precio de la empresa (filtrarPreciosLocalesVigentes)." },
  RendimientoLocalIngrediente: { familia: "override", embudo: "src/core/catalogo/rendimiento-local.ts", motivo: "sin override local rige el rendimiento central de la receta (rendimientoEfectivo)." },
  DescuentoProductoSucursal: { familia: "ajuste", embudo: "src/core/carta/descuento-producto-consulta.ts", motivo: "sin fila el producto no tiene descuento propio en la sucursal." },
  StockMinimoProducto: { familia: "ajuste", embudo: "src/core/stock/stock-minimo.ts", motivo: "sin fila no hay mínimo y no se alerta; el de sección gana sobre el global (elegirMinimo)." },
  FrecuenciaConteoProducto: { familia: "ajuste", embudo: "src/core/stock/frecuencia-conteo.ts", motivo: "sin fila el producto no tiene frecuencia de conteo (resolverProximoConteo con frecuencia 0: nunca vence)." },
  SeccionHabitualProducto: { familia: "ajuste", embudo: "src/core/stock/seccion-habitual.ts", motivo: "sin fila vigente el producto no tiene sección habitual (whereSeccionHabitualVigente)." },
  CapacidadSucursal: { familia: "optout", embudo: "src/core/permisos/capacidades-sucursal.ts", motivo: "sin fila la capacidad está HABILITADA; solo una fila con habilitado=false la apaga." },
  UsuarioSucursal: { familia: "propio", embudo: null, motivo: "la fila ES la membresía del usuario en la sucursal; no hay valor de empresa que la ausencia reemplace." },
  RegistroAuditoria: { familia: "propio", embudo: null, motivo: "es historia: cada fila es un hecho ocurrido (sucursalId nulo = hecho de empresa)." },
  PagoConsignante: { familia: "propio", embudo: null, motivo: "cada fila es un pago realizado en la sucursal." },
  Seccion: { familia: "propio", embudo: null, motivo: "las secciones de stock son propias de cada sucursal (no hay catálogo de empresa)." },
  Operacion: { familia: "propio", embudo: null, motivo: "cada fila es una operación de la sucursal (historia)." },
  ConteoFisico: { familia: "propio", embudo: null, motivo: "cada fila es un conteo hecho en la sucursal (historia)." },
  Mesa: { familia: "propio", embudo: null, motivo: "las mesas son propias de cada sucursal." },
  EjemplarBoleta: { familia: "propio", embudo: null, motivo: "cada fila es un ejemplar impreso en la sucursal." },
};

/** Los modelos de un schema Prisma que tienen una columna `sucursalId`. */
function modelosConSucursal(schema: string): string[] {
  const modelos: string[] = [];
  const re = /^model (\w+) \{\r?\n([\s\S]*?)\r?\n\}/gm;
  for (let m = re.exec(schema); m; m = re.exec(schema)) {
    if (/^\s+sucursalId\s/m.test(m[2])) modelos.push(m[1]);
  }
  return modelos;
}

/** Los problemas de un registro frente a la lista de modelos y a los archivos que existen. */
function problemasDelRegistro(registro: Record<string, Entrada>, modelos: string[], existe: (ruta: string) => boolean): string[] {
  const problemas: string[] = [];
  for (const modelo of modelos) {
    const e = registro[modelo];
    if (!e) {
      problemas.push(`${modelo}: tiene sucursalId y no está en el registro (definí su familia, embudo y motivo)`);
      continue;
    }
    if (!FAMILIAS.includes(e.familia)) problemas.push(`${modelo}: familia inválida "${e.familia}"`);
    if (!e.motivo.trim()) problemas.push(`${modelo}: falta el motivo`);
    if (e.familia === "propio") continue;
    if (!e.embudo) problemas.push(`${modelo}: falta el embudo (solo la familia "propio" puede no tenerlo)`);
    else if (!existe(e.embudo)) problemas.push(`${modelo}: el embudo ${e.embudo} no existe`);
  }
  for (const modelo of Object.keys(registro)) {
    if (!modelos.includes(modelo)) problemas.push(`${modelo}: está en el registro pero ya no tiene sucursalId (sacalo)`);
  }
  return problemas;
}

describe("semántica de 'sin fila': todo modelo por sucursal tiene familia, embudo y motivo", () => {
  const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
  const modelos = modelosConSucursal(schema);
  const existe = (ruta: string) => existsSync(join(RAIZ, ruta));

  it("encuentra los modelos por sucursal del schema", () => {
    expect(modelos.length).toBeGreaterThan(10);
  });

  it("no queda ningún modelo por sucursal sin registrar (ni entradas de más), y cada embudo existe", () => {
    const problemas = problemasDelRegistro(REGISTRO, modelos, existe);
    expect(problemas, `Registro de ADR-009 desactualizado:\n${problemas.join("\n")}`).toEqual([]);
  });

  describe("el detector (con datos sintéticos)", () => {
    const schemaSintetico = ["model A {", "  id String @id", "  sucursalId String", "}", "", "model B {", "  id String @id", "}", "", "model C {", "  sucursalId String?", "}"].join("\n");

    it("encuentra solo los modelos con columna sucursalId (también opcional)", () => {
      expect(modelosConSucursal(schemaSintetico)).toEqual(["A", "C"]);
    });

    it("marca un modelo sin registrar y una entrada sobrante", () => {
      const registro: Record<string, Entrada> = { A: { familia: "optin", embudo: "x.ts", motivo: "m" }, Z: { familia: "ajuste", embudo: "x.ts", motivo: "m" } };
      const problemas = problemasDelRegistro(registro, ["A", "C"], () => true);
      expect(problemas).toHaveLength(2);
      expect(problemas[0]).toMatch(/^C: tiene sucursalId y no está en el registro/);
      expect(problemas[1]).toMatch(/^Z: está en el registro pero ya no tiene sucursalId/);
    });

    it("marca un embudo inexistente, un embudo faltante y un motivo vacío; 'propio' no necesita embudo", () => {
      const registro: Record<string, Entrada> = {
        A: { familia: "optin", embudo: "no-existe.ts", motivo: "m" },
        B: { familia: "override", embudo: null, motivo: "m" },
        C: { familia: "propio", embudo: null, motivo: " " },
        D: { familia: "propio", embudo: null, motivo: "ok" },
      };
      const problemas = problemasDelRegistro(registro, ["A", "B", "C", "D"], () => false);
      expect(problemas).toEqual(["A: el embudo no-existe.ts no existe", 'B: falta el embudo (solo la familia "propio" puede no tenerlo)', "C: falta el motivo"]);
    });
  });
});
