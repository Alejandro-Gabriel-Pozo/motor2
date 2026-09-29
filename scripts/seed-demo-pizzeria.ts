/**
 * Siembra una demo completa ("La Cuadra", pizzería) en la base que apunte
 * DATABASE_URL — catálogo, proveedores, recetas con ficha técnica, y 30
 * días reales de movimientos (compras/producción/ventas/conteo/merma)
 * generados llamando a los server actions reales, no INSERTs a mano.
 *
 * Requiere que ya haya corrido el seed base (`npm run db:seed`: roles,
 * acciones, sucursal "Central", unidades base) y que exista un User con
 * email alepogabriel@gmail.com y membresía admin en "Central" — se usa
 * para dar de alta la sucursal nueva ("La Cuadra") y queda como su primer
 * admin ahí también.
 *
 * Uso: DATABASE_URL="postgresql://...(la branch de Neon que sea)..." \
 *        npx vitest run --config vitest.seed.config.ts
 *
 * No es idempotente para los movimientos (si se corre dos veces sobre la
 * misma base, duplica compras/ventas) — pensado para correr UNA vez sobre
 * una base/branch limpia.
 */
import "dotenv/config";
import { vi, describe, it, expect } from "vitest";

// Hoisted por Vitest — tiene que ir antes de cualquier import que toque
// (directa o indirectamente) `@/core/auth/session`, mismo criterio que
// cualquier test de un server action (ver test/catalogo/recetas.test.ts).
vi.mock("../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { prisma } from "../src/lib/db";
import { __setCookieDeTestParaSucursal } from "../test/setup/next-headers-stub";
import { getUsuarioActual } from "../src/core/auth/session";
import { crearSucursalConAdmin } from "../src/server/actions/auth/sucursales";
import { crearSeccion } from "../src/server/actions/movimientos/secciones";
import { crearCategoriaProducto } from "../src/server/actions/catalogo/categorias-producto";
import { crearUnidad } from "../src/server/actions/catalogo/unidades";
import { altaProveedor, actualizarActivaProveedor } from "../src/server/actions/catalogo/proveedores";
import { crearInsumo, crearOActualizarGrupo, actualizarGrupoDeInsumo } from "../src/server/actions/catalogo/insumos";
import { darDeAltaProducto, actualizarDisponibilidadProducto } from "../src/server/actions/catalogo/productos";
import { guardarReceta } from "../src/server/actions/catalogo/recetas";
import { registrarMovimiento } from "../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../src/server/actions/movimientos/venta";
import { registrarConteoFisico } from "../src/server/actions/movimientos/conteo-fisico";
import { calcularRendimientoRecetasSimples, calcularRendimientoRecetasCompartidas } from "../src/core/reportes/rendimiento-recetas";
import { PROVEEDORES, PRODUCTOS, PRECIOS_REFERENCIA, RECETAS } from "./seed-demo-pizzeria-data";

const EMAIL_ADMIN = "alepogabriel@gmail.com";
const NOMBRE_SUCURSAL = "La Cuadra";

/** Códigos del sheet -> Unidad.nombre real de motor2 (kg/g/l/ml/unidad ya existen del seed base; el resto de unidades de compra se crea acá). */
const UNIDAD_MAP: Record<string, string> = {
  KG: "kg",
  G: "g",
  LT: "l",
  ML: "ml",
  UN: "unidad",
  BOL: "bolsa",
  PAQ: "paquete",
  CJ: "caja",
  LATA: "lata",
  BALDE: "balde",
  BOT: "botella",
};
const UNIDADES_A_CREAR = ["bolsa", "paquete", "caja", "lata", "balde", "botella"];

/** "Hoy" fijo al momento de correr el script — la ventana de datos es SIEMPRE los 30 días anteriores, terminando ayer. */
const HOY = new Date();
HOY.setUTCHours(12, 0, 0, 0);
function fechaHace(diasAtras: number, horaUtc = 14): Date {
  const d = new Date(HOY.getTime() - diasAtras * 24 * 60 * 60 * 1000);
  d.setUTCHours(horaUtc, 0, 0, 0);
  return d;
}
const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000;
function claveSemana(fecha: Date): number {
  return Math.floor(fecha.getTime() / MS_POR_SEMANA);
}
// Índice 0..4 de más vieja a más nueva, sobre las 5 claves de semana reales que caen en la ventana de 30 días — así los multiplicadores semanales de venta calzan EXACTO con el bucketing real del reporte (Math.floor(epoch / semana)), no con "semana calendario lunes-a-lunes".
const CLAVES_SEMANA_ORDENADAS = Array.from(new Set(Array.from({ length: 30 }, (_, i) => claveSemana(fechaHace(i + 1))))).sort((a, b) => a - b);
function indiceSemana(fecha: Date): number {
  return CLAVES_SEMANA_ORDENADAS.indexOf(claveSemana(fecha));
}

async function mock(usuario: { id: string; email: string; nombre: string | null }) {
  vi.mocked(getUsuarioActual).mockResolvedValue(usuario);
}

/**
 * Ventas semanales objetivo por plato: cantidad base + un multiplicador
 * por cada una de las 5 semanas de la ventana. Los vectores están
 * elegidos a mano para que los pools compartidos (mismo insumo, 2-3
 * platos) tengan una mezcla de ventas realmente distinta semana a
 * semana — si no, la regresión de mínimos cuadrados queda casi
 * colineal y no puede separar el coeficiente de cada plato.
 */
const VENTAS_SEMANALES: Record<string, { base: number; mult: number[] }> = {
  PV020: { base: 40, mult: [1.0, 1.1, 0.9, 1.2, 1.0] }, // Muzzarella grande
  PV021: { base: 20, mult: [1.0, 0.8, 1.3, 0.9, 1.1] }, // Muzzarella chica
  PV022: { base: 18, mult: [1.0, 1.3, 0.7, 1.0, 1.2] }, // Napolitana
  PV023: { base: 14, mult: [1.0, 0.9, 1.4, 1.0, 0.7] }, // Fugazzeta
  PV024: { base: 12, mult: [1.0, 1.4, 0.8, 1.1, 0.9] }, // Especial
  PV025: { base: 10, mult: [1.0, 0.7, 1.2, 1.3, 0.8] }, // Calabresa
  PV026: { base: 8, mult: [1.0, 1.0, 1.0, 1.0, 1.0] }, // Cuatro Quesos
  PV027: { base: 9, mult: [1.0, 1.1, 1.3, 0.6, 1.3] }, // Vegetariana
  PV007: { base: 60, mult: [1.0, 1.0, 1.0, 1.0, 1.0] }, // Cerveza
  PV008: { base: 70, mult: [1.0, 1.0, 1.0, 1.0, 1.0] }, // Gaseosa
  PV009: { base: 30, mult: [1.0, 1.0, 1.0, 1.0, 1.0] }, // Agua
  PV010: { base: 25, mult: [1.0, 1.2, 0.8, 1.1, 0.9] }, // Copa de vino
  PV011: { base: 6, mult: [1.0, 0.7, 1.3, 0.8, 1.4] }, // Botella de vino
};
// Peso relativo por día de la semana (0=domingo..6=sábado) — fin de semana más fuerte, lunes flojo.
const PESO_DIA: Record<number, number> = { 0: 0.9, 1: 0.7, 2: 0.85, 3: 0.9, 4: 1.1, 5: 1.5, 6: 1.6 };
const SUMA_PESOS_SEMANA = Object.values(PESO_DIA).reduce((a, b) => a + b, 0);

function ventasDelDia(fecha: Date): Record<string, number> {
  const semana = indiceSemana(fecha);
  const pesoDia = PESO_DIA[fecha.getUTCDay()];
  const out: Record<string, number> = {};
  for (const [pv, cfg] of Object.entries(VENTAS_SEMANALES)) {
    const totalSemana = cfg.base * cfg.mult[semana];
    out[pv] = Math.max(0, Math.round((totalSemana * pesoDia) / SUMA_PESOS_SEMANA));
  }
  return out;
}

describe("seed demo pizzería La Cuadra", () => {
  it(
    "siembra catálogo + 30 días de movimientos reales en la sucursal 'La Cuadra'",
    async () => {
      const fallos: string[] = [];
      const anotarSiFalla = (etiqueta: string, r: { ok: boolean; mensaje: string }) => {
        if (!r.ok) fallos.push(`${etiqueta}: ${r.mensaje}`);
      };

      // 1) Usuario real, admin ya en "Central" (seed base) — se usa para crear la sucursal nueva.
      const usuario = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_ADMIN } });
      await mock({ id: usuario.id, email: usuario.email, nombre: usuario.name });
      const central = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } });
      __setCookieDeTestParaSucursal(central.id);

      let sucursal = await prisma.sucursal.findUnique({ where: { nombre: NOMBRE_SUCURSAL } });
      if (!sucursal) {
        const r = await crearSucursalConAdmin({ nombre: NOMBRE_SUCURSAL, emailPrimerAdmin: EMAIL_ADMIN });
        anotarSiFalla("crearSucursalConAdmin", r);
        sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: NOMBRE_SUCURSAL } });
      }
      __setCookieDeTestParaSucursal(sucursal.id);

      // 2) Secciones.
      const seccionesExistentes = await prisma.seccion.findMany({ where: { sucursalId: sucursal.id } });
      const seccionPorNombre = new Map(seccionesExistentes.map((s) => [s.nombre, s.id]));
      for (const nombre of ["Cocina", "Barra"]) {
        if (seccionPorNombre.has(nombre)) continue;
        const r = await crearSeccion(nombre);
        anotarSiFalla(`crearSeccion(${nombre})`, r);
        if (r.ok) seccionPorNombre.set(nombre, r.id);
      }
      const seccionCocina = seccionPorNombre.get("Cocina")!;
      const seccionBarra = seccionPorNombre.get("Barra")!;

      // 3) Categorías (derivadas de los datos: Cocina/Salón/Barra/Vajilla/Limpieza).
      const categoriasExistentes = await prisma.categoriaProducto.findMany();
      const categoriaPorNombre = new Map(categoriasExistentes.map((c) => [c.nombre, c.id]));
      const nombresCategoria = new Set(PRODUCTOS.map((p) => p.categoria));
      for (const nombre of nombresCategoria) {
        if (categoriaPorNombre.has(nombre)) continue;
        const r = await crearCategoriaProducto(nombre);
        anotarSiFalla(`crearCategoriaProducto(${nombre})`, r);
        if (r.ok) categoriaPorNombre.set(nombre, r.id);
      }

      // 4) Unidades — las base (kg/g/l/ml/unidad) ya existen del seed inicial; acá solo las de presentación de compra.
      const unidadesExistentes = await prisma.unidad.findMany();
      const unidadIdPorNombre = new Map(unidadesExistentes.map((u) => [u.nombre, u.id]));
      for (const nombre of UNIDADES_A_CREAR) {
        if (unidadIdPorNombre.has(nombre)) continue;
        const r = await crearUnidad({ nombre, magnitud: "CANTIDAD", decimales: 0 });
        anotarSiFalla(`crearUnidad(${nombre})`, r);
        if (r.ok) unidadIdPorNombre.set(nombre, r.id);
      }
      const idUnidad = (codigoSheet: string): string => {
        const nombre = UNIDAD_MAP[codigoSheet];
        const id = unidadIdPorNombre.get(nombre);
        if (!id) throw new Error(`Unidad no resuelta: ${codigoSheet} -> ${nombre}`);
        return id;
      };

      // 5) Proveedores (altaProveedor autogenera el código real — el código
      // "PRV_*" del sheet solo se usa acá adentro para cruzar planillas).
      const proveedoresExistentes = await prisma.proveedor.findMany();
      const proveedorIdPorNombre = new Map(proveedoresExistentes.map((p) => [p.nombre, p.id]));
      for (const p of PROVEEDORES) {
        if (proveedorIdPorNombre.has(p.nombre)) continue;
        const r = await altaProveedor({
          nombre: p.nombre,
          contacto: p.contacto,
          telefono: p.telefono,
          email: p.email,
          cuit: p.cuit,
          condicionesPago: p.condicionesPago,
          notas: p.notas,
        });
        anotarSiFalla(`altaProveedor(${p.nombre})`, r);
        if (r.ok) {
          proveedorIdPorNombre.set(p.nombre, r.id);
          if (!p.activo) anotarSiFalla(`actualizarActivaProveedor(${p.nombre})`, await actualizarActivaProveedor(r.id, false));
        }
      }
      const proveedorPorCodigoSheet = new Map(PROVEEDORES.map((p) => [p.codigo, proveedorIdPorNombre.get(p.nombre)!]));

      // 5b) Grupo "No comestibles" → "Packaging"/"Limpieza", con un Insumo cada uno — para que el food cost
      // realmente EXCLUYA packaging y limpieza (src/core/catalogo/no-comestibles.ts). Hallazgo real (2026-09-22):
      // esta demo nunca tuvo ningún Grupo cargado, así que la exclusión nunca se activaba — MP019/MP020 (cajas de
      // pizza, el ejemplo de manual de "packaging") y OT001/OT002 (detergente/lavandina, "limpieza") entraban de
      // lleno al food cost como si fueran comida. El mecanismo y sus tests ya existían; faltaban los datos.
      async function resolverGrupo(nombre: string, padreId: string | null): Promise<string> {
        const existente = await prisma.grupo.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
        if (existente) return existente.id;
        anotarSiFalla(`crearOActualizarGrupo(${nombre})`, await crearOActualizarGrupo(nombre, padreId));
        return (await prisma.grupo.findFirstOrThrow({ where: { nombre: { equals: nombre, mode: "insensitive" } } })).id;
      }
      const grupoNoComestibles = await resolverGrupo("No comestibles", null);
      const grupoPackaging = await resolverGrupo("Packaging", grupoNoComestibles);
      const grupoLimpieza = await resolverGrupo("Limpieza", grupoNoComestibles);

      async function resolverInsumoDeGrupo(nombre: string, grupoId: string): Promise<string> {
        let insumo = await prisma.insumo.findUnique({ where: { nombre } });
        if (!insumo) {
          anotarSiFalla(`crearInsumo(${nombre})`, await crearInsumo(nombre));
          insumo = await prisma.insumo.findUniqueOrThrow({ where: { nombre } });
        }
        if (insumo.grupoId !== grupoId) anotarSiFalla(`actualizarGrupoDeInsumo(${nombre})`, await actualizarGrupoDeInsumo(insumo.id, grupoId));
        return insumo.id;
      }
      const insumoPackaging = await resolverInsumoDeGrupo("PACKAGING", grupoPackaging);
      const insumoLimpieza = await resolverInsumoDeGrupo("LIMPIEZA", grupoLimpieza);
      // Códigos de PRODUCTOS que van con cada Insumo "no comestible" — el resto sigue con `insumoId: null` salvo MORRON, abajo.
      const insumoIdPorCodigoNoComestible: Record<string, string> = { MP019: insumoPackaging, MP020: insumoPackaging, OT001: insumoLimpieza, OT002: insumoLimpieza };

      // 6) Insumo "MORRON" — el ÚNICO grupo de hermanar de esta demo (ver
      // docstring al final del archivo, sección "Por qué un solo pool de
      // Insumo"): agrupa MP011 (Morrón rojo, proveedor habitual) con un
      // MP011B nuevo (compra de oportunidad, sin proveedor formal) para
      // ejercer de punta a punta el mecanismo de resolverConsumoPorFamilia
      // + el reporte de rendimiento compartido con productos DISTINTOS
      // pooleados (no solo "una MP usada por 2 platos", que la propia
      // planilla de recetas ya da gratis en varios insumos).
      let insumoMorron = await prisma.insumo.findUnique({ where: { nombre: "MORRON" } });
      if (!insumoMorron) {
        const r = await crearInsumo("MORRON");
        anotarSiFalla("crearInsumo(MORRON)", r);
        insumoMorron = await prisma.insumo.findUniqueOrThrow({ where: { nombre: "MORRON" } });
      }

      // 7) Productos.
      const productosExistentes = await prisma.producto.findMany();
      const productoPorCodigo = new Map(productosExistentes.map((p) => [p.codigo, p]));
      for (const p of PRODUCTOS) {
        if (productoPorCodigo.has(p.codigo)) continue;
        const r = await darDeAltaProducto({
          codigo: p.codigo,
          nombre: p.nombre,
          tipo: p.tipo,
          categoriaId: categoriaPorNombre.get(p.categoria) ?? null,
          unidadCompraId: p.unidadCompra ? idUnidad(p.unidadCompra) : null,
          unidadStockId: idUnidad(p.unidadStock),
          factorConversion: p.factorConversion,
          observaciones: p.observaciones,
          insumoId: p.codigo === "MP011" ? insumoMorron.id : (insumoIdPorCodigoNoComestible[p.codigo] ?? null),
          precioVenta: p.precioVenta,
          seProduce: p.seProduce,
        });
        anotarSiFalla(`darDeAltaProducto(${p.codigo})`, r);
        if (r.ok) {
          const creado = await prisma.producto.findUniqueOrThrow({ where: { codigo: p.codigo } });
          productoPorCodigo.set(p.codigo, creado);
          if (!p.activo) anotarSiFalla(`actualizarDisponibilidadProducto(${p.codigo})`, await actualizarDisponibilidadProducto(creado.id, false));
        }
      }
      if (!productoPorCodigo.has("MP011B")) {
        const r = await darDeAltaProducto({
          codigo: "MP011B",
          nombre: "Morrón rojo (compra de oportunidad, feria)",
          tipo: "MP",
          categoriaId: categoriaPorNombre.get("Cocina") ?? null,
          unidadCompraId: idUnidad("KG"),
          unidadStockId: idUnidad("KG"),
          factorConversion: 1,
          observaciones: "Mismo Insumo que MP011 — comprado sin proveedor formal cuando falta para la semana. Ejemplo real de 'no hay disciplina de registro': el kardex no puede saber cuál de las dos bolsas terminó en cada pizza.",
          insumoId: insumoMorron.id,
          precioVenta: 0,
          seProduce: false,
        });
        anotarSiFalla("darDeAltaProducto(MP011B)", r);
        if (r.ok) productoPorCodigo.set("MP011B", await prisma.producto.findUniqueOrThrow({ where: { codigo: "MP011B" } }));
      }
      const idProd = (codigo: string): string => {
        const p = productoPorCodigo.get(codigo);
        if (!p) throw new Error(`Producto no resuelto: ${codigo}`);
        return p.id;
      };

      // 8) Recetas — items siempre; cabecera + pasos (ficha técnica) solo
      // en 3 recetas flagship (las prepizzas y la pizza más vendida) para
      // no sobrecargar el resto, mismo criterio que "opcional en la
      // práctica" del grounding Tandoor/Fudo.
      for (const receta of RECETAS) {
        const productoId = idProd(receta.productoCodigo);
        const yaExiste = await prisma.recetaVersion.findFirst({ where: { productoId } });
        if (yaExiste) continue;

        const items = receta.ingredientes.map((ing) => ({
          insumoProductoId: idProd(ing.insumoCodigo),
          cantidad: ing.cantidad,
          unidadId: idUnidad(ing.unidad),
          mermaPorcentaje: ing.mermaPorcentaje,
          observaciones: ing.observaciones,
        }));

        let pasos: Parameters<typeof guardarReceta>[2] = [];
        let cabecera: Parameters<typeof guardarReceta>[3] = {};
        if (receta.productoCodigo === "MPZ01" || receta.productoCodigo === "MPZ02") {
          const chica = receta.productoCodigo === "MPZ02";
          pasos = [
            { orden: 1, nombre: "Amasado", instruccion: "Mezclar harina, sal y aceite; disolver la levadura aparte en agua tibia e integrar. Amasar 10 minutos hasta que quede lisa.", minutos: 15 },
            { orden: 2, nombre: "Leudado", instruccion: "Bollar, tapar y dejar leudar en lugar templado hasta duplicar el volumen.", minutos: 90 },
            { orden: 3, nombre: "Estibado", instruccion: "Formar los bollos individuales, aceitar y estibar en cajones para heladera — quedan listos para vender por varios días.", minutos: 10 },
          ];
          cabecera = {
            rendimientoCantidad: 1,
            rendimientoUnidadId: idUnidad("UN"),
            racionesCantidad: 1,
            tiempoPreparacionMinutos: chica ? 100 : 115,
            comentarios: "Se produce por LOTE, antes y aparte de la venta — no confundir con la receta de la pizza terminada, que consume esta masa como si fuera un insumo más.",
            equipamientoNecesario: "Amasadora\nCajones para estibar",
          };
        } else if (receta.productoCodigo === "PV020") {
          pasos = [
            { orden: 1, nombre: "Armado", instruccion: "Estirar el bollo de prepizza, cubrir con salsa de tomate y muzzarella.", minutos: 3, insumoProductoIds: [idProd("MPZ01"), idProd("MP005"), idProd("MP006")] },
            { orden: 2, nombre: "Horneado", instruccion: "Cocinar en horno de piso hasta que el borde dore y el queso funda.", minutos: 8 },
            { orden: 3, nombre: "Terminación", instruccion: "Espolvorear con orégano y cortar en porciones antes de emplatar o encajonar.", minutos: 1, insumoProductoIds: [idProd("MP014")] },
          ];
          cabecera = {
            rendimientoCantidad: 1,
            rendimientoUnidadId: idUnidad("UN"),
            racionesCantidad: 8,
            racionTamano: 1,
            tiempoCoccionMinutos: 8,
            comentarios: "La pizza más vendida de la carta.",
            presentacionEmplatado: "Cortada en 8 porciones\nServida en la caja de cartón si es para llevar",
          };
        }

        const r = await guardarReceta(productoId, items, pasos, cabecera);
        anotarSiFalla(`guardarReceta(${receta.productoCodigo})`, r);
      }

      // 9) Movimientos — 30 días terminando ayer, en orden cronológico
      // (compra/producción SIEMPRE antes que la venta que las necesita,
      // mismo bug real que ya mordió a los tests de rendimiento-recetas
      // esta sesión si se hace al revés).
      const NECESIDAD_DIRECTA: Record<string, { insumo: string; cantidadPorUnidad: number; merma: number }[]> = {};
      const NECESIDAD_PREPIZZA: Record<"PV020" | "PV021" | "PV022" | "PV023" | "PV024" | "PV025" | "PV026" | "PV027", "MPZ01" | "MPZ02"> = {
        PV020: "MPZ01", PV021: "MPZ02", PV022: "MPZ01", PV023: "MPZ01", PV024: "MPZ01", PV025: "MPZ01", PV026: "MPZ01", PV027: "MPZ01",
      };
      for (const r of RECETAS) {
        NECESIDAD_DIRECTA[r.productoCodigo] = r.ingredientes
          .filter((i) => i.insumoCodigo !== "MPZ01" && i.insumoCodigo !== "MPZ02")
          .map((i) => ({ insumo: i.insumoCodigo, cantidadPorUnidad: i.cantidad, merma: i.mermaPorcentaje }));
      }
      const RECETA_PREPIZZA: Record<"MPZ01" | "MPZ02", { insumo: string; cantidadPorUnidad: number; merma: number }[]> = {
        MPZ01: RECETAS.find((r) => r.productoCodigo === "MPZ01")!.ingredientes.map((i) => ({ insumo: i.insumoCodigo, cantidadPorUnidad: i.cantidad, merma: i.mermaPorcentaje })),
        MPZ02: RECETAS.find((r) => r.productoCodigo === "MPZ02")!.ingredientes.map((i) => ({ insumo: i.insumoCodigo, cantidadPorUnidad: i.cantidad, merma: i.mermaPorcentaje })),
      };

      /** Necesidad total de la semana (índice 0..4) para cada MP directo, MÁS lo que va a hacer falta producir de MPZ01/MPZ02 esa semana. */
      function necesidadSemanal(semana: number): { directa: Record<string, number>; prepizza: Record<"MPZ01" | "MPZ02", number> } {
        const directa: Record<string, number> = {};
        const prepizza: Record<"MPZ01" | "MPZ02", number> = { MPZ01: 0, MPZ02: 0 };
        for (const [pv, cfg] of Object.entries(VENTAS_SEMANALES)) {
          const qtySemana = cfg.base * cfg.mult[semana];
          for (const ing of NECESIDAD_DIRECTA[pv] ?? []) {
            directa[ing.insumo] = (directa[ing.insumo] ?? 0) + qtySemana * ing.cantidadPorUnidad * (1 + ing.merma / 100);
          }
          const prepizzaClave = (NECESIDAD_PREPIZZA as Record<string, "MPZ01" | "MPZ02" | undefined>)[pv];
          if (prepizzaClave) prepizza[prepizzaClave] += qtySemana;
        }
        // La demanda de harina/levadura/sal/aceite NUNCA aparece en
        // NECESIDAD_DIRECTA de ningún PV (los PV consumen la prepizza YA
        // hecha, no sus propios ingredientes) — hay que explotar la
        // sub-receta de cada prepizza acá para que la compra de esos 4
        // insumos tenga en cuenta cuánta masa hace falta amasar esa semana.
        for (const clave of ["MPZ01", "MPZ02"] as const) {
          for (const ing of RECETA_PREPIZZA[clave]) {
            directa[ing.insumo] = (directa[ing.insumo] ?? 0) + prepizza[clave] * ing.cantidadPorUnidad * (1 + ing.merma / 100);
          }
        }
        return { directa, prepizza };
      }

      const SECCION_DE: Record<string, string> = {};
      for (const p of PRODUCTOS) SECCION_DE[p.codigo] = p.categoria === "Barra" ? seccionBarra : seccionCocina;
      SECCION_DE.MP011B = seccionCocina;

      // Colchón sobre la necesidad calculada — cerca de 1 para que "comprado"
      // no se infle sistemáticamente por encima de "vendido" en TODOS los
      // insumos (eso opacaba la desviación real que se buscaba mostrar en
      // los pools de estrés). El stock inicial ya tiene su propio colchón
      // más generoso, así que esto solo cubre el roce semana a semana.
      const BUFFER = 1.12;

      // Cadencia de entrega por proveedor (día de la semana, 0=domingo)
      // — condensa las notas de cada proveedor en la planilla ("entrega
      // martes y viernes", "entrega diaria", etc.).
      const CADENCIA: Record<string, number[]> = {
        PRV_HARINAS: [2, 5],
        PRV_LACTEOS: [3],
        PRV_VERDULERIA: [1, 2, 3, 4, 5, 6],
        PRV_FIAMBRES: [1],
        PRV_ALMACEN: [2],
      };
      const DESCARTABLES_CADA_DIAS = 14;

      const MP_POR_PROVEEDOR: Record<string, string[]> = {
        PRV_HARINAS: ["MP001"],
        PRV_LACTEOS: ["MP006", "MP007", "MP017", "MP018"],
        PRV_VERDULERIA: ["MP010", "MP011", "MP012", "MP015", "MP016"],
        PRV_FIAMBRES: ["MP008", "MP009"],
        PRV_ALMACEN: ["MP002", "MP003", "MP004", "MP005", "MP013", "MP014"],
      };
      // Doble fuente real (de PRECIOS_REFERENCIA): ocasionalmente el pedido de esa semana sale del proveedor alternativo en vez del habitual — mismo patrón "comparar precios" que motivó la porción proveedor-por-producto.
      const PROVEEDOR_ALTERNATIVO: Record<string, string> = { MP001: "PRV_ALMACEN", MP004: "PRV_HARINAS", MP006: "PRV_FIAMBRES" };

      function precioRef(codigo: string, proveedorCodigo: string) {
        return PRECIOS_REFERENCIA.find((p) => p.productoCodigo === codigo && p.proveedorCodigo === proveedorCodigo) ?? PRECIOS_REFERENCIA.find((p) => p.productoCodigo === codigo)!;
      }

      let contadorEntregaHarinas = 0;
      let contadorEntregaLacteos = 0;

      // --- Stock inicial: un día antes de que arranque la ventana, como
      // si la cocina ya viniera funcionando de antes (si no, el día 1 de
      // la ventana arranca en cero y cualquier venta/producción temprana
      // falla por falta de stock, aunque la compra del día ya esté
      // programada para más adelante en la semana). Cubre ~2 semanas de
      // la necesidad de la semana 0 para cada MP comprado.
      {
        const fechaInicial = fechaHace(31, 7);
        const necesidadSemana0 = necesidadSemanal(0);
        const todosLosMP = PRODUCTOS.filter((p) => p.tipo === "MP" && p.activo && !p.seProduce && p.codigo !== "MP099").map((p) => p.codigo);
        const itemsCocina: { productoId: string; cantidad: number; precioTotal: number }[] = [];
        const itemsBarra: { productoId: string; cantidad: number; precioTotal: number }[] = [];
        for (const codigo of [...todosLosMP, "MP011B"]) {
          const producto = productoPorCodigo.get(codigo)!;
          const necesidadTotal = (necesidadSemana0.directa[codigo] ?? 0) * 2; // 2 semanas de colchón inicial
          if (!(necesidadTotal > 0)) continue;
          const cantidadCompra = Math.max(1, Math.ceil((necesidadTotal * BUFFER) / producto.factorConversion.toNumber()));
          const ref = precioRef(codigo, codigo.startsWith("MX") ? "PRV_BEBIDAS" : "PRV_ALMACEN");
          const item = { productoId: producto.id, cantidad: cantidadCompra, precioTotal: Math.round(cantidadCompra * ref.precioUnitarioCompra) };
          (SECCION_DE[codigo] === seccionBarra ? itemsBarra : itemsCocina).push(item);
        }
        if (itemsCocina.length) {
          const r = await registrarMovimiento({ proceso: "COMPRA", fecha: fechaInicial, seccionId: seccionCocina, nroFactura: "STOCK-INICIAL-COCINA", items: itemsCocina });
          anotarSiFalla("COMPRA stock inicial cocina", r);
        }
        if (itemsBarra.length) {
          const r = await registrarMovimiento({ proceso: "COMPRA", fecha: fechaInicial, seccionId: seccionBarra, nroFactura: "STOCK-INICIAL-BARRA", items: itemsBarra });
          anotarSiFalla("COMPRA stock inicial barra", r);
        }
        // Y una primera tanda de prepizza ya lista para el día 1.
        for (const clave of ["MPZ01", "MPZ02"] as const) {
          const cantidad = Math.max(1, Math.round((necesidadSemana0.prepizza[clave] * BUFFER * 2) / 7));
          const r = await registrarMovimiento({
            proceso: "PRODUCCION", fecha: new Date(fechaInicial.getTime() + 60 * 60 * 1000), seccionId: seccionCocina,
            items: [{ productoId: idProd(clave), cantidad }],
          });
          anotarSiFalla(`PRODUCCION inicial ${clave}`, r);
        }
      }

      for (let diasAtras = 30; diasAtras >= 1; diasAtras--) {
        const fecha = fechaHace(diasAtras, 8);
        const dow = fecha.getUTCDay();
        const semana = indiceSemana(fecha);
        const necesidad = necesidadSemanal(semana);

        // --- Compras del día ---
        for (const [provCodigo, dias] of Object.entries(CADENCIA)) {
          if (!dias.includes(dow)) continue;
          const mps = MP_POR_PROVEEDOR[provCodigo];
          const ocurrenciasEstaSemana = dias.length;
          const items: { productoId: string; cantidad: number; precioTotal: number; unidadCompraId?: string | null; referenciaProveedor?: string }[] = [];

          for (const mpCodigo of mps) {
            let proveedorCodigoUsado = provCodigo;
            if (mpCodigo === "MP001") { contadorEntregaHarinas++; if (contadorEntregaHarinas % 5 === 0) proveedorCodigoUsado = PROVEEDOR_ALTERNATIVO.MP001; }
            if (mpCodigo === "MP006") { contadorEntregaLacteos++; if (contadorEntregaLacteos % 4 === 0) proveedorCodigoUsado = PROVEEDOR_ALTERNATIVO.MP006; }
            if (proveedorCodigoUsado !== provCodigo && !CADENCIA[proveedorCodigoUsado]) continue; // por las dudas, nunca debería pasar

            const producto = productoPorCodigo.get(mpCodigo)!;
            const necesidadTotal = necesidad.directa[mpCodigo] ?? 0;
            const necesidadPorEntrega = (necesidadTotal * BUFFER) / ocurrenciasEstaSemana;
            const cantidadCompra = Math.max(1, Math.ceil(necesidadPorEntrega / producto.factorConversion.toNumber()));
            const ref = precioRef(mpCodigo, proveedorCodigoUsado);
            items.push({
              productoId: producto.id,
              cantidad: cantidadCompra,
              precioTotal: Math.round(cantidadCompra * ref.precioUnitarioCompra),
              unidadCompraId: null,
            });
          }
          if (!items.length) continue;
          const proveedorCodigoOperacion = provCodigo; // la factura queda a nombre del proveedor "de la ronda" salvo la excepción puntual de arriba
          const r = await registrarMovimiento({
            proceso: "COMPRA",
            fecha,
            seccionId: seccionCocina,
            proveedorId: proveedorPorCodigoSheet.get(proveedorCodigoOperacion),
            nroFactura: `${proveedorCodigoOperacion}-${fecha.toISOString().slice(0, 10)}`,
            items,
          });
          anotarSiFalla(`COMPRA ${proveedorCodigoOperacion} ${fecha.toISOString().slice(0, 10)}`, r);
        }

        // Verdulería: aparte, la compra de oportunidad de MP011B (feria, sin proveedor) — 1 vez por semana, jueves.
        if (dow === 4) {
          const necesidadMorron = necesidad.directa.MP011 ?? 0;
          // Piso mínimo en 5 (no 1): para semanas de poca demanda de
          // Morrón, Math.round(necesidadMorron * BUFFER * 0.3ish) ya
          // redondeaba a 1 sin importar el factor — subir el factor de 0.3
          // a 0.4 no cambiaba nada (mismo piso), y esas semanas se
          // quedaban cortas contra el pool compartido. Lo que hacía falta
          // era subir el PISO, no la fracción.
          const cantidadB = Math.max(5, Math.round((necesidadMorron * BUFFER * 0.4) / 1));
          const rB = await registrarMovimiento({
            proceso: "COMPRA",
            fecha,
            seccionId: seccionCocina,
            items: [{ productoId: idProd("MP011B"), cantidad: cantidadB, precioTotal: Math.round(cantidadB * 2450) }],
          });
          anotarSiFalla(`COMPRA MP011B feria ${fecha.toISOString().slice(0, 10)}`, rB);
        }

        // Descartables/limpieza — cada 14 días.
        if (diasAtras % DESCARTABLES_CADA_DIAS === 2) {
          const items = ["MP019", "MP020", "OT001", "OT002"].map((codigo) => {
            const producto = productoPorCodigo.get(codigo)!;
            const necesidadTotal = (necesidad.directa[codigo] ?? 0) * 2; // ventana de 2 semanas hasta la próxima entrega
            const cantidadCompra = Math.max(1, Math.ceil((necesidadTotal * BUFFER) / producto.factorConversion.toNumber()) || 1);
            const ref = precioRef(codigo, "PRV_DESCARTABLES");
            return { productoId: producto.id, cantidad: cantidadCompra, precioTotal: Math.round(cantidadCompra * ref.precioUnitarioCompra) };
          });
          const r = await registrarMovimiento({
            proceso: "COMPRA", fecha, seccionId: seccionCocina, proveedorId: proveedorPorCodigoSheet.get("PRV_DESCARTABLES"),
            nroFactura: `PRV_DESCARTABLES-${fecha.toISOString().slice(0, 10)}`, items,
          });
          anotarSiFalla(`COMPRA descartables ${fecha.toISOString().slice(0, 10)}`, r);
        }

        // Bebidas — semanal, jueves.
        if (dow === 4) {
          const items = ["MX002", "MX003", "MX004", "MX005"].map((codigo) => {
            const producto = productoPorCodigo.get(codigo)!;
            const necesidadTotal = necesidad.directa[codigo] ?? 0;
            const cantidadCompra = Math.max(1, Math.ceil((necesidadTotal * BUFFER) / producto.factorConversion.toNumber()) || 1);
            const ref = precioRef(codigo, "PRV_BEBIDAS");
            return { productoId: producto.id, cantidad: cantidadCompra, precioTotal: Math.round(cantidadCompra * ref.precioUnitarioCompra) };
          });
          const r = await registrarMovimiento({
            proceso: "COMPRA", fecha, seccionId: seccionBarra, proveedorId: proveedorPorCodigoSheet.get("PRV_BEBIDAS"),
            nroFactura: `PRV_BEBIDAS-${fecha.toISOString().slice(0, 10)}`, items,
          });
          anotarSiFalla(`COMPRA bebidas ${fecha.toISOString().slice(0, 10)}`, r);
        }

        // --- Producción de prepizza: lunes/miércoles/viernes ---
        // El tamaño de cada tanda cubre los días REALES hasta la próxima
        // (lunes→miércoles y miércoles→viernes son 2 días, viernes→lunes
        // son 3 — incluye el fin de semana, el más vendido) — dividir
        // siempre por 3 subestimaba justo la tanda del viernes.
        const GAP_HASTA_PROXIMA_TANDA: Record<number, number> = { 1: 2, 3: 2, 5: 3 };
        if (dow === 1 || dow === 3 || dow === 5) {
          for (const clave of ["MPZ01", "MPZ02"] as const) {
            const necesidadTotal = necesidad.prepizza[clave];
            const cantidad = Math.max(1, Math.round((necesidadTotal * BUFFER * GAP_HASTA_PROXIMA_TANDA[dow]) / 7));
            const r = await registrarMovimiento({
              proceso: "PRODUCCION",
              fecha: new Date(fecha.getTime() - 2 * 60 * 60 * 1000), // se amasa temprano, antes de que abra la cocina de venta
              seccionId: seccionCocina,
              items: [{ productoId: idProd(clave), cantidad }],
            });
            anotarSiFalla(`PRODUCCION ${clave} ${fecha.toISOString().slice(0, 10)}`, r);
          }
        }

        // --- Ventas del día ---
        const ventasHoy = ventasDelDia(fecha);
        const ventasCocina = Object.entries(ventasHoy).filter(([pv]) => SECCION_DE[pv] === seccionCocina && (ventasHoy[pv] ?? 0) > 0);
        const ventasBarra = Object.entries(ventasHoy).filter(([pv]) => SECCION_DE[pv] === seccionBarra && (ventasHoy[pv] ?? 0) > 0);

        if (ventasCocina.length) {
          const r = await registrarVenta({
            fecha,
            seccionId: seccionCocina,
            detalle: "Venta de mostrador",
            ventas: ventasCocina.map(([pv, cant]) => ({ productoId: idProd(pv), cantidadVendida: cant })),
          });
          anotarSiFalla(`VENTA cocina ${fecha.toISOString().slice(0, 10)}`, r);
        }
        if (ventasBarra.length) {
          const r = await registrarVenta({
            fecha,
            seccionId: seccionBarra,
            detalle: "Venta de mostrador",
            ventas: ventasBarra.map(([pv, cant]) => ({ productoId: idProd(pv), cantidadVendida: cant })),
          });
          anotarSiFalla(`VENTA barra ${fecha.toISOString().slice(0, 10)}`, r);
        }
      }

      // 10) Un Conteo Físico con diferencia real (semana 3) y una Merma por rotura (semana 4) — para que Stock/Conteo Físico y el reporte de pérdidas también tengan algo que mostrar.
      const fechaConteo = fechaHace(9, 20);
      const saldoMuzzarella = await prisma.movimientoStock.aggregate({
        where: { productoId: idProd("MP006"), seccionId: seccionCocina },
        _sum: { cantidad: true },
      });
      const saldoActual = Number(saldoMuzzarella._sum.cantidad ?? 0);
      const rConteo = await registrarConteoFisico({
        productoId: idProd("MP006"),
        seccionId: seccionCocina,
        conteoReal: Math.max(0, Math.round((saldoActual - 1.4) * 10) / 10),
        fechaConteo,
        accion: "AJUSTAR",
        detalle: "Conteo de rutina — faltante chico, probablemente mermas de fraccionamiento no registradas.",
      });
      anotarSiFalla("registrarConteoFisico MP006", rConteo);

      const fechaMerma = fechaHace(5, 11);
      // La migración expand (plan "motivos de Consumo/Merma como catálogo administrable", P3) ya sembró el catálogo en
      // cualquier base a la que le corrieron `prisma migrate deploy` — no hace falta sembrarlo acá.
      const motivoRoto = await prisma.motivoMerma.findUniqueOrThrow({ where: { nombre: "Roto o caído" } });
      const rMerma = await registrarMovimiento({
        proceso: "MERMA",
        fecha: fechaMerma,
        seccionId: seccionBarra,
        motivoId: motivoRoto.id,
        detalleLibre: "Se cayó un six-pack al acomodar la heladera.",
        items: [{ productoId: idProd("MX003"), cantidad: 6 }],
      });
      anotarSiFalla("MERMA MX003", rMerma);

      // --- Verificación: sin fallos silenciosos, y los pools de estrés funcionan de punta a punta ---
      if (fallos.length) console.error("FALLOS DURANTE EL SEED:\n" + fallos.join("\n"));
      expect(fallos, fallos.join("\n")).toEqual([]);

      const desde = fechaHace(30, 0);
      const hasta = fechaHace(1, 23);
      const [simples, compartidas] = await Promise.all([
        calcularRendimientoRecetasSimples(sucursal.id, desde, hasta, prisma),
        calcularRendimientoRecetasCompartidas(sucursal.id, desde, hasta, prisma),
      ]);

      console.log(`\n=== Fase 1 (pool simple): ${simples.length} filas ===`);
      for (const f of simples) {
        console.log(`  ${f.productoVentaNombre} <- ${f.insumoONombre}: receta=${f.cantidadActual}, real≈${f.cantidadEstimada} (${f.confianza}, ${f.semanasConDatos} semanas)`);
      }
      console.log(`\n=== Fase 2 (pool compartido): ${compartidas.length} filas ===`);
      const porPool = new Map<string, typeof compartidas>();
      for (const f of compartidas) porPool.set(f.poolClave, [...(porPool.get(f.poolClave) ?? []), f]);
      for (const [clave, filas] of porPool) {
        console.log(`  Pool "${filas[0].insumoONombre}" (${clave}) — ${filas[0].cantidadPlatosEnPool} platos, resoluble=${filas[0].resoluble}, R²=${filas[0].r2}`);
        for (const f of filas) console.log(`    ${f.productoVentaNombre}: receta=${f.cantidadActual}, real≈${f.cantidadEstimada}`);
      }

      const poolMorron = compartidas.filter((f) => f.insumoONombre === "MORRON");
      expect(poolMorron.length, "el pool de Morrón (Insumo compartido) tiene que aparecer en Fase 2").toBeGreaterThan(0);
      expect(poolMorron.some((f) => f.resoluble), "el pool de Morrón tiene que resolverse con datos reales de 30 días").toBe(true);

      console.log(`\nListo — sucursal "${NOMBRE_SUCURSAL}" (${sucursal.id}), usuario admin "${EMAIL_ADMIN}".`);
    },
    1_500_000
  );
});

/**
 * Por qué un solo pool de Insumo (Morrón) y no varios más:
 *
 * La propia planilla de recetas YA da, sin ninguna modificación, varios
 * pools "varios platos comparten un insumo" con un ÚNICO producto (no
 * hace falta un Insumo compartido para que Fase 2 se dispare — alcanza
 * con que 2+ recetas usen el mismo Producto): Orégano (3 pizzas), Cebolla
 * (2), Aceitunas verdes (2) y Vino tinto de la casa (Copa + Botella, con
 * el matiz lindo de la fracción 1/6). Eso ya cubre "varios insumos,
 * varios platos" en el sentido del pedido original. Lo que NINGUNO de
 * esos ejemplos ejercita es el mecanismo de Insumo/hermanar en sí
 * (resolverConsumoPorFamilia repartiendo entre 2+ CÓDIGOS de producto
 * distintos) — por eso se agrega el MP011/MP011B de Morrón, el único caso
 * de esta demo con más de una MP en el mismo pool.
 *
 * Deliberadamente NO se agrupó también Muzzarella/Provolone/Parmesano/
 * Roquefort bajo un mismo Insumo "QUESO" (como sugería la columna
 * "Insumo" de la planilla original) — son ingredientes DISTINTOS, no
 * presentaciones intercambiables del mismo insumo comprado a proveedores
 * distintos, y agruparlos habría hecho que el reporte sume kilos de
 * quesos que en la realidad nunca se sustituyen entre sí. La columna
 * "Insumo" de la planilla se leyó en cambio como "Categoría" (rubro
 * comercial), que es lo que el dato realmente describe — ver
 * `categoria` en seed-demo-pizzeria-data.ts.
 */
