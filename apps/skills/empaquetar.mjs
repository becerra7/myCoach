// Empaqueta cada skill en apps/skills/dist/<nombre>.zip, listo para subir en
// claude.ai (Ajustes, Capacidades, Skills). El repo es la fuente de verdad.
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = fileURLToPath(new URL('.', import.meta.url));
const dist = `${aqui}dist`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
const skills = readdirSync(aqui, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'dist').map(d => d.name);
for (const s of skills) execFileSync('zip', ['-qr', `${dist}/${s}.zip`, s], { cwd: aqui });
console.log(`${skills.length} skills en apps/skills/dist: ${skills.join(', ')}`);
