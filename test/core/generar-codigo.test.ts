import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { crearConCodigoAutogenerado } from "../../src/core/catalogo/generar-codigo";
import { azarDelProceso } from "../../src/lib/azar";

// No necesita Postgres: `intentar` simula el comportamiento de un UNIQUE
// constraint con un Set en memoria.

function errorDeColision() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("crearConCodigoAutogenerado", () => {
  it("usa el código manual tal cual, sin reintentar", async () => {
    const resultado = await crearConCodigoAutogenerado("MP", "MP_manual", async (codigo) => codigo, azarDelProceso);
    expect(resultado).toBe("MP_manual");
  });

  it("propaga el error si el código manual choca (nunca reintenta uno manual)", async () => {
    let llamadas = 0;
    await expect(
      crearConCodigoAutogenerado("MP", "MP_repetido", async () => {
        llamadas++;
        throw errorDeColision();
      }, azarDelProceso)
    ).rejects.toThrow();
    expect(llamadas).toBe(1);
  });

  it("reintenta con un código nuevo si el autogenerado choca, hasta lograr uno libre", async () => {
    const ocupados = new Set(["AAA111"]);
    // La fuente de azar se INYECTA (Pureza 1.5): ya no hace falta espiar `crypto.randomUUID`.
    const uuids = ["aaa111-0000-0000-0000-000000000000", "bbb222-0000-0000-0000-000000000000"];
    const azar = { ...azarDelProceso, uuid: () => uuids.shift() ?? "ccc333-0000-0000-0000-000000000000" };

    const resultado = await crearConCodigoAutogenerado("MP", undefined, async (codigo) => {
      const sufijo = codigo.replace("MP_", "").toUpperCase();
      if (ocupados.has(sufijo)) throw errorDeColision();
      return codigo;
    }, azar);

    expect(resultado).toBe("MP_bbb222");
  });

  it("O.48: también reintenta si el choque llega con la forma cruda del adaptador (DriverAdapterError / UniqueConstraintViolation), y no reintenta otro error del driver", async () => {
    const deDriver = (kind: string) => Object.assign(new Error("driver"), { name: "DriverAdapterError", cause: { kind } });
    let llamadas = 0;
    const resultado = await crearConCodigoAutogenerado("MP", undefined, async (codigo) => {
      llamadas++;
      if (llamadas === 1) throw deDriver("UniqueConstraintViolation");
      return codigo;
    }, azarDelProceso);
    expect(llamadas).toBe(2);
    expect(resultado).toMatch(/^MP_/);

    llamadas = 0;
    await expect(
      crearConCodigoAutogenerado("MP", undefined, async () => {
        llamadas++;
        throw deDriver("ConnectionClosed");
      }, azarDelProceso)
    ).rejects.toThrow("driver");
    expect(llamadas).toBe(1);
  });
});
