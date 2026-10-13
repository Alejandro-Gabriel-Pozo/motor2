import { describe, expect, it } from "vitest";
import { textoRobotsDeCarta, xmlSitemapDeCarta } from "@/core/carta/robots-sitemap";

describe("textoRobotsDeCarta", () => {
  it("permite todo y anuncia el sitemap del host público", () => {
    expect(textoRobotsDeCarta("https://hotel.carta.ejemplo.com.ar")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://hotel.carta.ejemplo.com.ar/sitemap.xml\n");
  });
  it("sin dominio de cartas pide no rastrear nada", () => {
    expect(textoRobotsDeCarta(null)).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("xmlSitemapDeCarta", () => {
  it("lista el portal y cada sucursal con URL absolutas del host público", () => {
    const xml = xmlSitemapDeCarta("https://hotel.carta.ejemplo.com.ar", ["centro", "costa"]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
      "https://hotel.carta.ejemplo.com.ar/",
      "https://hotel.carta.ejemplo.com.ar/centro",
      "https://hotel.carta.ejemplo.com.ar/costa",
    ]);
  });
  it("escapa los caracteres que XML no admite", () => {
    expect(xmlSitemapDeCarta("https://x.test", ["a&b"])).toContain("<loc>https://x.test/a&amp;b</loc>");
  });
});
