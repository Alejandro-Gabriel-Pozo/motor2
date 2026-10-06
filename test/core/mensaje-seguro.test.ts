import { describe, expect, it } from "vitest";
import { mensajeSeguro } from "../../src/lib/mensaje-seguro";

describe("mensajeSeguro (S-16): lo que va a los registros del servidor no lleva datos personales ni de negocio", () => {
  it("un error de Prisma se reduce a su código: la consulta con sus argumentos no sale", () => {
    const e = new Error('Invalid `prisma.user.create()` invocation:\nUnique constraint failed on the fields: (`email`) email: "ana@correo.com" P2002');
    e.name = "PrismaClientKnownRequestError";
    expect(mensajeSeguro(e)).toBe("Error de base de datos P2002 (mensaje omitido)");
  });

  it("un error de Prisma se reconoce también por la forma del mensaje, sin depender del nombre de la clase", () => {
    expect(mensajeSeguro(new Error("Invalid `prisma.cuenta.update()` invocation: where: { id: 'x' }"))).toBe("Error de base de datos (mensaje omitido)");
  });

  it("tapa emails y tokens de cualquier otro mensaje", () => {
    const token = "a".repeat(40);
    const texto = mensajeSeguro(new Error(`falló para ana@correo.com con ${token} y Bearer abcdefgh12345678`));
    expect(texto).toBe("falló para [email] con [token] y Bearer [token]");
  });

  it("acepta cualquier cosa que se lance, no solo Error", () => {
    expect(mensajeSeguro(null)).toBe("null");
    expect(mensajeSeguro("texto suelto de ana@correo.com")).toBe("texto suelto de [email]");
  });
});
