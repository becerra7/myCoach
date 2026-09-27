// Monta la app en un solo HTML: shell + CSS + geografía (IGN, Natural Earth) + demo + módulos.
//   --target web     → apps/web/dist/index.html (web pública; añade platform/web.js)
//   --target claude  → apps/web/dist/claude.html (artifact de Claude; usa window.claude)
//   --check          → además comprueba la sintaxis del JS resultante
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const target = args[args.indexOf('--target') + 1] || 'web';
const read = p => readFileSync(p, 'utf8');
const pkg = name => dirname(require.resolve(`${name}/package.json`));

const src = join(here, 'src');
const modules = readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const parts = [
  read(join(pkg('topojson-client'), 'dist/topojson-client.min.js')),
  `const TOPO_ES = ${read(join(pkg('es-atlas'), 'es/municipalities.json'))};`,
  `const TOPO_WORLD = ${read(join(pkg('world-atlas'), 'countries-110m.json'))};`,
  `const DEMO = ${read(join(src, 'demo.json'))};`,
  ...(target === 'web' ? [read(join(here, 'platform/web.js'))] : []),
  ...modules.map(f => `/* ==== ${f} ==== */\n` + read(join(src, f))),
];
const js = parts.join('\n');
if (args.includes('--check')) new vm.Script(js, { filename: 'app.js' });
const html = read(join(src, 'shell.html')).replace('/*CSS*/', () => read(join(src, 'app.css'))).replace('/*JS*/', () => js.replaceAll('</script', '<\\/script'));
mkdirSync(join(here, 'dist'), { recursive: true });
const out = join(here, 'dist', target === 'web' ? 'index.html' : 'claude.html');
writeFileSync(out, html);
console.log(`${out} · ${(html.length / 1e6).toFixed(2)} MB · ${modules.length} módulos`);
