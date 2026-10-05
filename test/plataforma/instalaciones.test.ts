import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ROL_DE_PLATAFORMA, instalacionPorId, leerInstalaciones, variableDeConexionDe } from "../../plataforma/src/entorno";
import { migracionesAplicadas } from "../../plataforma/src/servidor/migraciones";
import { crearRegistroDeClientes } from "../../plataforma/src/registro-de-clientes";
import { rutaDeAlta, rutaDeEmpresa, rutaDeEmpresas, rutaDeInstalacion } from "../../plataforma/src/rutas";
import { dependenciasParaInstalacion } from "../../plataforma/src/servidor/dependencias";
import { marcarAtrasos, resumenDeInstalaciones } from "../../plataforma/src/servidor/resumen";
import { conTiempoLimite } from "../../plataforma/src/servidor/tiempo-limite";

/**
 * Una consola, varias instalaciones (ADR-025). La configuración falla cerrada y sus mensajes nombran la variable, nunca el valor; el registro de clientes, las dependencias por
 * instalación y el resumen del inicio son puros y se prueban sin base.
 */
const url = (host: string, bd = "neondb", usuario = ROL_DE_PLATAFORMA, clave = "clave-secreta-uno") => `postgresql://${usuario}:${clave}@${host}:5432/${bd}?sslmode=require`;
const BASE = {
  PLATAFORMA_DATABASE_URL: url("ep-principal.c-6.us-east-2.aws.neon.tech"),
  PLATAFORMA_SECRETO_CODIGOS: "x".repeat(32),
  PLATAFORMA_CLAVE_TOTP: randomBytes(32).toString("base64"),
  PLATAFORMA_URL_APP: "https://zuluhub.ejemplo.test",
};
const ADICIONAL = [{ id: "stockhneuquen", nombre: "Stock Neuquén", urlApp: "https://stock.ejemplo.test" }];
const CON_ADICIONAL = {
  ...BASE,
  PLATAFORMA_INSTALACION_ID: "zuluhub",
  PLATAFORMA_INSTALACION_NOMBRE: "Zuluhub",
  PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify(ADICIONAL),
  PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-stock.c-2.us-west-2.aws.neon.tech", "neondb", ROL_DE_PLATAFORMA, "clave-secreta-dos"),
};

function mensaje(entorno: Record<string, string | undefined>): string {
  try {
    leerInstalaciones(entorno);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("se esperaba un entorno inválido");
}

describe("leerInstalaciones", () => {
  it("el entorno de siempre, sin variables nuevas, da UNA instalación: la principal", () => {
    expect(leerInstalaciones(BASE)).toEqual([{ id: "principal", nombre: "principal", databaseUrl: BASE.PLATAFORMA_DATABASE_URL, urlApp: BASE.PLATAFORMA_URL_APP, principal: true }]);
  });

  it("con una adicional: la principal primero, con su id y nombre, y la adicional con su propia conexión y su propia dirección de app", () => {
    const [principal, stock] = leerInstalaciones(CON_ADICIONAL);
    expect(principal).toMatchObject({ id: "zuluhub", nombre: "Zuluhub", principal: true, urlApp: "https://zuluhub.ejemplo.test" });
    expect(stock).toMatchObject({ id: "stockhneuquen", nombre: "Stock Neuquén", principal: false, urlApp: "https://stock.ejemplo.test", databaseUrl: CON_ADICIONAL.PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN });
  });

  it("el nombre de la variable de conexión sale del id en mayúsculas", () => {
    expect(variableDeConexionDe("stockhneuquen")).toBe("PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN");
  });

  it("un JSON inválido da un mensaje que nombra la variable y NO repite el texto", () => {
    const m = mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: "{esto-secreto-no-es-json" });
    expect(m).toContain("PLATAFORMA_INSTALACIONES_ADICIONALES");
    expect(m).not.toContain("esto-secreto");
  });

  it("el JSON no admite campos de más: una clave de conexión pegada ahí se rechaza sin repetirse", () => {
    const m = mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ ...ADICIONAL[0], databaseUrl: url("ep-x.neon.tech", "neondb", ROL_DE_PLATAFORMA, "clave-filtrable") }]) });
    expect(m).toContain("PLATAFORMA_INSTALACIONES_ADICIONALES");
    expect(m).not.toContain("clave-filtrable");
  });

  it.each([["con mayúsculas", "Stock"], ["con guion", "stock-neuquen"], ["demasiado corto", "s"], ["empieza con dígito", "1stock"], ["vacío", ""]])("rechaza un id %s", (_n, id) => {
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ ...ADICIONAL[0], id }]) })).toContain("PLATAFORMA_INSTALACIONES_ADICIONALES");
  });

  it("rechaza un id repetido o igual al de la principal", () => {
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ ...ADICIONAL[0], id: "zuluhub" }]), PLATAFORMA_DATABASE_URL_ZULUHUB: CON_ADICIONAL.PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN })).toContain("ids repetidos");
  });

  it("si falta la conexión de una adicional, el mensaje nombra la variable que falta", () => {
    const sin = { ...CON_ADICIONAL, PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: undefined };
    expect(mensaje(sin)).toContain("PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN");
  });

  it("rechaza una conexión adicional que no es del rol de plataforma, sin repetir la clave", () => {
    const m = mensaje({ ...CON_ADICIONAL, PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-stock.c-2.us-west-2.aws.neon.tech", "neondb", "motor2", "clave-del-duenio") });
    expect(m).toContain("PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN");
    expect(m).toContain(ROL_DE_PLATAFORMA);
    expect(m).not.toContain("clave-del-duenio");
  });

  it("rechaza dos instalaciones que apuntan a la misma base, aunque una use el pooler de Neon", () => {
    // Mutación: sacar la normalización del `-pooler` (o el control de bases repetidas) pone este test en rojo.
    const igual = { ...CON_ADICIONAL, PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-principal-pooler.c-6.us-east-2.aws.neon.tech") };
    expect(mensaje(igual)).toContain("misma base");
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: BASE.PLATAFORMA_DATABASE_URL })).toContain("misma base");
  });

  it("dos bases distintas en el mismo servidor (otro nombre de base) son válidas", () => {
    expect(leerInstalaciones({ ...CON_ADICIONAL, PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-principal.c-6.us-east-2.aws.neon.tech", "otra_base") })).toHaveLength(2);
  });

  it("rechaza direcciones de app repetidas o inválidas", () => {
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ ...ADICIONAL[0], urlApp: "https://zuluhub.ejemplo.test/" }]) })).toContain("direcciones de app repetidas");
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ ...ADICIONAL[0], urlApp: "http://stock.ejemplo.test" }]) })).toContain("PLATAFORMA_INSTALACIONES_ADICIONALES");
  });

  it("admite como mucho 10 instalaciones", () => {
    const muchas = Array.from({ length: 10 }, (_, n) => ({ id: `inst${n}`, nombre: `I${n}`, urlApp: `https://i${n}.ejemplo.test` }));
    expect(mensaje({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify(muchas) })).toContain("PLATAFORMA_INSTALACIONES_ADICIONALES");
  });

  it("un id de instalación principal inválido se rechaza nombrando la variable", () => {
    expect(mensaje({ ...BASE, PLATAFORMA_INSTALACION_ID: "Zulu-Hub" })).toContain("PLATAFORMA_INSTALACION_ID");
  });
});

describe("instalacionPorId", () => {
  const lista = leerInstalaciones(CON_ADICIONAL);

  it("devuelve la coincidencia EXACTA", () => {
    expect(instalacionPorId(lista, "stockhneuquen")?.nombre).toBe("Stock Neuquén");
    expect(instalacionPorId(lista, "zuluhub")?.principal).toBe(true);
  });

  it("un id desconocido NO cae en la principal: es null (dos instalaciones pueden tener una empresa con el mismo id)", () => {
    // Mutación: `?? lista[0]` pone este test en rojo.
    for (const id of ["noexiste", "", "ZULUHUB", "principal", "__proto__", "constructor", "toString"]) expect(instalacionPorId(lista, id), id).toBeNull();
  });
});

describe("dependenciasParaInstalacion", () => {
  it("la dirección de la app es la de ESA instalación (a ella apuntan los enlaces de los mails)", () => {
    // Mutación: usar la dirección de la principal pone este test en rojo.
    const [zulu, stock] = leerInstalaciones(CON_ADICIONAL);
    const externos = { emailsDeAdmins: async () => ["admin@x.com"], enviar: async () => ({ ok: true as const, idExterno: null }) };
    expect(dependenciasParaInstalacion(zulu, externos).urlApp).toBe("https://zuluhub.ejemplo.test");
    expect(dependenciasParaInstalacion(stock, externos).urlApp).toBe("https://stock.ejemplo.test");
  });
});

describe("registro de clientes por instalación", () => {
  it("el mismo id y la misma URL dan el mismo cliente; otra instalación, otro cliente con SU URL", () => {
    // Mutación: usar siempre la URL principal pone este test en rojo.
    const fabrica = vi.fn((u: string) => ({ u }));
    const registro = crearRegistroDeClientes(fabrica);
    const a = registro.obtener("zuluhub", "url-a");
    expect(registro.obtener("zuluhub", "url-a")).toBe(a);
    expect(registro.obtener("stock", "url-b")).toEqual({ u: "url-b" });
    expect(fabrica).toHaveBeenCalledTimes(2);
  });

  it("si la URL de una instalación cambia, se crea un cliente nuevo", () => {
    const registro = crearRegistroDeClientes((u) => ({ u }));
    const viejo = registro.obtener("zuluhub", "url-vieja");
    expect(registro.obtener("zuluhub", "url-nueva")).not.toBe(viejo);
  });

  it("no crea nada hasta que se lo pide (una base caída no afecta el arranque)", () => {
    const fabrica = vi.fn((u: string) => ({ u }));
    crearRegistroDeClientes(fabrica);
    expect(fabrica).not.toHaveBeenCalled();
  });
});

describe("resumen del inicio", () => {
  const [zulu, stock] = leerInstalaciones(CON_ADICIONAL);

  it("una base que falla o no responde no afecta a las demás: solo su tarjeta dice «caída»", async () => {
    const r = await resumenDeInstalaciones([zulu, stock], async (i) => {
      if (i.id === "stockhneuquen") throw new Error("la base no responde");
      return { pendientes: 3, migraciones: null };
    });
    expect(r).toEqual([{ instalacion: zulu, estado: "ok", pendientes: 3, atraso: null }, { instalacion: stock, estado: "caida" }]);
  });

  it("una base que NO responde nunca se da por caída recién al tope de tiempo, sin colgar el inicio", async () => {
    // Mutación: sacar el tope (conTiempoLimite) cuelga este test.
    const colgada = new Promise<{ pendientes: number; migraciones: null }>(() => {});
    const r = await resumenDeInstalaciones([zulu, stock], async (i) => (i.id === "stockhneuquen" ? colgada : { pendientes: 1, migraciones: null }), 30);
    expect(r.map((x) => x.estado)).toEqual(["ok", "caida"]);
  });

  it("conTiempoLimite deja pasar lo que termina a tiempo y rechaza lo que no", async () => {
    await expect(conTiempoLimite(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(conTiempoLimite(new Promise<number>(() => {}), 10)).rejects.toThrow("tiempo agotado");
  });
});

describe("marcarAtrasos (ADR-025: aviso de instalación atrasada en migraciones)", () => {
  const [zulu, stock] = leerInstalaciones(CON_ADICIONAL);
  const caida = instalacionPorId(leerInstalaciones({ ...CON_ADICIONAL, PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([...ADICIONAL, { id: "caida", nombre: "Caída", urlApp: "https://caida.ejemplo.test" }]), PLATAFORMA_DATABASE_URL_CAIDA: url("ep-caida.neon.tech") }), "caida")!;

  it("B le falta una migración que A ya tiene: queda atrasada respecto de A, con el nombre de la más nueva que falta", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: ["m1", "m2"] }, { instalacion: stock, migraciones: ["m1"] }]);
    expect(r.get(zulu.id)).toBeNull();
    expect(r.get(stock.id)).toEqual({ respectoDe: zulu.nombre, faltan: 1, masNueva: "m2" });
  });

  it("las mismas migraciones en las dos: ninguna atrasada", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: ["m1", "m2"] }, { instalacion: stock, migraciones: ["m1", "m2"] }]);
    expect(r.get(zulu.id)).toBeNull();
    expect(r.get(stock.id)).toBeNull();
  });

  it("divergencia (cada una tiene algo que la otra no): a cada una se le informa lo que le falta", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: ["m1", "m2"] }, { instalacion: stock, migraciones: ["m1", "m3"] }]);
    expect(r.get(zulu.id)).toEqual({ respectoDe: stock.nombre, faltan: 1, masNueva: "m3" });
    expect(r.get(stock.id)).toEqual({ respectoDe: zulu.nombre, faltan: 1, masNueva: "m2" });
  });

  it("una instalación caída (sin lectura) no participa: ni de referencia, ni recibe aviso", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: ["m1", "m2"] }, { instalacion: stock, migraciones: ["m1"] }, { instalacion: caida, migraciones: null }]);
    expect(r.get(caida.id)).toBeNull();
    expect(r.get(stock.id)).toEqual({ respectoDe: zulu.nombre, faltan: 1, masNueva: "m2" });
  });

  it("sin permiso para leer (null) en TODAS: nadie queda marcado atrasado", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: null }, { instalacion: stock, migraciones: null }]);
    expect(r.get(zulu.id)).toBeNull();
    expect(r.get(stock.id)).toBeNull();
  });

  it("una sola instalación: nunca hay con qué compararla", () => {
    const r = marcarAtrasos([{ instalacion: zulu, migraciones: ["m1"] }]);
    expect(r.get(zulu.id)).toBeNull();
  });
});

describe("migracionesAplicadas (ADR-025)", () => {
  const prismaFalso = (ejecutar: () => Promise<Array<{ migration_name: string }>>) => ({ $queryRaw: ejecutar }) as unknown as PrismaClient;

  it("devuelve los nombres de las migraciones aplicadas, ordenados", async () => {
    const db = prismaFalso(async () => [{ migration_name: "m1" }, { migration_name: "m2" }]);
    await expect(migracionesAplicadas(db)).resolves.toEqual(["m1", "m2"]);
  });

  it("sin el GRANT todavía (42501) o sin la tabla (42P01), no lanza: devuelve null", async () => {
    const sinPermiso = prismaFalso(async () => {
      throw new Error("Raw query failed. Code: `42501`. Message: permission denied for table _prisma_migrations");
    });
    await expect(migracionesAplicadas(sinPermiso)).resolves.toBeNull();

    const sinTabla = prismaFalso(async () => {
      throw new Error('Raw query failed. Code: `42P01`. Message: relation "_prisma_migrations" does not exist');
    });
    await expect(migracionesAplicadas(sinTabla)).resolves.toBeNull();
  });

  it("cualquier otro error se propaga (no se traga en silencio)", async () => {
    // Mutación: atrapar CUALQUIER error (sin mirar el código) pone este test en rojo.
    const otraFalla = prismaFalso(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    await expect(migracionesAplicadas(otraFalla)).rejects.toThrow("connection terminated unexpectedly");
  });
});

describe("rutas", () => {
  it("la instalación va en la ruta", () => {
    expect(rutaDeInstalacion("zuluhub")).toBe("/instalaciones/zuluhub");
    expect(rutaDeEmpresas("zuluhub")).toBe("/instalaciones/zuluhub/empresas");
    expect(rutaDeEmpresas("zuluhub", "todas")).toBe("/instalaciones/zuluhub/empresas");
    expect(rutaDeEmpresas("zuluhub", "cuit-pendiente")).toBe("/instalaciones/zuluhub/empresas?filtro=cuit-pendiente");
    expect(rutaDeAlta("stockhneuquen")).toBe("/instalaciones/stockhneuquen/empresas/nueva");
    expect(rutaDeEmpresa("stockhneuquen", "abc123")).toBe("/instalaciones/stockhneuquen/empresas/abc123");
    expect(rutaDeEmpresa("stockhneuquen", "abc123", "modulos")).toBe("/instalaciones/stockhneuquen/empresas/abc123/modulos");
  });

  it("escapa lo que no es seguro en un segmento", () => {
    expect(rutaDeEmpresa("zuluhub", "a/b?c")).toBe("/instalaciones/zuluhub/empresas/a%2Fb%3Fc");
  });
});
