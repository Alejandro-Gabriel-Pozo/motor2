import { isDeepStrictEqual } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { chequearIdempotencia } from "../../src/server/persistencia/movimientos/idempotencia";
import { esClaveIdempotenciaValida } from "../../src/core/datos/clave-idempotencia";
import { conTransaccionSerializable } from "../../src/lib/transaccion-serializable";

/**
 * Task #41, Fase F3 — testing basado en propiedades (fast-check) del mecanismo I3 de idempotencia
 * (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md). Complementa, no reemplaza, a
 * test/auditoria/idempotencia-i3-mecanismo.test.ts (caracterización por Server Action, casos fijos + concurrencia real):
 * acá se prueban las tres piezas del mecanismo por separado, sobre entradas generadas.
 *
 * - `calcularPayloadHash`: SHA-256 de `JSON.stringify` de `{ procesoTag, sucursalId, payload }` CANONICALIZADO (claves
 *   ordenadas recursivamente, `undefined` descartado en objetos / → `null` en arrays, `Date` → ISO). Consecuencia real,
 *   documentada abajo como propiedad y no como bug: el hash identifica la FORMA JSON canónica, no el valor JS — el orden de
 *   claves NO cambia el hash, y `Date` vs. su string ISO, `-0` vs. `0`, `{a: undefined}` vs. `{}` colisionan a propósito.
 * - `esClaveIdempotenciaValida`: UUID versiones 1-5, variante RFC 4122 (8/9/a/b), sin distinguir mayúsculas.
 * - `chequearIdempotencia` (Postgres real): SOLO LEE — nunca crea ni modifica filas; la escritura de la clave la hace el
 *   llamador cuando el resultado es "nueva". Por eso "no duplica el efecto" se prueba simulando el protocolo completo de
 *   las Server Actions (chequear → si "nueva", crear la Operacion con clave/hash/mensaje) y reintentándolo.
 *   `MENSAJE_CONFLICTO_IDEMPOTENCIA` NO lo devuelve esta función (devuelve `{ estado: "conflicto" }`, sin mensaje): lo
 *   traduce cada Server Action; acá solo se fija que exista y sea no vacío.
 */

/** Oráculo independiente de igualdad "canónica" para valores JSON: el round-trip JSON normaliza -0 y `isDeepStrictEqual` ignora el orden de claves. */
function igualesComoJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

/** Reconstruye un valor JSON con el orden de claves de cada objeto invertido (recursivo) — mismo contenido, otra serialización cruda. */
function invertirOrdenDeClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(invertirOrdenDeClaves);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, invertirOrdenDeClaves(v)])
    );
  }
  return valor;
}

const HEX = "0123456789abcdef";
const hexChar = fc.constantFrom(...HEX.split(""));
const hexN = (n: number) => fc.array(hexChar, { minLength: n, maxLength: n }).map((cs) => cs.join(""));

/** Texto sin NUL: Postgres rechaza \u0000 en columnas text. */
const textoPostgres = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => !s.includes("\u0000"));

describe("F3 — propiedades de calcularPayloadHash", () => {
  const tag = fc.string({ maxLength: 20 });
  const sucursal = fc.string({ maxLength: 30 });

  it("es un SHA-256 hex (64 caracteres) y determinista: mismos argumentos → mismo hash", () => {
    fc.assert(
      fc.property(tag, sucursal, fc.jsonValue(), (t, s, p) => {
        const h1 = calcularPayloadHash(t, s, p);
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
        // Una copia estructural (otro objeto, mismas claves) da el mismo hash: no depende de la identidad del objeto.
        expect(calcularPayloadHash(t, s, JSON.parse(JSON.stringify(p)))).toBe(h1);
        expect(calcularPayloadHash(t, s, p)).toBe(h1);
      }),
      { numRuns: 200 }
    );
  });

  it("el orden de las claves del payload NO cambia el hash (canonicalización recursiva)", () => {
    fc.assert(
      fc.property(tag, sucursal, fc.jsonValue(), (t, s, p) => {
        expect(calcularPayloadHash(t, s, invertirOrdenDeClaves(p))).toBe(calcularPayloadHash(t, s, p));
      }),
      { numRuns: 200 }
    );
  });

  it("hash igual ⇔ payloads iguales como JSON (oráculo independiente): payloads distintos nunca colisionan", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        const mismosHashes = calcularPayloadHash("TAG", "suc", a) === calcularPayloadHash("TAG", "suc", b);
        expect(mismosHashes).toBe(igualesComoJson(a, b));
      }),
      { numRuns: 300 }
    );
  });

  it("payloads chicos que difieren en un solo escalar dan hashes distintos", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
        fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
        (x, y) => {
          fc.pre(!Object.is(x, y));
          expect(calcularPayloadHash("TAG", "suc", { cantidad: x })).not.toBe(calcularPayloadHash("TAG", "suc", { cantidad: y }));
        }
      ),
      { numRuns: 200 }
    );
  });

  it("procesoTag y sucursalId forman parte del hash, sin ambigüedad de concatenación: (tag, suc) distintos → hash distinto", () => {
    fc.assert(
      fc.property(tag, sucursal, tag, sucursal, fc.jsonValue(), (t1, s1, t2, s2, p) => {
        fc.pre(t1 !== t2 || s1 !== s2);
        expect(calcularPayloadHash(t1, s1, p)).not.toBe(calcularPayloadHash(t2, s2, p));
      }),
      { numRuns: 200 }
    );
    // Caso de borde explícito: la frontera entre tag y sucursal no se puede "correr" (se serializan como campos JSON separados).
    expect(calcularPayloadHash("ab", "c", 1)).not.toBe(calcularPayloadHash("a", "bc", 1));
  });

  it("colisiones INTENCIONALES de la canonicalización (comportamiento real, no bug): Date≡ISO, -0≡0, undefined en objeto≡ausente, undefined en array≡null", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("1970-01-01T00:00:00.000Z"), max: new Date("9999-12-31T23:59:59.999Z"), noInvalidDate: true }),
        fc.jsonValue(),
        (fecha, p) => {
          expect(calcularPayloadHash("T", "s", { fecha, p })).toBe(calcularPayloadHash("T", "s", { fecha: fecha.toISOString(), p }));
          expect(calcularPayloadHash("T", "s", { p, extra: undefined })).toBe(calcularPayloadHash("T", "s", { p }));
          expect(calcularPayloadHash("T", "s", [p, undefined])).toBe(calcularPayloadHash("T", "s", [p, null]));
        }
      ),
      { numRuns: 100 }
    );
    expect(calcularPayloadHash("T", "s", { x: -0 })).toBe(calcularPayloadHash("T", "s", { x: 0 }));
    // OJO, asimetría real: un payload `undefined` en el NIVEL SUPERIOR no colisiona con `null` — la clave `payload` del
    // envoltorio `{ procesoTag, sucursalId, payload }` se descarta entera (queda ausente), mientras que `null` se serializa.
    expect(calcularPayloadHash("T", "s", undefined)).not.toBe(calcularPayloadHash("T", "s", null));
  });
});

describe("F3 — propiedades de esClaveIdempotenciaValida", () => {
  it("todo UUID v1-v5 con variante RFC 4122 es válido, en minúsculas o mayúsculas", () => {
    fc.assert(
      // `fc.uuid()` sin restricción genera v1-v8 desde fast-check 3.21 (RFC 9562) — acá se restringe a v1-v5,
      // que es lo único que este test afirma que es válido.
      fc.property(fc.uuid({ version: [1, 2, 3, 4, 5] }), fc.boolean(), (uuid, mayus) => {
        expect(esClaveIdempotenciaValida(mayus ? uuid.toUpperCase() : uuid)).toBe(true);
      }),
      { numRuns: 300 }
    );
    expect(esClaveIdempotenciaValida(crypto.randomUUID())).toBe(true);
  });

  it("un UUID con versión fuera de 1-5 (0, 6-f) es inválido", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.constantFrom(..."06789abcdef".split("")), (uuid, version) => {
        const alterado = `${uuid.slice(0, 14)}${version}${uuid.slice(15)}`;
        expect(esClaveIdempotenciaValida(alterado)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("un UUID con variante fuera de 8/9/a/b es inválido", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.constantFrom(..."01234567cdef".split("")), (uuid, variante) => {
        const alterado = `${uuid.slice(0, 19)}${variante}${uuid.slice(20)}`;
        expect(esClaveIdempotenciaValida(alterado)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("cualquier mutación de forma (carácter no hex, guion corrido/faltante, recorte, sufijo/prefijo, espacios) invalida la clave", () => {
    const mutacion = fc.oneof(
      // Carácter no hexadecimal en una posición de dígito.
      fc.tuple(fc.integer({ min: 0, max: 35 }), fc.constantFrom("g", "z", "G", "-", " ", "_", "ñ")).map(
        ([i, c]) =>
          (u: string) =>
            [8, 13, 18, 23].includes(i) ? u : `${u.slice(0, i)}${c}${u.slice(i + 1)}`
      ),
      fc.integer({ min: 1, max: 35 }).map((n) => (u: string) => u.slice(0, n)),
      fc.string({ minLength: 1, maxLength: 5 }).map((s) => (u: string) => u + s),
      fc.string({ minLength: 1, maxLength: 5 }).map((s) => (u: string) => s + u),
      fc.constant((u: string) => u.replace(/-/g, "")),
      fc.constant((u: string) => ` ${u}`),
      fc.constant((u: string) => `${u}\n`)
    );
    fc.assert(
      fc.property(fc.uuid(), mutacion, (uuid, mutar) => {
        const alterado = mutar(uuid);
        fc.pre(alterado !== uuid);
        expect(esClaveIdempotenciaValida(alterado)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it("strings arbitrarios de 36 caracteres hex/guiones solo son válidos si calzan exactamente el formato 8-4-4-4-12 con versión y variante válidas", () => {
    const formato = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    fc.assert(
      fc.property(fc.array(fc.constantFrom(..."0123456789abcdef-".split("")), { minLength: 36, maxLength: 36 }), (cs) => {
        const s = cs.join("");
        expect(esClaveIdempotenciaValida(s)).toBe(formato.test(s));
      }),
      { numRuns: 200 }
    );
    // Y cuando se arma con la forma correcta desde piezas, es válido.
    fc.assert(
      fc.property(hexN(8), hexN(4), fc.constantFrom("1", "2", "3", "4", "5"), hexN(3), fc.constantFrom("8", "9", "a", "b"), hexN(3), hexN(12), (a, b, v, c, w, d, e) => {
        expect(esClaveIdempotenciaValida(`${a}-${b}-${v}${c}-${w}${d}-${e}`)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("nunca acepta un valor que no sea string", () => {
    fc.assert(
      fc.property(
        fc.anything().filter((v) => typeof v !== "string"),
        (v) => {
          expect(esClaveIdempotenciaValida(v)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("F3 — propiedades de chequearIdempotencia (Postgres real)", () => {
  // Bajo a propósito (presupuesto de `npm test`, Task #41 Fase F): cada corrida hace 3-10 round-trips a Postgres dentro de
  // transacciones serializables. Con 20 el archivo entero tarda ~1s de tests contra Postgres local.
  const NUM_RUNS_DB = 20;

  let sucursalId: string;
  let usuarioId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central F3" } })).id;
    usuarioId = (await prisma.user.create({ data: { email: "f3@test.com" } })).id;
  });

  /**
   * Réplica mínima del protocolo de las Server Actions I3 (p. ej. registrarMovimiento): dentro de una transacción
   * serializable, chequear; si es "nueva", ejecutar el efecto (acá: crear la Operacion con clave/hash/mensaje); si es
   * "duplicado", devolver el mensaje persistido; si es "conflicto", no hacer nada.
   */
  async function intentar(clave: string, payloadHash: string, mensaje: string) {
    return conTransaccionSerializable(baseDeTest.transaccion, async (tx) => {
      const chequeo = await chequearIdempotencia(tx, clave, payloadHash);
      if (chequeo.estado === "nueva") {
        await tx.operacion.create({
          data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId, claveIdempotencia: clave, payloadHash, resultadoMensaje: mensaje },
        });
        return { estado: "nueva" as const, mensaje };
      }
      return chequeo;
    });
  }

  const payloadCompra = fc.record({
    productoId: fc.string({ minLength: 1, maxLength: 12 }),
    cantidad: fc.integer({ min: 1, max: 10_000 }),
    nota: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  });

  it("clave ausente o vacía → siempre 'nueva', sin tocar la base", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(undefined, ""), fc.jsonValue(), async (clave, payload) => {
        const antes = await prisma.operacion.count();
        const r = await chequearIdempotencia(prisma, clave, calcularPayloadHash("COMPRA", sucursalId, payload));
        expect(r).toEqual({ estado: "nueva" });
        expect(await prisma.operacion.count()).toBe(antes);
      }),
      { numRuns: 5 }
    );
  });

  it("misma clave + mismo payload, reintentada N veces: 1 sola Operacion, todos los reintentos son 'duplicado' con el mensaje original", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), payloadCompra, textoPostgres, fc.integer({ min: 1, max: 3 }), async (clave, payload, mensaje, reintentos) => {
        await prisma.operacion.deleteMany({ where: { claveIdempotencia: clave } });
        const hash = calcularPayloadHash("COMPRA", sucursalId, payload);

        const primero = await intentar(clave, hash, mensaje);
        expect(primero).toEqual({ estado: "nueva", mensaje });

        for (let i = 0; i < reintentos; i++) {
          // Mismo payload recalculado desde una copia con otro orden de claves: sigue siendo el MISMO intento.
          const hashReintento = calcularPayloadHash("COMPRA", sucursalId, invertirOrdenDeClaves(payload));
          const r = await intentar(clave, hashReintento, "otro mensaje que NO debe persistirse");
          expect(r).toEqual({ estado: "duplicado", mensaje });
        }

        const filas = await prisma.operacion.findMany({ where: { claveIdempotencia: clave } });
        expect(filas).toHaveLength(1);
        expect(filas[0].payloadHash).toBe(hash);
        expect(filas[0].resultadoMensaje).toBe(mensaje);
      }),
      { numRuns: NUM_RUNS_DB }
    );
  });

  it("misma clave + payload distinto (o mismo payload desde otro proceso/sucursal): 'conflicto', sin crear ni modificar filas", async () => {
    const mensaje = (clave: string) => `Compra registrada (${clave.slice(0, 8)})`;
    const variante = fc.oneof(
      // Payload distinto, mismo proceso y sucursal.
      fc.tuple(payloadCompra, payloadCompra).filter(([a, b]) => !igualesComoJson(a, b)).map(([a, b]) => ({ original: a, otro: b, tagOtro: "COMPRA", sucursalOtra: false })),
      // Mismo payload reutilizado desde otro proceso (§11.8).
      payloadCompra.map((p) => ({ original: p, otro: p, tagOtro: "VENTA", sucursalOtra: false })),
      // Mismo payload reenviado desde otra sucursal (§11.2).
      payloadCompra.map((p) => ({ original: p, otro: p, tagOtro: "COMPRA", sucursalOtra: true }))
    );
    await fc.assert(
      fc.asyncProperty(fc.uuid(), variante, async (clave, { original, otro, tagOtro, sucursalOtra }) => {
        await prisma.operacion.deleteMany({ where: { claveIdempotencia: clave } });
        const hash = calcularPayloadHash("COMPRA", sucursalId, original);
        const hashOtro = calcularPayloadHash(tagOtro, sucursalOtra ? `${sucursalId}-otra` : sucursalId, otro);
        expect(hashOtro).not.toBe(hash);

        expect(await intentar(clave, hash, mensaje(clave))).toEqual({ estado: "nueva", mensaje: mensaje(clave) });
        const totalAntes = await prisma.operacion.count();

        const r = await intentar(clave, hashOtro, "no debe persistirse");
        expect(r).toEqual({ estado: "conflicto" });

        expect(await prisma.operacion.count()).toBe(totalAntes);
        const filas = await prisma.operacion.findMany({ where: { claveIdempotencia: clave } });
        expect(filas).toHaveLength(1);
        expect(filas[0].payloadHash).toBe(hash); // la fila original queda intacta
        expect(filas[0].resultadoMensaje).toBe(mensaje(clave));
      }),
      { numRuns: NUM_RUNS_DB }
    );
    // El mensaje que las Server Actions devuelven ante "conflicto" existe y no está vacío.
    expect(MENSAJE_CONFLICTO_IDEMPOTENCIA.length).toBeGreaterThan(0);
  });

  it("fail closed (§11.3): una fila con la clave pero sin resultadoMensaje es 'conflicto' incluso con el MISMO hash", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), payloadCompra, fc.boolean(), async (clave, payload, sinHash) => {
        await prisma.operacion.deleteMany({ where: { claveIdempotencia: clave } });
        const hash = calcularPayloadHash("COMPRA", sucursalId, payload);
        await prisma.operacion.create({
          data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId, claveIdempotencia: clave, payloadHash: sinHash ? null : hash, resultadoMensaje: null },
        });

        const r = await conTransaccionSerializable(baseDeTest.transaccion, (tx) => chequearIdempotencia(tx, clave, hash));
        expect(r).toEqual({ estado: "conflicto" });
        expect(await prisma.operacion.count({ where: { claveIdempotencia: clave } })).toBe(1);
      }),
      { numRuns: 10 }
    );
  });

  it("una clave sin fila es 'nueva' aunque existan otras claves con el mismo hash (la clave, no el hash, identifica el intento)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 2 }), payloadCompra, textoPostgres, async ([claveA, claveB], payload, mensaje) => {
        await prisma.operacion.deleteMany({ where: { claveIdempotencia: { in: [claveA, claveB] } } });
        const hash = calcularPayloadHash("COMPRA", sucursalId, payload);

        expect((await intentar(claveA, hash, mensaje)).estado).toBe("nueva");
        // Otra clave con el MISMO payload es un intento nuevo legítimo (p. ej. dos compras idénticas a propósito).
        expect((await intentar(claveB, hash, mensaje)).estado).toBe("nueva");
        expect(await prisma.operacion.count({ where: { claveIdempotencia: { in: [claveA, claveB] } } })).toBe(2);
      }),
      { numRuns: 10 }
    );
  });
});
