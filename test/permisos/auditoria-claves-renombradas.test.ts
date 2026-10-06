import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { CLAVES_DE_ACCION_RENOMBRADAS, descripcionParaMostrar } from "../../src/core/permisos/auditoria";

describe("auditoría: claves de acción renombradas (boleta → ticket)", () => {
  it("una fila vieja se muestra con la clave vigente, en los dos formatos de descripción que escribe la app", () => {
    expect(descripcionParaMostrar('Permiso "reporte_boletas" del rol "Admin": ver')).toBe('Permiso "reporte_tickets" del rol "Admin": ver');
    expect(descripcionParaMostrar('Capacidad "pos_emitir_boleta_corregida" (default)')).toBe('Capacidad "pos_emitir_ticket_corregido" (default)');
  });

  it("no toca las claves vigentes ni otro texto", () => {
    const d = 'Permiso "reporte_tickets" del rol "Admin": editar';
    expect(descripcionParaMostrar(d)).toBe(d);
    expect(descripcionParaMostrar('Producto "Pan": precio de venta')).toBe('Producto "Pan": precio de venta');
  });

  it("todo destino del mapa es una acción que existe, y ningún origen existe ya", () => {
    const claves = new Set<string>(ACCIONES.map((a) => a.clave));
    for (const [vieja, nueva] of Object.entries(CLAVES_DE_ACCION_RENOMBRADAS)) {
      expect(claves.has(nueva), nueva).toBe(true);
      expect(claves.has(vieja), vieja).toBe(false);
    }
  });
});
