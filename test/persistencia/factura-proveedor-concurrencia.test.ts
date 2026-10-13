import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3b: la UNICIDAD del número de factura y la idempotencia de la carga las decide la BASE, no una lectura previa. Acá la prueba es contra el índice real y con conexiones reales como `motor2_app`
 * (dos clientes `pg`, cada uno con su transacción y la empresa fijada): dos cargas simultáneas del mismo número de factura del mismo proveedor → gana una y la otra recibe 23505 sobre
 * `FacturaProveedor_unica_vigente_key`; si la primera hace ROLLBACK, la segunda entra (no queda nada reservado); una factura anulada libera el número; una pendiente de reparto lo reserva; otra empresa no choca.
 * Lo mismo con la clave de idempotencia (`FacturaProveedor_claveIdempotencia_key`): repetir la misma carga no duplica.
 *
 * Mutación: sacar `AND "anuladaEn" IS NULL` del índice deja en rojo «una factura anulada libera el número»; volverlo no parcial, «una anulada…»; sacar el índice, todos los de «gana una».
 */
afterAll(() => prismaAdmin.$disconnect());

const URL_DE_LA_APP = process.env.DATABASE_URL as string;

let e: EscenarioDeFactura;
const abiertos: Client[] = [];

/**
 * Una conexión como `motor2_app` con la empresa fijada en el arranque (igual que `src/lib/db`). La de la empresa de prueba trae además el alcance de sus dos sucursales (lectura y escritura), que es lo que fija
 * `conAlcanceEnSucursal` en cada transacción de la app: lo necesitan las partes, que son `PROPIA` desde M3c.
 */
async function conexion(empresaId: string = EMPRESA_DE_PRUEBA_ID): Promise<Client> {
  const sucursales = [e.sucursalA, e.sucursalB];
  const c = new Client({ connectionString: URL_DE_LA_APP, options: opcionesDeConexionConEmpresa(empresaId, empresaId === EMPRESA_DE_PRUEBA_ID ? { lectura: sucursales, escritura: sucursales } : undefined) });
  await c.connect();
  abiertos.push(c);
  return c;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
});

afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.end().catch(() => undefined)));
});

interface Carga {
  proveedorId?: string;
  nro?: string | null;
  letra?: string | null;
  estado?: "CONFIRMADA" | "PENDIENTE_DE_REPARTO";
  clave?: string | null;
  anulada?: boolean;
}

/** El INSERT de una cabecera como lo escribiría la Etapa C (id propio, número ya normalizado). */
function insertar(c: Client, carga: Carga = {}) {
  const confirmada = (carga.estado ?? "CONFIRMADA") === "CONFIRMADA";
  const nro = carga.nro === undefined ? "0001-00000001" : carga.nro;
  return c.query<{ id: string }>(
    `INSERT INTO "FacturaProveedor" ("id","proveedorId","nroFactura","nroFacturaNormalizado","letra","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","claveIdempotencia","payloadHash","creadoPorId","anuladaEn","anuladaPorId")
     VALUES ($1,$2,$3,$3,$4,'2026-09-01T15:00:00Z',100.00,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING "id"`,
    [
      randomUUID(), carga.proveedorId ?? e.proveedorId, nro, carga.letra ?? null, carga.estado ?? "CONFIRMADA", confirmada ? new Date() : null, confirmada ? e.usuarioId : null,
      carga.clave ?? null, carga.clave ? "hash" : null, e.usuarioId, carga.anulada ? new Date() : null, carga.anulada ? e.usuarioId : null,
    ],
  );
}

/** Abre la transacción, inserta y confirma. Devuelve el id, o el error de Postgres (código y restricción) si la carga se rechaza. */
async function cargar(c: Client, carga: Carga = {}): Promise<{ ok: true; id: string } | { ok: false; codigo: string; restriccion: string }> {
  try {
    await c.query("BEGIN");
    const r = await insertar(c, carga);
    await c.query("COMMIT");
    return { ok: true, id: r.rows[0]!.id };
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    const pg = error as { code?: string; constraint?: string };
    return { ok: false, codigo: pg.code ?? "otro", restriccion: pg.constraint ?? "" };
  }
}

const cuantas = async (filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "FacturaProveedor" WHERE ${filtro}`))[0]!.n);

/** Espera (hasta 10 s) a que la sesión `pid` esté bloqueada esperando a otra transacción: la prueba de que su INSERT quedó detrás del primero. */
async function esperarBloqueo(pid: number) {
  for (let i = 0; i < 200; i++) {
    const r = await prismaAdmin.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
    if (r[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`la sesión ${pid} nunca quedó esperando el bloqueo del índice único`);
}
const pidDe = async (c: Client) => Number((await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);

describe("dos cargas simultáneas del mismo número de factura: gana una", () => {
  it("dos clientes a la vez: exactamente una confirma y la otra recibe 23505 sobre el índice único vigente", async () => {
    const [a, b] = await Promise.all([conexion(), conexion()]);
    const resultados = await Promise.all([cargar(a), cargar(b)]);
    const ganadoras = resultados.filter((r) => r.ok);
    const perdedoras = resultados.filter((r) => !r.ok);
    expect(ganadoras).toHaveLength(1);
    expect(perdedoras).toEqual([{ ok: false, codigo: "23505", restriccion: "FacturaProveedor_unica_vigente_key" }]);
    expect(await cuantas()).toBe(1);
  });

  it("ocho clientes a la vez: una sola factura queda guardada y las otras siete reciben 23505", async () => {
    const clientes = await Promise.all(Array.from({ length: 8 }, () => conexion()));
    const resultados = await Promise.all(clientes.map((c) => cargar(c)));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok && r.codigo === "23505" && r.restriccion === "FacturaProveedor_unica_vigente_key")).toHaveLength(7);
    expect(await cuantas()).toBe(1);
  });

  it("el segundo INSERT ESPERA al primero (no lo adivina): si la primera transacción hace ROLLBACK, la segunda entra y no queda nada reservado", async () => {
    const [a, b] = await Promise.all([conexion(), conexion()]);
    await a.query("BEGIN");
    await insertar(a);
    await b.query("BEGIN");
    const pidDeB = await pidDe(b);
    const segundo = insertar(b);
    await esperarBloqueo(pidDeB);
    await a.query("ROLLBACK");
    const entrada = await segundo;
    await b.query("COMMIT");
    expect(entrada.rows).toHaveLength(1);
    expect(await cuantas()).toBe(1);
  });

  it("si la primera transacción CONFIRMA, la segunda que esperaba recibe 23505", async () => {
    const [a, b] = await Promise.all([conexion(), conexion()]);
    await a.query("BEGIN");
    await insertar(a);
    await b.query("BEGIN");
    const pidDeB = await pidDe(b);
    const segundo = insertar(b).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a.query("COMMIT");
    expect(await segundo).toBe("23505|FacturaProveedor_unica_vigente_key");
    await b.query("ROLLBACK");
    expect(await cuantas()).toBe(1);
  });

  it("repetir la misma carga después de confirmada no duplica (23505) y la cuenta sigue en 1", async () => {
    const a = await conexion();
    expect((await cargar(a)).ok).toBe(true);
    expect(await cargar(a)).toEqual({ ok: false, codigo: "23505", restriccion: "FacturaProveedor_unica_vigente_key" });
    expect(await cargar(a)).toEqual({ ok: false, codigo: "23505", restriccion: "FacturaProveedor_unica_vigente_key" });
    expect(await cuantas()).toBe(1);
  });
});

describe("qué reserva el número y qué lo libera", () => {
  it("una factura ANULADA libera el número: se puede cargar otra igual, y la anulada queda como historia", async () => {
    const a = await conexion();
    const primera = await cargar(a);
    expect(primera.ok).toBe(true);
    await a.query(`UPDATE "FacturaProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $1 WHERE "id" = $2`, [e.usuarioId, (primera as { id: string }).id]);
    expect((await cargar(a)).ok).toBe(true);
    expect(await cuantas()).toBe(2);
    expect(await cuantas(`"anuladaEn" IS NULL`)).toBe(1);
    // Y vigente otra vez: una tercera igual choca.
    expect(await cargar(a)).toMatchObject({ ok: false, codigo: "23505" });
  });

  it("una factura PENDIENTE de reparto RESERVA su número (D2): cargar la misma confirmada choca, y al revés", async () => {
    const a = await conexion();
    expect((await cargar(a, { estado: "PENDIENTE_DE_REPARTO" })).ok).toBe(true);
    expect(await cargar(a, { estado: "CONFIRMADA" })).toMatchObject({ ok: false, codigo: "23505", restriccion: "FacturaProveedor_unica_vigente_key" });
    expect(await cargar(a, { estado: "PENDIENTE_DE_REPARTO" })).toMatchObject({ ok: false, codigo: "23505" });
    expect(await cuantas()).toBe(1);
  });

  it("anular una pendiente libera su número", async () => {
    const a = await conexion();
    const pendiente = await cargar(a, { estado: "PENDIENTE_DE_REPARTO" });
    await a.query(`UPDATE "FacturaProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $1 WHERE "id" = $2`, [e.usuarioId, (pendiente as { id: string }).id]);
    expect((await cargar(a)).ok).toBe(true);
  });

  it("otro proveedor de la MISMA empresa puede tener el mismo número", async () => {
    const otro = await prismaAdmin.proveedor.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, codigo: "PRV_2", nombre: "Otro proveedor" } });
    const a = await conexion();
    expect((await cargar(a)).ok).toBe(true);
    expect((await cargar(a, { proveedorId: otro.id })).ok).toBe(true);
    expect(await cuantas()).toBe(2);
  });

  it("otro número del mismo proveedor puede convivir", async () => {
    const a = await conexion();
    expect((await cargar(a, { nro: "0001-00000001" })).ok).toBe(true);
    expect((await cargar(a, { nro: "0001-00000002" })).ok).toBe(true);
  });

  it("OTRA EMPRESA no choca con el mismo número (el índice incluye la empresa) y cada una ve solo lo suyo", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const propia = await conexion();
    const deLaOtra = await conexion(EMPRESA_TESTIGO_ID);
    const [r1, r2] = await Promise.all([cargar(propia), cargar(deLaOtra, { proveedorId: ajeno.proveedor.id })]);
    expect([r1.ok, r2.ok]).toEqual([true, true]);
    expect((await propia.query(`SELECT count(*)::int AS n FROM "FacturaProveedor"`)).rows[0].n).toBe(1);
    expect((await deLaOtra.query(`SELECT count(*)::int AS n FROM "FacturaProveedor"`)).rows[0].n).toBe(2);
  });

  it("sin número no hay nada que reservar: varias facturas sin número conviven", async () => {
    const a = await conexion();
    for (let i = 0; i < 3; i++) expect((await cargar(a, { nro: null })).ok).toBe(true);
    expect(await cuantas()).toBe(3);
  });
});

describe("la letra entra en la clave de unicidad cuando se conoce (D5)", () => {
  it("el mismo número con letras distintas conviven; con la misma letra choca", async () => {
    const a = await conexion();
    expect((await cargar(a, { letra: "A" })).ok).toBe(true);
    expect((await cargar(a, { letra: "B" })).ok).toBe(true);
    expect(await cargar(a, { letra: "A" })).toMatchObject({ ok: false, codigo: "23505", restriccion: "FacturaProveedor_unica_vigente_key" });
    expect(await cuantas()).toBe(2);
  });

  it("dos facturas con la letra DESCONOCIDA y el mismo número chocan entre sí (NULL no escapa de la unicidad)", async () => {
    const a = await conexion();
    expect((await cargar(a, { letra: null })).ok).toBe(true);
    expect(await cargar(a, { letra: null })).toMatchObject({ ok: false, codigo: "23505" });
  });

  it("con la letra conocida frente a una sin letra NO chocan en la base: ese caso lo cubre el aviso de posible duplicado (C25) de la Etapa C", async () => {
    const a = await conexion();
    expect((await cargar(a, { letra: null })).ok).toBe(true);
    expect((await cargar(a, { letra: "A" })).ok).toBe(true);
  });
});

describe("idempotencia: la misma clave no duplica la carga", () => {
  it("dos cargas simultáneas con la MISMA clave de idempotencia (y distinto número): gana una, la otra recibe 23505 sobre la clave", async () => {
    const [a, b] = await Promise.all([conexion(), conexion()]);
    const clave = randomUUID();
    const resultados = await Promise.all([cargar(a, { clave, nro: "0001-00000001" }), cargar(b, { clave, nro: "0001-00000002" })]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, codigo: "23505", restriccion: "FacturaProveedor_claveIdempotencia_key" });
    expect(await cuantas()).toBe(1);
  });

  it("reintentar la misma carga (misma clave) después de confirmada no escribe otra: la cuenta sigue en 1", async () => {
    const a = await conexion();
    const clave = randomUUID();
    expect((await cargar(a, { clave })).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect(await cargar(a, { clave })).toMatchObject({ ok: false, codigo: "23505" });
    expect(await cuantas()).toBe(1);
  });

  it("cargas con claves distintas y sin número no se pisan", async () => {
    const a = await conexion();
    expect((await cargar(a, { clave: randomUUID(), nro: null })).ok).toBe(true);
    expect((await cargar(a, { clave: randomUUID(), nro: null })).ok).toBe(true);
  });
});

describe("las partes: una sola por (factura, sucursal) y una sola factura por operación, también a la vez", () => {
  it("dos inserciones simultáneas de la misma parte: una pasa y la otra recibe 23505", async () => {
    const admin = await conexion();
    const f = await cargar(admin);
    const facturaProveedorId = (f as { id: string }).id;
    const [a, b] = await Promise.all([conexion(), conexion()]);
    const parte = async (c: Client) => {
      try {
        await c.query("BEGIN");
        await c.query(`INSERT INTO "FacturaProveedorSucursal" ("id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp") VALUES ($1,$2,$3,10000)`, [randomUUID(), facturaProveedorId, e.sucursalA]);
        await c.query("COMMIT");
        return "ok";
      } catch (error) {
        await c.query("ROLLBACK").catch(() => undefined);
        return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
      }
    };
    const resultados = await Promise.all([parte(a), parte(b)]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "23505|FacturaProveedorSucursal_facturaProveedorId_sucursalId_key")).toHaveLength(1);
  });

  it("dos facturas distintas que reclaman la misma Operacion a la vez: una pasa y la otra recibe 23505", async () => {
    const admin = await conexion();
    const f1 = (await cargar(admin, { nro: "0001-00000001" })) as { id: string };
    const f2 = (await cargar(admin, { nro: "0001-00000002" })) as { id: string };
    const op = await prismaAdmin.operacion.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, sucursalId: e.sucursalA, fecha: new Date(), usuarioId: e.usuarioId, proceso: "COMPRA" } });
    const [a, b] = await Promise.all([conexion(), conexion()]);
    const reclamar = async (c: Client, facturaProveedorId: string) => {
      try {
        await c.query("BEGIN");
        await c.query(`INSERT INTO "FacturaProveedorSucursal" ("id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp","operacionId") VALUES ($1,$2,$3,10000,$4)`, [randomUUID(), facturaProveedorId, e.sucursalA, op.id]);
        await c.query("COMMIT");
        return "ok";
      } catch (error) {
        await c.query("ROLLBACK").catch(() => undefined);
        return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
      }
    };
    const resultados = await Promise.all([reclamar(a, f1.id), reclamar(b, f2.id)]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "23505|FacturaProveedorSucursal_empresaId_operacionId_key")).toHaveLength(1);
  });
});
