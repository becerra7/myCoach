#!/usr/bin/env node
/**
 * Prueba la Personal API de Garmin con tu clave: qué contesta, qué campos trae
 * y qué le falta frente a lo que usa hoy el conector. Solo hace GET (y el POST
 * del token): no escribe nada en Garmin.
 *
 * Uso:
 *   GARMIN_API_KEY=tu-clave node scripts/garmin-personal-api.mjs
 *   GARMIN_API_KEY=tu-clave node scripts/garmin-personal-api.mjs --guardar
 *   GARMIN_API_KEY=tu-clave node scripts/garmin-personal-api.mjs --connectapi
 *
 * --guardar     guarda cada respuesta en .garmin-personal/ (ignorada por git).
 * --connectapi  prueba también el token contra connectapi.garmin.com, el host
 *               no oficial que usa hoy el conector. Es solo para saber si
 *               funciona: Garmin no lo ofrece así y puede no permitirlo.
 *
 * El informe (garmin-personal-api-informe.md en .garmin-personal/) solo lleva
 * códigos HTTP, tamaños y nombres de campos, nunca valores: se puede compartir.
 */
import fs from "node:fs";
import path from "node:path";

const CLAVE = process.env.GARMIN_API_KEY?.trim();
const GUARDAR = process.argv.includes("--guardar");
const CONNECTAPI = process.argv.includes("--connectapi");
const BASE = "https://personal.connectapi.garmin.com";
const NO_OFICIAL = "https://connectapi.garmin.com";
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
const SALIDA = path.resolve(".garmin-personal");

// Campos que dicen si un dato que usa el método está o no.
const INTERESANTES =
	/vo2|trainingload|trainingeffect|readiness|recovery|ftp|threshold|lactate|hrv|bodybattery|sleepscore|overallscore|stress|restingheart|endurance|hillscore|acwr|loadfocus|loadbalance|exercisesets|weight|fitnessage/i;

if (!CLAVE) {
	console.error(
		"Falta la clave. Créala en https://connect.garmin.com/app/settings/personalApiToken (30 días basta) y lanza:\n" +
			"  GARMIN_API_KEY=tu-clave node scripts/garmin-personal-api.mjs",
	);
	process.exit(1);
}

// Fechas en hora de Madrid, que es la del usuario.
const fecha = (diasAtras = 0) =>
	new Date(Date.now() - diasAtras * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
const hoy = fecha(0);
const ayer = fecha(1);
const hace = (n) => fecha(n);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nombres de campo (con su ruta) que encajan con INTERESANTES, sin valores. */
function camposInteresantes(dato, prefijo = "", vistos = new Set(), prof = 0) {
	if (!dato || typeof dato !== "object" || prof > 6) return vistos;
	if (Array.isArray(dato)) return dato.length ? camposInteresantes(dato[0], `${prefijo}[]`, vistos, prof + 1) : vistos;
	for (const [k, v] of Object.entries(dato)) {
		const ruta = prefijo ? `${prefijo}.${k}` : k;
		if (INTERESANTES.test(k) && v !== null && v !== undefined) vistos.add(ruta);
		camposInteresantes(v, ruta, vistos, prof + 1);
	}
	return vistos;
}

/** Resumen de la forma de una respuesta: tipo, longitud y campos de primer nivel. */
function forma(dato) {
	if (Array.isArray(dato)) return `lista de ${dato.length}${dato.length && typeof dato[0] === "object" ? `: ${Object.keys(dato[0]).slice(0, 12).join(", ")}` : ""}`;
	if (dato && typeof dato === "object") return Object.keys(dato).slice(0, 14).join(", ");
	return typeof dato;
}

let token = null;
const filas = [];
const cabecerasLimite = new Set();

async function pedir(grupo, host, ruta, params, { binario = false, nota = "" } = {}) {
	const url = `${host}${ruta}${params ? `?${new URLSearchParams(params)}` : ""}`;
	let res, error;
	const t0 = Date.now();
	try {
		res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: binario ? "*/*" : "application/json" } });
	} catch (e) {
		error = e.message;
	}
	const ms = Date.now() - t0;
	const fila = { grupo, host: host === BASE ? "personal" : "connectapi", ruta, params, ms, nota };
	if (!res) {
		filas.push({ ...fila, http: "red", detalle: error });
		return null;
	}
	for (const [k] of res.headers) if (/ratelimit|retry-after|quota/i.test(k)) cabecerasLimite.add(`${k}: ${res.headers.get(k)}`);
	fila.http = res.status;
	let dato = null;
	if (binario) {
		const buf = Buffer.from(await res.arrayBuffer());
		const tipo = buf.subarray(0, 2).toString() === "PK" ? "zip" : buf.subarray(8, 12).toString() === ".FIT" ? "fit" : res.headers.get("content-type");
		fila.detalle = res.ok ? `${buf.length} bytes (${tipo})` : buf.toString("utf8").slice(0, 160);
		if (GUARDAR && res.ok) guardar(`${grupo}-${ruta}`, buf, tipo === "zip" ? ".zip" : ".fit");
		dato = res.ok ? buf : null;
	} else {
		const texto = await res.text();
		fila.bytes = texto.length;
		if (res.ok && texto) {
			try {
				dato = JSON.parse(texto);
				fila.detalle = forma(dato);
				fila.campos = [...camposInteresantes(dato)].slice(0, 25);
				if (GUARDAR) guardar(`${fila.host}-${ruta}`, JSON.stringify(dato, null, 2), ".json");
			} catch {
				fila.detalle = `no es JSON: ${texto.slice(0, 120)}`;
			}
		} else {
			fila.detalle = res.ok ? "vacío (sin datos ese día)" : texto.slice(0, 160).replace(/\s+/g, " ");
		}
	}
	filas.push(fila);
	console.log(`${String(fila.http).padEnd(4)} ${fila.host.padEnd(10)} ${ruta}`);
	// Sin prisa: Garmin no publica límites y no queremos que nos corten la clave.
	await espera(400);
	return dato;
}

function guardar(nombre, contenido, ext) {
	fs.mkdirSync(SALIDA, { recursive: true });
	const archivo = path.join(SALIDA, nombre.replace(/[^a-z0-9]+/gi, "_").slice(0, 120) + ext);
	fs.writeFileSync(archivo, contenido);
}

// 1. Token
const resToken = await fetch(TOKEN_URL, { method: "POST", headers: { Authorization: `ApiKey ${CLAVE}`, Accept: "application/json" } });
const textoToken = await resToken.text();
if (!resToken.ok) {
	console.error(`El token no sale: HTTP ${resToken.status}. ${textoToken.slice(0, 300)}`);
	process.exit(1);
}
const jsonToken = JSON.parse(textoToken);
token = jsonToken.access_token || jsonToken.accessToken || jsonToken.token;
if (!token) {
	console.error(`El token ha llegado con campos que no conozco: ${Object.keys(jsonToken).join(", ")}`);
	process.exit(1);
}
const infoToken = Object.entries(jsonToken)
	.filter(([k]) => !/token/i.test(k) || /type|expire/i.test(k))
	.map(([k, v]) => `${k}=${v}`)
	.join(", ");
console.log(`Token OK (${infoToken})\n`);

// 2. Lo oficial: los 26 endpoints del swagger de la Personal API
const perfil = await pedir("oficial", BASE, "/userprofile-service/userprofile/settings");
const lista = await pedir("oficial", BASE, "/activitylist-service/activities/search/activities", { start: 0, limit: 20 });
const primera = await pedir("historia", BASE, "/activitylist-service/activities/search/activities", { start: 0, limit: 1, sortOrder: "asc" }, { nota: "primera actividad de la cuenta" });
const id = Array.isArray(lista) ? lista[0]?.activityId : null;
// Para la fuerza hace falta una sesión de fuerza, si la hay entre las últimas.
const idFuerza = Array.isArray(lista) ? lista.find((a) => /strength/i.test(a.activityType?.typeKey || a.activityTypeDTO?.typeKey || ""))?.activityId : null;

if (id) {
	await pedir("oficial", BASE, `/activity-service/activity/${id}`);
	await pedir("oficial", BASE, `/activity-service/activity/${id}/workouts`);
	await pedir("oficial", BASE, `/download-service/files/activity/${id}`, null, { binario: true, nota: "FIT original" });
}
await pedir("oficial", BASE, "/biometric-service/heartRateZones/v2");
await pedir("oficial", BASE, `/fitnessage-service/fitnessage/v2/${hoy}`);
await pedir("oficial", BASE, `/goal-service/goal/user/effective/weightgoal/${hace(30)}/${hoy}`);
await pedir("oficial", BASE, `/hrv-service/hrv/${ayer}`);
await pedir("oficial", BASE, `/hrv-service/hrv/daily/${hace(28)}/${hoy}`);
await pedir("oficial", BASE, `/nutrition-service/food/logs/${ayer}`);
await pedir("oficial", BASE, `/periodichealth-service/menstrualcycle/summary/${hoy}`);
await pedir("oficial", BASE, `/periodichealth-service/menstrualcycle/dayview/${hoy}`);
await pedir("oficial", BASE, "/sleep-service/sleep/dailySleep", { date: hoy });
await pedir("oficial", BASE, "/sleep-service/sleep/dailySleepSummariesByDate", { startDate: hace(28), endDate: hoy });
await pedir("oficial", BASE, `/usersummary-service/stats/hydration/daily/${hace(28)}/${hoy}`);
await pedir("oficial", BASE, `/usersummary-service/stats/steps/daily/${hace(27)}/${hoy}`);
await pedir("oficial", BASE, `/usersummary-service/stats/stress/daily/${hace(27)}/${hoy}`);
await pedir("oficial", BASE, "/usersummary-service/usersummary/daily", { calendarDate: ayer });
await pedir("oficial", BASE, "/usersummary-service/v2/dailysummaries", { startDate: hace(364), endDate: hoy });
await pedir("oficial", BASE, `/weight-service/weight/all/${hace(90)}/${hoy}`);
await pedir("oficial", BASE, `/weight-service/weight/range/${hace(90)}/${hoy}`);
await pedir("oficial", BASE, "/wellness-service/wellness/bodyBattery/reports/daily", { startDate: hace(28), endDate: hoy });
await pedir("oficial", BASE, `/wellness-service/wellness/daily/spo2acclimation/${ayer}`);
await pedir("oficial", BASE, "/wellness-service/wellness/dailyHeartRate", { date: ayer });
await pedir("oficial", BASE, `/wellnessactivity-service/activity/summary/range/${hace(28)}/${hoy}`);

// 3. Historia: ¿cuánto hacia atrás llega?
await pedir("historia", BASE, "/sleep-service/sleep/dailySleep", { date: hace(730) }, { nota: "sueño de hace 2 años" });
await pedir("historia", BASE, `/hrv-service/hrv/daily/${hace(758)}/${hace(730)}`, null, { nota: "VFC de hace 2 años" });

// 4. Lo que usa hoy el conector y no está en el swagger: ¿contesta igual en el host personal?
const usuario = perfil?.displayName || perfil?.userName || null;
const noOficiales = [
	[`/metrics-service/metrics/trainingreadiness/${hoy}`, null, "semáforo: Training Readiness"],
	[`/metrics-service/metrics/trainingstatus/aggregated/${hoy}`, null, "carga aguda/crónica, Training Status"],
	[`/metrics-service/metrics/trainingloadbalance/latest/${hoy}`, null, "Load Focus"],
	[`/metrics-service/metrics/maxmet/daily/${hace(30)}/${hoy}`, null, "VO2máx"],
	["/metrics-service/metrics/endurancescore", { calendarDate: hoy }, "Endurance Score"],
	["/metrics-service/metrics/hillscore", { calendarDate: hoy }, "Hill Score"],
	["/biometric-service/biometric/latestLactateThreshold", null, "umbral de lactato"],
	["/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING", null, "FTP"],
	["/fitnessstats-service/activity/all", { startDate: hace(28), endDate: hoy, metric: "activityTrainingLoad" }, "Exercise Load por actividad"],
	[`/sleep-service/stats/sleep/daily/${hace(28)}/${hoy}`, null, "sueño de muchas noches"],
	["/workout-service/workouts", { start: 0, limit: 5 }, "entrenos guardados"],
	["/course-service/course/owner", null, "rutas guardadas"],
	...(usuario ? [[`/metrics-service/metrics/racepredictions/latest/${usuario}`, null, "predicciones de carrera"]] : []),
	...(id
		? [
				[`/activity-service/activity/${id}/details`, null, "gráficas de la actividad"],
				[`/activity-service/activity/${id}/hrTimeInZones`, null, "zonas de pulso de la actividad"],
				[`/activity-service/activity/${id}/splits`, null, "vueltas"],
			]
		: []),
	...(idFuerza ? [[`/activity-service/activity/${idFuerza}/exerciseSets`, null, "series de fuerza"]] : []),
];
for (const [ruta, params, nota] of noOficiales) await pedir("no oficial", BASE, ruta, params, { nota });

// 5. Opcional: el mismo token en el host que usa hoy el conector
if (CONNECTAPI) {
	for (const [ruta, params, nota] of noOficiales.slice(0, 4)) await pedir("connectapi", NO_OFICIAL, ruta, params, { nota });
}

// Informe
const md = [];
md.push(`# Personal API de Garmin: prueba del ${hoy}`, "");
md.push(`Token: ${infoToken || "sin datos de caducidad"}`, "");
md.push(`Primera actividad de la cuenta: ${Array.isArray(primera) && primera[0] ? primera[0].startTimeLocal || "?" : "no sale"}`, "");
md.push(`Cabeceras de límite de uso: ${cabecerasLimite.size ? [...cabecerasLimite].join(" · ") : "ninguna"}`, "");
md.push("| Grupo | Host | Endpoint | HTTP | ms | Qué es | Respuesta | Campos del método |", "|---|---|---|---|---|---|---|---|");
for (const f of filas) {
	const ruta = f.ruta.replace(/\/\d{6,}/g, "/{id}").replace(/\d{4}-\d{2}-\d{2}/g, "{fecha}");
	const celda = (s) => String(s ?? "").replace(/\|/g, "/").slice(0, 160);
	md.push(`| ${f.grupo} | ${f.host} | \`${ruta}\` | ${f.http} | ${f.ms} | ${celda(f.nota)} | ${celda(f.detalle)} | ${celda((f.campos || []).join(", "))} |`);
}
const ok = (g) => filas.filter((f) => f.grupo === g && f.http === 200).length;
const total = (g) => filas.filter((f) => f.grupo === g).length;
md.push("", `Oficiales con 200: ${ok("oficial")}/${total("oficial")} · No oficiales con 200 en el host personal: ${ok("no oficial")}/${total("no oficial")}` + (CONNECTAPI ? ` · En connectapi: ${ok("connectapi")}/${total("connectapi")}` : ""));

fs.mkdirSync(SALIDA, { recursive: true });
const informe = path.join(SALIDA, "garmin-personal-api-informe.md");
fs.writeFileSync(informe, md.join("\n") + "\n");
console.log(`\nInforme en ${informe}. Se puede compartir: no lleva valores, solo códigos y nombres de campos.`);
