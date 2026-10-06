import { describe, expect, it } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import {
  ENTERO_MAXIMO_RAZONABLE,
  LARGO_MAXIMO_DETALLE,
  LARGO_MAXIMO_EMAIL,
  LARGO_MAXIMO_NOTAS,
  LARGO_MAXIMO_TEXTO_RECETA,
  MAXIMO_DESTINOS_RECLASIFICACION,
  MAXIMO_INGREDIENTES_RECETA,
  MAXIMO_LINEAS_POR_OPERACION,
  MAXIMO_PASOS_RECETA,
  MAXIMO_SUSTITUTOS_POR_INGREDIENTE,
  MERMA_PORCENTAJE_MAXIMA,
  validarEmailOpcional,
  validarNumeroHasta,
  validarTextoLibre,
  validarTopeDeLista,
} from "../../src/core/datos/limites";
import { guardComandoRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.guard";
import { guardComandoReclasificarStock } from "../../src/core/features/movimientos/reclasificacion.guard";
import { guardComandoConteoFisico } from "../../src/core/features/movimientos/conteo-fisico.guard";
import { guardComandoRegistrarPagoConsignante } from "../../src/core/features/reportes/pago-consignante.guard";
import {
  guardComandoCrearEnvioDirectoTraspaso,
  guardComandoCrearSolicitudTraspaso,
  guardComandoRechazarEnvioTraspaso,
  guardComandoRechazarSolicitudTraspaso,
} from "../../src/core/features/traspasos/traspaso-comandos.guard";
import { validarCabecera, validarIngredientes, validarPasos, type DatosParaValidarReceta, type IngredienteInput } from "../../src/core/catalogo/receta-validacion";
import { crearEmpresaSchema } from "../../src/core/features/empresa/empresa.schema";

const largo = (n: number) => "x".repeat(n);
// Sin catálogo leído: si algún chequeo de tope no cortara antes, la validación seguiría hasta buscar el producto y daría «no es una MP» en vez del mensaje del tope.
const SIN_DATOS: DatosParaValidarReceta = { productos: new Map(), disponiblesEnAlguna: new Set(), insumos: new Map(), mensajeDeUnidadDeSustituto: new Map(), unidades: new Map() };

describe("limites.ts (S-22/S-23)", () => {
  it("validarTextoLibre: recorta, vacío → null, pasado del tope → 'largo'", () => {
    expect(validarTextoLibre("  hola ", "El texto", 10)).toMatchObject({ ok: true, valor: "hola" });
    expect(validarTextoLibre("   ", "El texto", 10)).toMatchObject({ ok: true, valor: null });
    expect(validarTextoLibre(undefined, "El texto", 10)).toMatchObject({ ok: true, valor: null });
    expect(validarTextoLibre(largo(10), "El texto", 10).ok).toBe(true);
    expect(validarTextoLibre(largo(11), "El texto", 10)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("validarEmailOpcional: formato y largo", () => {
    expect(validarEmailOpcional("a@b.com")).toMatchObject({ ok: true, valor: "a@b.com" });
    expect(validarEmailOpcional("")).toMatchObject({ ok: true, valor: null });
    expect(validarEmailOpcional("sin-arroba")).toMatchObject({ ok: false, codigo: "formato" });
    expect(validarEmailOpcional("a b@c.com")).toMatchObject({ ok: false, codigo: "formato" });
    expect(validarEmailOpcional(`${largo(LARGO_MAXIMO_EMAIL)}@b.com`)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("validarTopeDeLista y validarNumeroHasta", () => {
    expect(validarTopeDeLista([1, 2], "Los items", 2)).toBeNull();
    expect(validarTopeDeLista([1, 2, 3], "Los items", 2)).toMatch(/no pueden ser más de 2/);
    expect(validarNumeroHasta(5, "El número", 5)).toBeNull();
    expect(validarNumeroHasta(6, "El número", 5)).toMatch(/no puede superar 5/);
    expect(validarNumeroHasta(Number.NaN, "El número", 5)).toMatch(/no es un número válido/);
    expect(validarNumeroHasta(Number.POSITIVE_INFINITY, "El número", 5)).toMatch(/no es un número válido/);
  });
});

describe("guards: topes de texto y de listas", () => {
  const item = { productoId: "p", cantidad: 1 };
  const movimientoBase = { proceso: "COMPRA", items: [item], seccionId: "s", fecha: new Date() };

  it("registrar movimiento: 'constructor' / '__proto__' / 'toString' no son procesos (Object.hasOwn)", () => {
    for (const proceso of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(guardComandoRegistrarMovimiento({ ...movimientoBase, proceso }, AHORA_DE_LA_CORRIDA).ok, proceso).toBe(false);
    }
    expect(guardComandoRegistrarMovimiento(movimientoBase, AHORA_DE_LA_CORRIDA).ok).toBe(true);
  });

  it("registrar movimiento: tope de líneas y de detalle", () => {
    const justo = guardComandoRegistrarMovimiento({ ...movimientoBase, items: Array(MAXIMO_LINEAS_POR_OPERACION).fill(item) }, AHORA_DE_LA_CORRIDA);
    expect(justo.ok).toBe(true);
    const mucho = guardComandoRegistrarMovimiento({ ...movimientoBase, items: Array(MAXIMO_LINEAS_POR_OPERACION + 1).fill(item) }, AHORA_DE_LA_CORRIDA);
    expect(mucho).toMatchObject({ ok: false, codigo: "rango" });
    expect(guardComandoRegistrarMovimiento({ ...movimientoBase, detalleLibre: largo(LARGO_MAXIMO_DETALLE) }, AHORA_DE_LA_CORRIDA).ok).toBe(true);
    expect(guardComandoRegistrarMovimiento({ ...movimientoBase, detalleLibre: largo(LARGO_MAXIMO_DETALLE + 1) }, AHORA_DE_LA_CORRIDA)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("registrar movimiento: la referencia del proveedor de cada línea tiene tope de largo", () => {
    const con = (referenciaProveedor: unknown) => guardComandoRegistrarMovimiento({ ...movimientoBase, items: [{ ...item, referenciaProveedor }] }, AHORA_DE_LA_CORRIDA);
    expect(con(largo(LARGO_MAXIMO_DETALLE)).ok).toBe(true);
    expect(con(largo(LARGO_MAXIMO_DETALLE + 1))).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("traspasos: el motivo de un rechazo (solicitud o envío) tiene tope de largo", () => {
    for (const guard of [guardComandoRechazarSolicitudTraspaso, guardComandoRechazarEnvioTraspaso]) {
      expect(guard({ id: "t-1", motivo: largo(LARGO_MAXIMO_DETALLE) }).ok).toBe(true);
      expect(guard({ id: "t-1", motivo: largo(LARGO_MAXIMO_DETALLE + 1) })).toMatchObject({ ok: false, codigo: "largo" });
    }
  });

  it("reclasificación: tope de destinos y de detalle", () => {
    const base = { productoId: "p", seccionOrigenId: "s", destinos: [{ seccionId: "d" }], fecha: new Date() };
    expect(guardComandoReclasificarStock(base, AHORA_DE_LA_CORRIDA).ok).toBe(true);
    const destinos = Array(MAXIMO_DESTINOS_RECLASIFICACION + 1).fill({ seccionId: "d" });
    expect(guardComandoReclasificarStock({ ...base, destinos }, AHORA_DE_LA_CORRIDA)).toMatchObject({ ok: false, codigo: "rango" });
    expect(guardComandoReclasificarStock({ ...base, detalle: largo(LARGO_MAXIMO_DETALLE + 1) }, AHORA_DE_LA_CORRIDA)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("conteo físico: tope de detalle", () => {
    expect(guardComandoConteoFisico({ seccionId: "s", accion: "AJUSTAR", fechaConteo: new Date(), detalle: largo(LARGO_MAXIMO_DETALLE) }, AHORA_DE_LA_CORRIDA).ok).toBe(true);
    expect(guardComandoConteoFisico({ seccionId: "s", accion: "AJUSTAR", fechaConteo: new Date(), detalle: largo(LARGO_MAXIMO_DETALLE + 1) }, AHORA_DE_LA_CORRIDA)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("pago a consignante: tope de notas", () => {
    const base = { proveedorId: "p", importe: 10, fecha: new Date() };
    expect(guardComandoRegistrarPagoConsignante({ ...base, notas: largo(LARGO_MAXIMO_NOTAS) }, AHORA_DE_LA_CORRIDA).ok).toBe(true);
    expect(guardComandoRegistrarPagoConsignante({ ...base, notas: largo(LARGO_MAXIMO_NOTAS + 1) }, AHORA_DE_LA_CORRIDA)).toMatchObject({ ok: false, codigo: "largo" });
  });

  it("solicitud de traspaso: tope de detalle", () => {
    const base = { origenSucursalId: "o", seccionDestinoId: "d", productoId: "p", cantidad: 1 };
    expect(guardComandoCrearSolicitudTraspaso({ ...base, detalle: largo(LARGO_MAXIMO_DETALLE) }).ok).toBe(true);
    expect(guardComandoCrearSolicitudTraspaso({ ...base, detalle: largo(LARGO_MAXIMO_DETALLE + 1) })).toMatchObject({ ok: false, codigo: "largo" });
    const directo = { destinoSucursalId: "o", seccionOrigenId: "d", productoId: "p", cantidad: 1 };
    expect(guardComandoCrearEnvioDirectoTraspaso({ ...directo, detalle: largo(LARGO_MAXIMO_DETALLE + 1) })).toMatchObject({ ok: false, codigo: "largo" });
  });
});

describe("recetas: topes (S-23)", () => {
  const ing = (extra: Partial<IngredienteInput> = {}): IngredienteInput => ({ insumoProductoId: "i", cantidad: 1, unidadId: "u", ...extra });

  it("cantidad de ingredientes, merma, observaciones y sustitutos", async () => {
    expect(validarIngredientes(Array(MAXIMO_INGREDIENTES_RECETA + 1).fill(ing()), { seProduce: false }, SIN_DATOS)).toMatch(/no pueden ser más de/);
    expect(validarIngredientes([ing({ mermaPorcentaje: MERMA_PORCENTAJE_MAXIMA + 1 })], { seProduce: false }, SIN_DATOS)).toMatch(/La merma no puede superar/);
    expect(validarIngredientes([ing({ observaciones: largo(LARGO_MAXIMO_NOTAS + 1) })], { seProduce: false }, SIN_DATOS)).toMatch(/caracteres/);
    const sustitutos = Array(MAXIMO_SUSTITUTOS_POR_INGREDIENTE + 1).fill("s");
    expect(validarIngredientes([ing({ insumoSustitutoIds: sustitutos })], { seProduce: false }, SIN_DATOS)).toMatch(/no pueden ser más de/);
    expect(validarIngredientes([ing({ cantidad: 1e10 })], { seProduce: false }, SIN_DATOS)).toMatch(/demasiado grande/);
  });

  it("pasos: cantidad, orden, minutos y largo de la instrucción", () => {
    const paso = (extra = {}) => ({ orden: 1, instruccion: "Mezclar", ...extra });
    expect(validarPasos([paso()], [])).toBeNull();
    expect(validarPasos(Array.from({ length: MAXIMO_PASOS_RECETA + 1 }, (_, i) => paso({ orden: i + 1 })), [])).toMatch(/no pueden ser más de/);
    expect(validarPasos([paso({ orden: ENTERO_MAXIMO_RAZONABLE + 1 })], [])).toMatch(/orden/);
    expect(validarPasos([paso({ orden: 1.5 })], [])).toMatch(/orden/);
    expect(validarPasos([paso({ minutos: ENTERO_MAXIMO_RAZONABLE + 1 })], [])).toMatch(/minutos/);
    expect(validarPasos([paso({ minutos: 2.5 })], [])).toMatch(/minutos/);
    expect(validarPasos([paso({ instruccion: largo(LARGO_MAXIMO_TEXTO_RECETA + 1) })], [])).toMatch(/caracteres/);
  });

  it("cabecera: textos y tiempos/raciones acotados", async () => {
    expect(validarCabecera({ comentarios: largo(LARGO_MAXIMO_TEXTO_RECETA + 1) }, SIN_DATOS)).toMatch(/caracteres/);
    expect(validarCabecera({ tiempoCoccionMinutos: ENTERO_MAXIMO_RAZONABLE + 1 }, SIN_DATOS)).toMatch(/no puede superar/);
    expect(validarCabecera({ racionesCantidad: ENTERO_MAXIMO_RAZONABLE + 1 }, SIN_DATOS)).toMatch(/no puede superar/);
  });
});

describe("slug de empresa (S-29)", () => {
  const base = { nombre: "Norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" };
  it("acepta etiquetas RFC 1123 y rechaza guion en los bordes y más de 63 caracteres", () => {
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "norte-2" }).success).toBe(true);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "a" }).success).toBe(true);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "-norte" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "norte-" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: largo(63) }).success).toBe(true);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: largo(64) }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "" }).success).toBe(false);
  });
});
