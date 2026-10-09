// Monta la app en un solo HTML: shell + CSS + geografía (IGN, Natural Earth) + demo + módulos.
//   --target web     → apps/web/dist/index.html (web pública; añade platform/web.js)
//   --target claude  → apps/web/dist/claude.html (artifact de Claude; usa window.claude)
//   --target mcpapp  → apps/web/dist/mcp-app.html (la app dentro de Claude como MCP App; la sirve el conector)
//   --check          → además comprueba la sintaxis del JS resultante
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const target = args[args.indexOf('--target') + 1] || 'web';
const read = p => readFileSync(p, 'utf8');
const pkg = name => dirname(require.resolve(`${name}/package.json`));

const src = join(here, 'src');
const modules = readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
// Versión visible (Ajustes) y en la vista de Claude: el commit y la hora del build.
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; } })();
const VERSION = { commit, fecha: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
const parts = [
  `const APP_VERSION = ${JSON.stringify(VERSION)};`,
  read(join(pkg('topojson-client'), 'dist/topojson-client.min.js')),
  `const TOPO_ES = ${read(join(pkg('es-atlas'), 'es/municipalities.json'))};`,
  `const TOPO_WORLD = ${read(join(pkg('world-atlas'), 'countries-110m.json'))};`,
  `const DEMO = ${read(join(src, 'demo.json'))};`,
  ...(target === 'web' ? [read(join(here, 'platform/web.js'))] : target === 'mcpapp' ? [read(join(here, 'platform/mcpapp.js'))] : []),
  ...modules.map(f => `/* ==== ${f} ==== */\n` + read(join(src, f))),
];
const js = parts.join('\n');
if (args.includes('--check')) new vm.Script(js, { filename: 'app.js' });
// En Claude (mcpapp) el HTML va casi vacío y el código se carga de la web: lo que Claude
// descarga es pequeño (el móvil no carga pantallas de más de ~2 MB) y cada despliegue se ve al
// momento. __ORIGEN__ lo rellena el Worker de la web con su dirección.
const shell = read(join(src, 'shell.html')).replace('/*CSS*/', () => read(join(src, 'app.css')));
const html = target === 'mcpapp'
  ? shell.replace(/<script>\s*\/\*JS\*\/\s*<\/script>/, `<script src="__ORIGEN__/mcp-app.js?v=${commit}"></script>`)
  : shell.replace('/*JS*/', () => js.replaceAll('</script', '<\\/script'));
// En Claude el runtime pone el esqueleto (doctype, charset, viewport); en la web lo ponemos aquí, con la PWA.
const page = target === 'web'
  ? `<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n` + html.replace(/<title>[^<]*<\/title>/, '<title>myCoach</title>') + `\n<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});</script>\n`
  : target === 'mcpapp'
    // Documento completo (la vista es un iframe aislado), sin PWA: no hay service worker ni manifest.
    ? `<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` + html.replace(/<title>[^<]*<\/title>/, '<title>myCoach</title>') + `\n<style>#proto-fab,#task{display:none!important}</style>\n`
    : html;
mkdirSync(join(here, 'dist'), { recursive: true });
if (target === 'web') cpSync(join(here, 'public'), join(here, 'dist'), { recursive: true });
const out = join(here, 'dist', { web: 'index.html', mcpapp: 'mcp-app.html' }[target] || 'claude.html');
writeFileSync(out, page);
if (target === 'mcpapp') writeFileSync(join(here, 'dist', 'mcp-app.js'), js);
console.log(`${out} · ${(page.length / 1e6).toFixed(2)} MB · ${modules.length} módulos · versión ${commit}`);
