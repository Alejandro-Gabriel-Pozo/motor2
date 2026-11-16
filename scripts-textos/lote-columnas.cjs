// Reemplaza literales de rótulos de columna (propiedad etiqueta/encabezado/label/texto/titulo) por textoDe("columna.<tema>") en src/app/(app)/reportes.
// Uso: node lote-columnas.cjs <raiz-del-repo> <aplicar|medir> <salida.json> "Valor=clave,Valor2=clave2"
const ts = require(process.argv[2] + "/node_modules/typescript");
const fs = require("fs"), path = require("path");
const RAIZ = process.argv[2], APLICAR = process.argv[3] === "aplicar", SALIDA = process.argv[4];
const VALORES = Object.fromEntries(process.argv[5].split(",").map((p) => { const i = p.lastIndexOf("="); return [p.slice(0, i), p.slice(i + 1)]; }));
const CLAVES = new Set(["etiqueta", "encabezado", "label", "texto", "titulo"]);
const lista = (d, out = []) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) lista(p, out); else if (/\.tsx?$/.test(n)) out.push(p); } return out; };
const base = path.join(RAIZ, "src/app/(app)/reportes");
const hallazgos = [];
for (const f of lista(base)) {
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const topNombre = (n) => { let x = n; while (x.parent && x.parent.kind !== ts.SyntaxKind.SourceFile) x = x.parent; if (ts.isFunctionDeclaration(x) && x.name) return x.name.text; if (ts.isVariableStatement(x)) { const d = x.declarationList.declarations[0]; if (ts.isIdentifier(d.name)) return d.name.text; } return null; };
  const v = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && CLAVES.has(n.name.text) && ts.isStringLiteral(n.initializer) && n.initializer.text in VALORES) {
      const clave = "columna." + VALORES[n.initializer.text];
      edits.push([n.initializer.getStart(sf), n.initializer.end, `textoDe("${clave}")`]);
      hallazgos.push({ rel: path.relative(RAIZ, f), clave, valor: n.initializer.text, uso: topNombre(n), prop: n.name.text });
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  if (APLICAR && edits.length) {
    let out = src;
    for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + t + out.slice(b);
    const lineas = out.split("\n");
    let ultimo = -1, dentro = false;
    lineas.forEach((l, i) => { if (/^import\b/.test(l)) { dentro = !/from\s+["'].*["'];?\s*$|^import\s+["']/.test(l); ultimo = i; } else if (dentro) { ultimo = i; if (/from\s+["'].*["'];?\s*$/.test(l)) dentro = false; } });
    lineas.splice(ultimo + 1, 0, 'import { textoDe } from "@/core/textos/texto-de";');
    fs.writeFileSync(f, lineas.join("\n"));
  }
}
fs.writeFileSync(SALIDA, JSON.stringify(hallazgos));
const porClave = {}; for (const h of hallazgos) porClave[h.clave] = (porClave[h.clave] || 0) + 1;
console.log(hallazgos.length, JSON.stringify(porClave), new Set(hallazgos.map((h) => h.rel)).size);
