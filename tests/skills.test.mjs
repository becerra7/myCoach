// Las skills de Claude (apps/skills) nombran herramientas del conector. Si una
// herramienta cambia de nombre o se junta con otra, este test falla hasta que
// las skills se pongan al día: así no vuelven a quedarse atrás sin que nadie lo vea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const raiz = new URL('../apps/skills/', import.meta.url);
const skills = readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'dist').map(d => d.name);
const fuente = readFileSync(new URL('../apps/conector/worker.js', import.meta.url), 'utf8');
// Las herramientas son las claves de primer nivel de TOOLS: una tabulación, nombre y llave.
const herramientas = new Set([...fuente.matchAll(/^\t([a-z][a-z0-9_]*): \{$/gm)].map(m => m[1]));
const NOMBRE = /`((?:garmin|coach|fuerza|cardio|intervals|comida|peso|app|mycoach|entreno)_[a-z0-9_]+|entrenos|comidas)\b/g;

test('hay skills y el conector tiene herramientas', () => {
  assert.ok(skills.length >= 5, `skills: ${skills.join(', ')}`);
  assert.ok(herramientas.has('coach_hoy') && herramientas.has('garmin_dia'));
});

for (const s of skills) {
  test(`skill ${s}: SKILL.md con nombre y descripción`, () => {
    const md = new URL(`${s}/SKILL.md`, raiz);
    assert.ok(existsSync(md), 'falta SKILL.md');
    const texto = readFileSync(md, 'utf8');
    const cabecera = texto.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(cabecera, 'falta la cabecera (---)');
    assert.equal(cabecera[1].match(/^name:\s*(.+)$/m)?.[1].trim(), s, 'name tiene que ser el nombre de la carpeta');
    assert.ok((cabecera[1].match(/^description:\s*(.+)$/m)?.[1] || '').length > 40, 'falta una descripción útil');
  });
  test(`skill ${s}: solo nombra herramientas que existen`, () => {
    const texto = readFileSync(new URL(`${s}/SKILL.md`, raiz), 'utf8');
    const nombradas = [...new Set([...texto.matchAll(NOMBRE)].map(m => m[1]))];
    const faltan = nombradas.filter(n => !herramientas.has(n));
    assert.deepEqual(faltan, [], `no existen en el conector: ${faltan.join(', ')}`);
  });
}
