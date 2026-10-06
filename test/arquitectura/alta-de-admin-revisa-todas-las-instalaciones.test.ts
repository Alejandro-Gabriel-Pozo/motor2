import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El alta del primer administrador de plataforma (`scripts/plataforma/crear-primer-admin.ts`) tiene que revisar TODAS las instalaciones configuradas,
 * no solo la principal (ADR-025): si un refactor futuro desconecta ese control, los tests de persistencia de `crearAdminDePlataforma` no se darían
 * cuenta (pasarían igual: ellos prueban la función, no que el script la llame bien) — por eso este guardián mira el TEXTO del script.
 */
const RAIZ = join(__dirname, "../..");
const SCRIPT = readFileSync(join(RAIZ, "scripts/plataforma/crear-primer-admin.ts"), "utf8");
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("crear-primer-admin.ts revisa todas las instalaciones (ADR-025)", () => {
  it("sanidad: el detector ve el archivo de verdad (no pasa en vacío)", () => {
    expect(SCRIPT.length).toBeGreaterThan(0);
    expect(SCRIPT).toContain("crearAdminDePlataforma(");
  });

  it("lee las instalaciones configuradas (no solo PLATAFORMA_DATABASE_URL)", () => {
    // Mutación: borrar el `import { ..., leerInstalaciones, ... }` o el `leerInstalaciones(process.env)` pone este test en rojo.
    expect(sinComentarios(SCRIPT)).toMatch(/\bleerInstalaciones\s*\(/);
  });

  it("pasa las instalaciones adicionales a crearAdminDePlataforma como otrasBases", () => {
    // Mutación: llamar a crearAdminDePlataforma sin el 4º argumento (u omitiendo otrasBases) pone este test en rojo.
    expect(sinComentarios(SCRIPT)).toMatch(/crearAdminDePlataforma\([\s\S]*?\{\s*otrasBases\s*\}[\s\S]*?\)/);
  });

  it("cierra también los clientes de las instalaciones adicionales, no solo el de la principal", () => {
    // Mutación: dejar el finally en `prisma.$disconnect()` solo pone este test en rojo.
    expect(sinComentarios(SCRIPT)).toMatch(/otrasBases\.map\(\s*\(?\w+\)?\s*=>\s*\w+\.db\.\$disconnect\(\)\s*\)/);
  });

  it("no crea su propio cliente de Prisma: lo toma de cliente-plataforma.ts", () => {
    expect(sinComentarios(SCRIPT)).not.toMatch(/new\s+(PrismaClient|PrismaPg|PrismaNeon)\b/);
    expect(sinComentarios(SCRIPT)).toMatch(/from\s+["']\.\.\/cliente-plataforma["']/);
  });
});
