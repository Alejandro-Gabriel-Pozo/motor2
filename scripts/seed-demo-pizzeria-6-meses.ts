/**
 * Ejecutor del guion de 6 meses de "La Cuadra" (docs/planes-demo-y-claridad-reportes-2026-09-21.md §5, tramo 3): arma el
 * catálogo (sucursal, secciones, categorías, unidades, proveedores, productos, recetas — igual que
 * scripts/seed-demo-pizzeria.ts) y después recorre el `GuionDemo` de scripts/demo-seed/guion-la-cuadra.ts llamando a los
 * server actions REALES (registrarMovimiento/registrarVenta/registrarConteoFisico/anularCompra/corregirCompra/
 * guardarReceta) — nunca INSERTs directos, mismo criterio que el seed de 30 días.
 *
 * NUNCA corre contra Neon (guarda en vitest.seed-6-meses.config.ts, antes de que exista un cliente Prisma siquiera):
 * requiere `MOTOR2_SEED_DATABASE_URL` apuntando a un Postgres LOCAL cuyo nombre termine en "_demo", más
 * `MOTOR2_SEED_CONFIRMAR=si`. Ver el docstring de ese archivo para el comando completo.
 *
 * Uso:
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *   MOTOR2_SEED_CONFIRMAR="si" \
 *     npx vitest run --config vitest.seed-6-meses.config.ts
 *
 * Para rehacer sobre una base que ya tiene la demo (borra la sucursal "La Cuadra" entera primero, a mano — este script
 * no borra nada): agregar `MOTOR2_SEED_REHACER=si` para saltear la guarda de "ya existe".
 */
import "dotenv/config";
import { vi, describe, it, expect } from "vitest";

vi.mock("../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// El limitador de tasa (300 mutaciones/minuto por usuario, src/core/permisos/limitador-tasa.ts) es real y correcto en
// producción — acá se neutraliza SOLO para esta corrida (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md
// "Riesgo real al escalar el guion a varios meses"): 6 meses de guion son casi 1000 eventos, muy por encima del límite
// pensado para una persona operando la aplicación, no para un script que repuebla una demo entera.
vi.mock("../src/core/permisos/limitador-tasa", () => ({ limitadorMutaciones: { excedeLimite: () => false } }));

import { prisma } from "../src/lib/db";
import { __setCookieDeTestParaSucursal } from "../test/setup/next-headers-stub";
import { getUsuarioActual } from "../src/core/auth/session";
import { crearSucursalConAdmin } from "../src/server/actions/auth/sucursales";
import { crearSeccion } from "../src/server/actions/movimientos/secciones";
import { crearCategoriaProducto } from "../src/server/actions/catalogo/categorias-producto";
import { crearUnidad } from "../src/server/actions/catalogo/unidades";
import { altaProveedor, actualizarActivaProveedor } from "../src/server/actions/catalogo/proveedores";
import { crearInsumo, crearOActualizarGrupo, actualizarGrupoDeInsumo } from "../src/server/actions/catalogo/insumos";
import { darDeAltaProducto, actualizarActivoProducto } from "../src/server/actions/catalogo/productos";
import { guardarReceta } from "../src/server/actions/catalogo/recetas";
import { registrarMovimiento } from "../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../src/server/actions/movimientos/venta";
import { registrarConteoFisico } from "../src/server/actions/movimientos/conteo-fisico";
import { anularCompra, corregirCompra } from "../src/server/actions/movimientos/compras";
import { setStockMinimoProducto } from "../src/server/actions/stock/stock-minimo";
import type { ResultadoAccion } from "../src/server/actions/tipos";
import { crearGeneradorAleatorio } from "./demo-seed/prng";
import { generarGuionLaCuadra, necesidadSemanal, construirMultiplicadoresPorPV, MP_POR_PROVEEDOR, CONFIG_LA_CUADRA_DEFAULT } from "./demo-seed/guion-la-cuadra";
import { validarGuion, calcularTotalesEsperados } from "./demo-seed/guion";
import { verificarBaseVacia, pideRehacer } from "./demo-seed/guardas-destino";
import { PROVEEDORES, PRODUCTOS, RECETAS } from "./seed-demo-pizzeria-data";

const EMAIL_ADMIN = "alepogabriel@gmail.com";
const NOMBRE_SUCURSAL = "La Cuadra";
/** Fija para que el guion sea SIEMPRE el mismo (mismos precios, mismas cantidades, mismos escenarios) — reproducible entre corridas, y comparable con lo que ya se vio en un review. */
const SEMILLA_GUION = 20260922;
/** Recién se carga al final del tramo de desorden (ver EventoCrearReceta en guion.ts) — se excluye acá del alta inicial de recetas. */
const PRODUCTO_RECETA_TARDIA = "PV020";

const UNIDAD_MAP: Record<string, string> = { KG: "kg", G: "g", LT: "l", ML: "ml", UN: "unidad", BOL: "bolsa", PAQ: "paquete", CJ: "caja", LATA: "lata", BALDE: "balde", BOT: "botella" };
const UNIDADES_A_CREAR = ["bolsa", "paquete", "caja", "lata", "balde", "botella"];

async function mock(usuario: { id: string; email: string; nombre: string | null }) {
  vi.mocked(getUsuarioActual).mockResolvedValue(usuario);
}

describe("seed de 6 meses — demo pizzería La Cuadra", () => {
  it(
    "siembra catálogo + 6 meses de movimientos reales, ejecutando el guion completo",
    async () => {
      const inicio = Date.now();
      const fallos: string[] = [];
      const anotarSiFalla = (etiqueta: string, r: ResultadoAccion) => {
        if (!r.ok) fallos.push(`${etiqueta}: ${r.mensaje}`);
      };

      // --- 1) Usuario admin de "Central" (seed base), sucursal "La Cuadra". ---
      const usuario = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_ADMIN } });
      await mock({ id: usuario.id, email: usuario.email, nombre: usuario.name });
      const central = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } });
      __setCookieDeTestParaSucursal(central.id);

      const sucursalExistente = await prisma.sucursal.findUnique({ where: { nombre: NOMBRE_SUCURSAL } });
      verificarBaseVacia(NOMBRE_SUCURSAL, sucursalExistente !== null, pideRehacer(process.env));

      let sucursal = sucursalExistente;
      if (!sucursal) {
        const r = await crearSucursalConAdmin({ nombre: NOMBRE_SUCURSAL, emailPrimerAdmin: EMAIL_ADMIN });
        anotarSiFalla("crearSucursalConAdmin", r);
        sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: NOMBRE_SUCURSAL } });
      }
      __setCookieDeTestParaSucursal(sucursal.id);

      // --- 2) Secciones. ---
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
      const idSeccion = (seccion: "Cocina" | "Barra") => (seccion === "Barra" ? seccionBarra : seccionCocina);

      // --- 3) Categorías. ---
      const categoriasExistentes = await prisma.categoriaProducto.findMany();
      const categoriaPorNombre = new Map(categoriasExistentes.map((c) => [c.nombre, c.id]));
      for (const nombre of new Set(PRODUCTOS.map((p) => p.categoria))) {
        if (categoriaPorNombre.has(nombre)) continue;
        const r = await crearCategoriaProducto(nombre);
        anotarSiFalla(`crearCategoriaProducto(${nombre})`, r);
        if (r.ok) categoriaPorNombre.set(nombre, r.id);
      }

      // --- 4) Unidades. ---
      const unidadesExistentes = await prisma.unidad.findMany();
      const unidadIdPorNombre = new Map(unidadesExistentes.map((u) => [u.nombre, u.id]));
      for (const nombre of UNIDADES_A_CREAR) {
        if (unidadIdPorNombre.has(nombre)) continue;
        const r = await crearUnidad({ nombre, magnitud: "CANTIDAD", decimales: 0 });
        anotarSiFalla(`crearUnidad(${nombre})`, r);
        if (r.ok) unidadIdPorNombre.set(nombre, r.id);
      }
      const idUnidad = (codigoSheet: string): string => {
        const id = unidadIdPorNombre.get(UNIDAD_MAP[codigoSheet]);
        if (!id) throw new Error(`Unidad no resuelta: ${codigoSheet}`);
        return id;
      };

      // --- 5) Proveedores. ---
      const proveedoresExistentes = await prisma.proveedor.findMany();
      const proveedorIdPorNombre = new Map(proveedoresExistentes.map((p) => [p.nombre, p.id]));
      for (const p of PROVEEDORES) {
        if (proveedorIdPorNombre.has(p.nombre)) continue;
        const r = await altaProveedor({ nombre: p.nombre, contacto: p.contacto, telefono: p.telefono, email: p.email, cuit: p.cuit, condicionesPago: p.condicionesPago, notas: p.notas });
        anotarSiFalla(`altaProveedor(${p.nombre})`, r);
        if (r.ok) {
          proveedorIdPorNombre.set(p.nombre, r.id);
          if (!p.activo) anotarSiFalla(`actualizarActivaProveedor(${p.nombre})`, await actualizarActivaProveedor(r.id, false));
        }
      }
      const proveedorIdPorCodigo = new Map(PROVEEDORES.map((p) => [p.codigo, proveedorIdPorNombre.get(p.nombre)!]));

      // --- 5b) Grupo "No comestibles" → "Packaging"/"Limpieza", con un Insumo cada uno (ver el mismo bloque, con
      // el docstring completo, en seed-demo-pizzeria.ts) — MP019/MP020 (cajas de pizza) y OT001/OT002
      // (detergente/lavandina) dejan de entrar al food cost como si fueran comida. ---
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
      const insumoIdPorCodigoNoComestible: Record<string, string> = { MP019: insumoPackaging, MP020: insumoPackaging, OT001: insumoLimpieza, OT002: insumoLimpieza };

      // --- 6) Insumo "MORRON" (hermana MP011/MP011B). ---
      let insumoMorron = await prisma.insumo.findUnique({ where: { nombre: "MORRON" } });
      if (!insumoMorron) {
        anotarSiFalla("crearInsumo(MORRON)", await crearInsumo("MORRON"));
        insumoMorron = await prisma.insumo.findUniqueOrThrow({ where: { nombre: "MORRON" } });
      }

      // --- 7) Productos (incluye PV030, ya en PRODUCTOS — ver seed-demo-pizzeria-data.ts) + MP011B (compra de oportunidad, sin código de catálogo real). ---
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
          if (!p.activo) anotarSiFalla(`actualizarActivoProducto(${p.codigo})`, await actualizarActivoProducto(creado.id, false));
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
          observaciones: "Mismo Insumo que MP011 — comprado sin proveedor formal cuando falta para la semana.",
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

      // --- 8) Recetas — TODAS salvo PV020 (recién se carga con el evento CREAR_RECETA del guion, ver docstring). ---
      for (const receta of RECETAS) {
        if (receta.productoCodigo === PRODUCTO_RECETA_TARDIA) continue;
        const productoId = idProd(receta.productoCodigo);
        if (await prisma.recetaVersion.findFirst({ where: { productoId } })) continue;
        const items = receta.ingredientes.map((ing) => ({ insumoProductoId: idProd(ing.insumoCodigo), cantidad: ing.cantidad, unidadId: idUnidad(ing.unidad), mermaPorcentaje: ing.mermaPorcentaje, observaciones: ing.observaciones }));
        anotarSiFalla(`guardarReceta(${receta.productoCodigo})`, await guardarReceta(productoId, items, [], {}));
      }
      if (fallos.length) {
        console.error("FALLOS EN EL ALTA DE CATÁLOGO:\n" + fallos.join("\n"));
        expect(fallos, fallos.join("\n")).toEqual([]);
      }
      console.log(`Catálogo listo (${((Date.now() - inicio) / 1000).toFixed(1)}s) — generando el guion de 6 meses...`);

      // --- Guion: determinístico, misma semilla siempre. ---
      const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(SEMILLA_GUION));
      const problemas = validarGuion(guion);
      if (problemas.length) {
        console.error("GUION INVÁLIDO:\n" + problemas.join("\n"));
        expect(problemas, problemas.join("\n")).toEqual([]);
      }
      const precioVentaPorCodigo = new Map(PRODUCTOS.filter((p) => p.tipo === "PV" && p.activo).map((p) => [p.codigo, p.precioVenta]));
      const esperado = calcularTotalesEsperados(guion, precioVentaPorCodigo);
      console.log(`Guion: ${guion.eventos.length} eventos — esperado: $${esperado.compras.totalGastado.toLocaleString("es-AR")} en compras, $${esperado.ventas.totalFacturado.toLocaleString("es-AR")} en ventas.`);

      // --- "Hoy" ancla el final de la ventana — semana N-1, día 6 (sábado) = hoy. ---
      const HOY = new Date();
      HOY.setUTCHours(0, 0, 0, 0);
      function fechaDe(semana: number, diaSemana: number, horaUtc = 14): Date {
        const diasDesdeElFinal = (CONFIG_LA_CUADRA_DEFAULT.semanas - 1 - semana) * 7 + (6 - diaSemana);
        const f = new Date(HOY);
        f.setUTCDate(f.getUTCDate() - diasDesdeElFinal);
        f.setUTCHours(horaUtc, 0, 0, 0);
        return f;
      }

      const RECETA_POR_PRODUCTO = new Map(RECETAS.map((r) => [r.productoCodigo, r.ingredientes]));
      const operacionIdPorRef = new Map<string, string>();
      const inicioEjecucion = Date.now();
      const contadorPorTipo: Record<string, number> = {};

      for (const ev of guion.eventos) {
        contadorPorTipo[ev.tipo] = (contadorPorTipo[ev.tipo] ?? 0) + 1;
        const fecha = fechaDe(ev.semana, ev.diaSemana);

        if (ev.tipo === "COMPRA") {
          const items = ev.items.map((it) => ({
            productoId: idProd(it.productoCodigo),
            cantidad: it.cantidad,
            precioTotal: Math.round(it.cantidad * it.precioUnitario),
            loteVencimiento: it.loteVencimiento ?? undefined,
          }));
          const r = await registrarMovimiento({
            proceso: "COMPRA",
            fecha,
            seccionId: idSeccion(ev.seccion),
            proveedorId: ev.proveedorCodigo ? proveedorIdPorCodigo.get(ev.proveedorCodigo) : undefined,
            nroFactura: ev.nroFactura,
            items,
          });
          anotarSiFalla(`COMPRA ${ev.ref}`, r);
          if (r.ok) {
            // La más reciente Operación COMPRA de la sucursal: como se ejecuta secuencial (await por evento), es la que se acaba de crear.
            const creada = await prisma.operacion.findFirst({ where: { sucursalId: sucursal.id, proceso: "COMPRA" }, orderBy: { creadoEn: "desc" } });
            if (creada) operacionIdPorRef.set(ev.ref, creada.id);
          }
        } else if (ev.tipo === "VENTA") {
          const ventas = ev.items.map((it) => ({ productoId: idProd(it.productoCodigo), cantidadVendida: it.cantidad }));
          const r = await registrarVenta({ fecha, seccionId: idSeccion(ev.seccion), detalle: "Venta de mostrador", ventas });
          anotarSiFalla(`VENTA ${ev.ref}`, r);
        } else if (ev.tipo === "PRODUCCION") {
          const r = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId: idSeccion(ev.seccion), items: [{ productoId: idProd(ev.productoCodigo), cantidad: ev.cantidad }] });
          anotarSiFalla(`PRODUCCION ${ev.ref}`, r);
        } else if (ev.tipo === "MERMA") {
          const r = await registrarMovimiento({ proceso: "MERMA", fecha, seccionId: idSeccion(ev.seccion), motivo: ev.motivo, detalleLibre: ev.detalleLibre, items: [{ productoId: idProd(ev.productoCodigo), cantidad: ev.cantidad }] });
          anotarSiFalla(`MERMA ${ev.ref}`, r);
        } else if (ev.tipo === "CONTEO_FISICO") {
          const productoId = idProd(ev.productoCodigo);
          const seccionId = idSeccion(ev.seccion);
          const saldo = await prisma.movimientoStock.aggregate({ where: { productoId, seccionId }, _sum: { cantidad: true } });
          const saldoActual = Number(saldo._sum.cantidad ?? 0);
          const conteoReal = Math.max(0, Math.round((saldoActual + ev.ajusteRelativo) * 100) / 100);
          const r = await registrarConteoFisico({ productoId, seccionId, conteoReal, fechaConteo: fecha, accion: ev.accion, detalle: ev.detalle });
          anotarSiFalla(`CONTEO_FISICO ${ev.ref}`, r);
        } else if (ev.tipo === "CREAR_RECETA") {
          const ingredientes = RECETA_POR_PRODUCTO.get(ev.productoCodigo);
          if (!ingredientes) {
            fallos.push(`CREAR_RECETA ${ev.ref}: sin ingredientes para "${ev.productoCodigo}" en RECETAS`);
          } else {
            const items = ingredientes.map((ing) => ({ insumoProductoId: idProd(ing.insumoCodigo), cantidad: ing.cantidad, unidadId: idUnidad(ing.unidad), mermaPorcentaje: ing.mermaPorcentaje, observaciones: ing.observaciones }));
            anotarSiFalla(`CREAR_RECETA ${ev.ref}`, await guardarReceta(idProd(ev.productoCodigo), items, [], {}));
          }
        } else if (ev.tipo === "ANULAR_COMPRA") {
          const operacionId = operacionIdPorRef.get(ev.refCompra);
          if (!operacionId) fallos.push(`ANULAR_COMPRA ${ev.ref}: no se resolvió la compra "${ev.refCompra}"`);
          else anotarSiFalla(`ANULAR_COMPRA ${ev.ref}`, await anularCompra(operacionId));
        } else if (ev.tipo === "CORREGIR_COMPRA") {
          const operacionId = operacionIdPorRef.get(ev.refCompra);
          if (!operacionId) {
            fallos.push(`CORREGIR_COMPRA ${ev.ref}: no se resolvió la compra "${ev.refCompra}"`);
          } else {
            const actual = await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } });
            const esperadoCabecera = { proveedorId: actual.proveedorId, nroFactura: actual.nroFactura, detalleLibre: actual.detalleLibre };
            const nueva = {
              proveedorId: ev.proveedorCodigo ? (proveedorIdPorCodigo.get(ev.proveedorCodigo) ?? actual.proveedorId) : actual.proveedorId,
              nroFactura: ev.nroFactura ?? actual.nroFactura ?? "",
              detalleLibre: actual.detalleLibre ?? "",
            };
            anotarSiFalla(`CORREGIR_COMPRA ${ev.ref}`, await corregirCompra(operacionId, nueva, esperadoCabecera));
          }
        }
      }

      const segundos = (Date.now() - inicioEjecucion) / 1000;
      console.log(`\nEjecución: ${guion.eventos.length} eventos en ${segundos.toFixed(1)}s (${(guion.eventos.length / segundos).toFixed(1)} eventos/s).`);
      console.log("Por tipo: " + Object.entries(contadorPorTipo).map(([t, n]) => `${t}=${n}`).join(", "));

      // --- Stock mínimo (§0: "el resto ordenado: recetas completas, stock mínimo cargado, conteos periódicos") — una
      // decisión de catálogo (CUÁNTO y para CUÁLES), no un evento del guion. Mínimo = ~40% de la necesidad semanal en
      // régimen (última semana, ya sin el ruido del tramo de desorden), redondeado — para que "Alertas de stock" tenga
      // algo real que mostrar sin que la demo arranque llena de alertas falsas por un mínimo mal calibrado.
      const multiplicadoresRef = construirMultiplicadoresPorPV(crearGeneradorAleatorio(SEMILLA_GUION), CONFIG_LA_CUADRA_DEFAULT.semanas);
      const necesidadEnRegimen = necesidadSemanal(CONFIG_LA_CUADRA_DEFAULT.semanas - 1, multiplicadoresRef).directa;
      const mpsConMinimo = Object.values(MP_POR_PROVEEDOR).flat();
      for (const codigo of mpsConMinimo) {
        const necesidad = necesidadEnRegimen[codigo] ?? 0;
        if (!(necesidad > 0)) continue;
        const minimo = Math.max(1, Math.round(necesidad * 0.4));
        anotarSiFalla(`stockMinimo(${codigo})`, await setStockMinimoProducto(idProd(codigo), minimo));
      }

      if (fallos.length) console.error(`\nFALLOS DURANTE LA EJECUCIÓN (${fallos.length}):\n` + fallos.slice(0, 30).join("\n") + (fallos.length > 30 ? `\n… y ${fallos.length - 30} más` : ""));
      expect(fallos.length, `${fallos.length} fallos — ver arriba`).toBe(0);

      console.log(`\nListo — sucursal "${NOMBRE_SUCURSAL}" (${sucursal.id}), usuario admin "${EMAIL_ADMIN}". Total: ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
    },
    3_000_000
  );
});
