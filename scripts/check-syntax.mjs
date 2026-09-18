import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

let failed = false, total = 0;

for (const dir of ['app', 'components', 'hooks', 'lib'])
  walk(dir);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory())
      walk(file);
    else if (/\.tsx?$/.test(file)) {
      const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext
        }
      });
      const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
      total++;
      for (const e of errors) {
        failed = true;
        console.error(file, ts.flattenDiagnosticMessageText(e.messageText, '\n'));
      }
    }
  }
}

console.log(
  `${total} TS/TSX files checked for syntax. This does not replace npm run typecheck or npm run build.`
);

if (failed)
  process.exit(1);
