/**
 * Garmin -> MCP multiusuario, en un solo Worker de Cloudflare.
 *
 * Cada persona anade la MISMA URL en Claude (.../mcp) y se autentica con sus
 * propias credenciales de Garmin: no hay claves que repartir. Claude se
 * registra solo (RFC 7591), manda al usuario a /oauth/authorize —  que es la
 * pantalla de login de Garmin— y recibe un token ligado a esa persona.
 *
 * Lo que se guarda por usuario es unicamente el token de Garmin y el
 * displayName que exige su API. Ni la contrasena ni el email se almacenan:
 * el id de usuario es un hash del email.
 *
 * Bindings necesarios:
 *   KV namespace -> nombre de binding: GARMIN
 *
 * Rutas:
 *   GET  /.well-known/oauth-authorization-server   descubrimiento OAuth
 *   GET  /.well-known/oauth-protected-resource     apunta /mcp a este servidor
 *   POST /oauth/register                           registro dinamico de cliente
 *   GET  /oauth/authorize                          pantalla de login de Garmin
 *   POST /oauth/authorize                          login (y MFA) -> codigo
 *   POST /oauth/token                              codigo/refresh -> tokens
 *   POST /mcp                                      endpoint MCP (JSON-RPC 2.0)
 */

import { CATALOGO_GARMIN } from "./ejercicios-garmin.js";

// ─────────────────────────────── Garmin ───────────────────────────────

const SSO = "https://sso.garmin.com";
const API = "https://connectapi.garmin.com";
const DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const DI_GRANT_TYPE =
	"https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";

const IOS_CLIENT_ID = "GCM_IOS_DARK";
const IOS_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/ios";
const IOS_LOGIN_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
	"AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const DI_CLIENT_IDS = [
	"GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
	"GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
	"GARMIN_CONNECT_MOBILE_ANDROID_DI",
	"GARMIN_CONNECT_MOBILE_IOS_DI",
];

const NATIVE_HEADERS = {
	"User-Agent": "GCM-Android-5.23",
	"X-Garmin-User-Agent":
		"com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0",
	"X-Garmin-Paired-App-Version": "10861",
	"X-Garmin-Client-Platform": "Android",
	"X-App-Ver": "10861",
	"X-Lang": "en",
	"X-GCExperience": "GC5",
	"Accept-Language": "en-US,en;q=0.9",
};

// -- Flujo alternativo: portal web de escritorio --
const PORTAL_CLIENT_ID = "GarminConnect";
const PORTAL_SERVICE_URL = "https://connect.garmin.com/app";
const DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Los dos caminos de login. Garmin limita cada uno por separado, asi que
 * cuando el movil devuelve 429 el del portal suele seguir abierto: es la
 * razon de que exista el fallback.
 */
const FLOWS = {
	ios: {
		clientId: IOS_CLIENT_ID,
		serviceUrl: IOS_SERVICE_URL,
		loginPath: "/mobile/api/login",
		mfaPath: "/mobile/api/mfa/verifyCode",
		userAgent: IOS_LOGIN_UA,
		warmupPath: null,
	},
	portal: {
		clientId: PORTAL_CLIENT_ID,
		serviceUrl: PORTAL_SERVICE_URL,
		loginPath: "/portal/api/login",
		mfaPath: "/portal/api/mfa/verifyCode",
		userAgent: DESKTOP_UA,
		// El portal espera que antes hayas abierto la pagina de login.
		warmupPath: "/portal/sso/en-US/sign-in",
	},
};

const loginQuery = (flow) =>
	new URLSearchParams({ clientId: flow.clientId, locale: "en-US", service: flow.serviceUrl });

const loginHeaders = (flow, cookie) => ({
	"User-Agent": flow.userAgent,
	Accept: "application/json, text/plain, */*",
	"Accept-Language": "en-US,en;q=0.9",
	"Content-Type": "application/json",
	Origin: SSO,
	...(flow.warmupPath
		? { Referer: `${SSO}${flow.warmupPath}?clientId=${flow.clientId}&service=${flow.serviceUrl}` }
		: {}),
	...(cookie ? { Cookie: cookie } : {}),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * Describe un bloqueo con lo que Garmin nos manda de vuelta.
 *
 * Un 429 del WAF de Cloudflare y un 429 del propio Garmin se arreglan de
 * formas distintas (el primero no se arregla esperando), asi que merece la
 * pena distinguirlos en vez de suponer.
 */
async function describeBlock(res) {
	const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
	const bits = [
		`HTTP ${res.status}`,
		res.headers.get("Retry-After") ? `reintentar en ${res.headers.get("Retry-After")}s` : null,
		res.headers.get("cf-mitigated") ? `cf-mitigated: ${res.headers.get("cf-mitigated")}` : null,
		res.headers.get("cf-ray") ? "bloqueo de Cloudflare (cf-ray presente)" : "sin cf-ray",
		body ? `cuerpo: ${body}` : "cuerpo vacio",
	].filter(Boolean);
	return bits.join(" | ");
}

/**
 * Login contra uno de los dos flujos.
 * Devuelve {ticket, flowName} o {mfaRequired, mfaMethod, cookie, flowName}.
 */
async function loginVia(flowName, email, password) {
	const flow = FLOWS[flowName];
	let cookie = "";

	if (flow.warmupPath) {
		// El portal quiere que primero "abras la pagina": sin esas cookies el
		// POST se rechaza.
		const warm = await fetch(
			`${SSO}${flow.warmupPath}?clientId=${flow.clientId}&service=${encodeURIComponent(flow.serviceUrl)}`,
			{
				headers: {
					"User-Agent": flow.userAgent,
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
				},
			},
		);
		if (warm.status === 429 || warm.status === 403)
			throw new HttpError(warm.status, `Garmin bloqueo la pagina de login. ${await describeBlock(warm)}`);

		cookie = collectCookies(warm);
		// Cloudflare marca como bot la secuencia GET->POST inmediata.
		await wait(9000 + Math.random() * 4000);
	}

	const res = await fetch(`${SSO}${flow.loginPath}?${loginQuery(flow)}`, {
		method: "POST",
		headers: loginHeaders(flow, cookie),
		body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: "" }),
	});

	if (res.status === 429 || res.status === 403)
		throw new HttpError(res.status, `Garmin ha bloqueado la peticion. ${await describeBlock(res)}`);

	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		throw new HttpError(502, `Respuesta no-JSON de Garmin (HTTP ${res.status}).`);
	}

	// Garmin a veces responde 200 con el 429 escondido dentro del cuerpo.
	if (body?.error?.["status-code"] === "429")
		throw new HttpError(429, `Garmin ha limitado el flujo ${flowName} (429 en el cuerpo).`);

	const type = body?.responseStatus?.type;

	if (type === "SUCCESSFUL") return { ticket: body.serviceTicketId, flowName };
	if (type === "MFA_REQUIRED")
		return {
			mfaRequired: true,
			mfaMethod: body?.customerMfaInfo?.mfaLastMethodUsed || "email",
			cookie: cookie ? `${cookie}; ${collectCookies(res)}` : collectCookies(res),
			flowName,
		};
	if (type === "INVALID_USERNAME_PASSWORD")
		throw new HttpError(401, "Email o contrasena incorrectos.");

	// Se enseña lo que ha dicho Garmin: sin eso no hay forma de saber que ha cambiado.
	const detalle = type || (body?.error ? `error ${JSON.stringify(body.error).slice(0, 80)}` : `HTTP ${res.status}`);
	throw new HttpError(502, `Garmin devolvio una respuesta inesperada al iniciar sesion (${flowName}: ${detalle}).`);
}

/**
 * Intenta el flujo movil y, si Garmin lo tiene limitado, cae al del portal.
 * El 429 (limite) y el 502 (respuesta que no entendemos) justifican reintentar;
 * una contrasena incorrecta lo seria en ambos, y repetirla solo acerca el bloqueo.
 */
async function ssoLogin(email, password) {
	try {
		return await loginVia("ios", email, password);
	} catch (err) {
		// Tambien si Garmin responde algo que no entendemos: el otro flujo suele seguir funcionando.
		if (!(err instanceof HttpError) || (err.status !== 429 && err.status !== 502)) throw err;

		try {
			return await loginVia("portal", email, password);
		} catch (fallbackErr) {
			if (fallbackErr instanceof HttpError && fallbackErr.status === 502 && err.status === 502)
				throw new HttpError(502, `${err.message} Tambien por el portal: ${fallbackErr.message}`);
			if (fallbackErr instanceof HttpError && fallbackErr.status === 429)
				// Se arrastra el detalle del segundo intento: sin el no hay forma
				// de distinguir un limite de la API de un bloqueo del WAF, que se
				// arreglan de maneras distintas.
				throw new HttpError(
					429,
					"Garmin tiene limitados los dos metodos de login desde este servidor. " +
						"Suele durar entre minutos y un par de horas; no reintentes en bucle o se alarga. " +
						`Detalle del portal: ${fallbackErr.message}`,
				);
			throw fallbackErr;
		}
	}
}

/** Paso 2, solo si hay MFA. Va por el mismo flujo que el login. */
async function ssoVerifyMfa(code, method, cookie, flowName) {
	const flow = FLOWS[flowName] || FLOWS.ios;

	const res = await fetch(`${SSO}${flow.mfaPath}?${loginQuery(flow)}`, {
		method: "POST",
		headers: loginHeaders(flow, cookie),
		body: JSON.stringify({
			mfaMethod: method,
			mfaVerificationCode: code,
			rememberMyBrowser: true,
			reconsentList: [],
			mfaSetup: false,
		}),
	});

	if (res.status === 429) throw new HttpError(429, "Garmin ha limitado los intentos de MFA.");

	const body = await res.json().catch(() => null);
	if (!body?.serviceTicketId) throw new HttpError(401, "Codigo de verificacion incorrecto.");
	return body.serviceTicketId;
}

/**
 * Canjea el service ticket por el Bearer de Garmin. El service_url debe ser
 * el mismo con el que se hizo el login, o Garmin rechaza el ticket.
 */
async function exchangeTicket(ticket, flowName = "ios") {
	const serviceUrl = (FLOWS[flowName] || FLOWS.ios).serviceUrl;

	for (const clientId of DI_CLIENT_IDS) {
		const res = await fetch(DI_TOKEN_URL, {
			method: "POST",
			headers: {
				...NATIVE_HEADERS,
				Authorization: "Basic " + btoa(`${clientId}:`),
				Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
				"Content-Type": "application/x-www-form-urlencoded",
				"Cache-Control": "no-cache",
			},
			body: new URLSearchParams({
				client_id: clientId,
				service_ticket: ticket,
				grant_type: DI_GRANT_TYPE,
				service_url: serviceUrl,
			}),
		});

		if (res.status === 429) throw new HttpError(429, "Canje de token limitado por Garmin.");
		if (!res.ok) continue;

		const data = await res.json().catch(() => null);
		if (data?.access_token)
			return {
				di_token: data.access_token,
				di_refresh_token: data.refresh_token || null,
				di_client_id: clientId,
				obtained_at: new Date().toISOString(),
			};
	}
	throw new HttpError(502, "No se pudo canjear el ticket de Garmin.");
}

async function refreshGarminTokens(tokens) {
	if (!tokens.di_refresh_token)
		throw new HttpError(401, "Sesion de Garmin caducada. Vuelve a conectar el conector.");

	const res = await fetch(DI_TOKEN_URL, {
		method: "POST",
		headers: {
			...NATIVE_HEADERS,
			Authorization: "Basic " + btoa(`${tokens.di_client_id}:`),
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"Cache-Control": "no-cache",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: tokens.di_client_id,
			refresh_token: tokens.di_refresh_token,
		}),
	});

	if (!res.ok)
		throw new HttpError(401, "Sesion de Garmin caducada. Vuelve a conectar el conector.");

	const data = await res.json();
	return {
		...tokens,
		di_token: data.access_token,
		di_refresh_token: data.refresh_token || tokens.di_refresh_token,
		obtained_at: new Date().toISOString(),
	};
}

/** Tu cuenta de myCoach no tiene Garmin: se dice como arreglarlo. */
const sinGarmin = () =>
	new HttpError(
		401,
		"Garmin no está vinculado a tu cuenta de myCoach. Vincúlalo en la app: Ajustes, Conexiones, Garmin. " +
			"Si acabas de vincularlo, espera un minuto y vuelve a probar.",
	);

/** GET contra connectapi con el Bearer del usuario, renovando si hace falta. */
async function apiGet(env, userId, path, params) {
	let user = await env.GARMIN.get(userKey(userId), "json");
	// Si el usuario acaba de conectar, su registro puede tardar hasta un
	// minuto en propagarse por el KV: conviene decirlo en vez de dar a
	// entender que la conexion ha fallado.
	if (!user?.di_token) throw sinGarmin();

	const url = `${API}${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
	const call = (u) =>
		fetch(url, {
			headers: { ...NATIVE_HEADERS, Authorization: `Bearer ${u.di_token}`, Accept: "application/json" },
		});

	let res = await call(user);

	if (res.status === 401) {
		user = await refreshGarminTokens(user);
		await env.GARMIN.put(userKey(userId), JSON.stringify(user));
		res = await call(user);
	}

	if (!res.ok) throw new HttpError(res.status, `Garmin devolvio HTTP ${res.status} en ${path}.`);
	return res.json();
}

/**
 * POST contra connectapi. Igual que apiGet pero, al fallar, devuelve el
 * cuerpo de Garmin literal: el esquema de recorridos no esta documentado y
 * su mensaje de validacion es la unica forma de saber que falta.
 */
async function apiPost(env, userId, path, payload) {
	let user = await env.GARMIN.get(userKey(userId), "json");
	// Si el usuario acaba de conectar, su registro puede tardar hasta un
	// minuto en propagarse por el KV: conviene decirlo en vez de dar a
	// entender que la conexion ha fallado.
	if (!user?.di_token) throw sinGarmin();

	const call = (u) =>
		fetch(`${API}${path}`, {
			method: "POST",
			headers: {
				...NATIVE_HEADERS,
				Authorization: `Bearer ${u.di_token}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

	let res = await call(user);

	if (res.status === 401) {
		user = await refreshGarminTokens(user);
		await env.GARMIN.put(userKey(userId), JSON.stringify(user));
		res = await call(user);
	}

	if (!res.ok) {
		// Generoso a proposito: cuando Garmin rechaza algo imprime el DTO que
		// recibio, y ahi estan los nombres reales de sus campos. Es la unica
		// documentacion que hay de este endpoint.
		const detail = (await res.text().catch(() => "")).slice(0, 3000);
		throw new HttpError(res.status, `Garmin rechazo la escritura en ${path} (HTTP ${res.status}): ${detail}`);
	}

	return res.json().catch(() => ({}));
}

async function displayName(env, userId) {
	const user = await env.GARMIN.get(userKey(userId), "json");
	if (user?.displayName) return user.displayName;

	const profile = await apiGet(env, userId, "/userprofile-service/socialProfile");
	if (!profile?.displayName) throw new HttpError(502, "Garmin no devolvio displayName.");

	await env.GARMIN.put(userKey(userId), JSON.stringify({ ...user, displayName: profile.displayName }));
	return profile.displayName;
}

/**
 * Los recorridos de Garmin no se leen igual que se escriben, y el listado
 * tampoco usa los mismos nombres que el detalle: al crear se manda
 * `distanceMeter`, el detalle lo devuelve igual y la lista trae otra cosa.
 * Adivinar nombres ya costo un recorrido con el desnivel a cero, asi que
 * aqui se busca el campo por lo que significa y no por como se llama.
 */
function primerNumero(obj, patron, excluir) {
	for (const [clave, valor] of Object.entries(obj)) {
		if (typeof valor !== "number") continue;
		if (excluir && excluir.test(clave)) continue;
		if (patron.test(clave)) return valor;
	}
	return null;
}

function resumirCourse(c) {
	// Los metros pueden venir en `distanceMeter`, `distance` o vaya usted a
	// saber: cualquier clave que hable de distancia sirve. Se descartan las
	// que hablan de otra cosa (una distancia "hasta el inicio", por ejemplo).
	const metros = primerNumero(c, /distance/i, /(start|elev|point|index)/i);
	const subida = primerNumero(c, /elevat(ion)?.*(gain|ascent)|ascent/i);
	const bajada = primerNumero(c, /elevat(ion)?.*(loss|descent)|descent/i);
	const creado = c.createDate ?? c.createdDate ?? c.startDate ?? null;
	return {
		course_id: c.courseId ?? c.id ?? null,
		name: c.courseName ?? c.name ?? null,
		// Garmin mezcla metros y kilometros segun el endpoint: por encima de
		// 1.000 son metros; por debajo, ya venia en kilometros.
		distance_km: metros == null ? null : round(metros > 1000 ? metros / 1000 : metros, 2),
		elevation_gain_m: subida == null ? null : Math.round(subida),
		elevation_loss_m: bajada == null ? null : Math.round(bajada),
		activity_type: c.activityType?.typeKey ?? c.activityTypePk ?? null,
		// Las fechas llegan como milisegundos desde epoch o como texto.
		created: typeof creado === "number" ? new Date(creado).toISOString().slice(0, 10) : creado,
	};
}

// ──────────────────────── Planificacion de rutas ────────────────────────

const BROUTER = "https://brouter.de/brouter";

/** Perfiles utiles para carretera, de mas rapido a mas tranquilo. */
const ROUTE_PROFILES = {
	fastbike: "Carretera, prioriza asfalto rapido y directo.",
	trekking: "Equilibrado, acepta algun tramo secundario.",
	safety: "Prioriza evitar trafico aunque alargue.",
};

const parsePoint = (s) => {
	const [lat, lon] = String(s).split(",").map((n) => Number(n.trim()));
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, `Punto invalido: "${s}"`);
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, `Coordenadas fuera de rango: "${s}"`);
	return { lat, lon };
};

/**
 * Traza la ruta con BRouter y la mide.
 *
 * Devuelve metricas, nunca el trazado completo: una ruta de 70km son miles
 * de puntos y no tienen ningun valor dentro de una conversacion.
 */
async function routeVia(points, profile) {
	const lonlats = points.map((p) => `${p.lon},${p.lat}`).join("|");
	const url = `${BROUTER}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;

	const res = await fetch(url, { headers: { Accept: "application/json" } });
	if (!res.ok) {
		const body = (await res.text().catch(() => "")).slice(0, 200);
		throw new HttpError(502, `El router no pudo trazar la ruta (HTTP ${res.status}): ${body}`);
	}

	const geo = await res.json();
	const feature = geo?.features?.[0];
	const coords = feature?.geometry?.coordinates;
	if (!Array.isArray(coords) || coords.length < 2)
		throw new HttpError(502, "El router devolvio una ruta vacia. Revisa que los puntos esten en tierra firme.");

	const props = feature.properties || {};

	// Las columnas de `messages` varian segun version; se localizan por nombre
	// y, si no estan, se informa null en vez de inventar un numero.
	const columns = props.messages?.[0] || [];
	const rows = (props.messages || []).slice(1);
	const nodeTagsAt = columns.indexOf("NodeTags");
	const wayTagsAt = columns.indexOf("WayTags");

	const signals =
		nodeTagsAt === -1 ? null : rows.filter((r) => String(r[nodeTagsAt] || "").includes("traffic_signals")).length;

	let roads = null;
	if (wayTagsAt !== -1) {
		const tally = {};
		for (const r of rows) {
			const tag = String(r[wayTagsAt] || "").match(/highway=([a-z_]+)/)?.[1];
			if (tag) tally[tag] = (tally[tag] || 0) + 1;
		}
		roads = Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6));
	}

	return {
		coords,
		distance_km: round((Number(props["track-length"]) || 0) / 1000, 1),
		elevation_gain_m: Math.round(Number(props["filtered ascend"]) || 0),
		traffic_signals: signals,
		road_types: roads,
	};
}

/** Distancia en metros entre dos [lon, lat], formula del haversine. */
function metresBetween([lon1, lat1], [lon2, lat2]) {
	const rad = (d) => (d * Math.PI) / 180;
	const dLat = rad(lat2 - lat1);
	const dLon = rad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/**
 * Perfil de la ruta en pocos puntos, repartidos por distancia y no por
 * indice: el router pone muchos mas puntos en las curvas que en las rectas,
 * y repartir por indice amontonaria la muestra en los pueblos. Sirve para
 * que el modelo diga "la subida empieza en el km 12" sin cargar el trazado
 * entero en la conversacion.
 */
function perfilResumido(coords, n) {
	if (!coords?.length) return [];
	const acumulada = [0];
	for (let i = 1; i < coords.length; i++) acumulada.push(acumulada[i - 1] + metresBetween(coords[i - 1], coords[i]));
	const total = acumulada.at(-1);
	const puntos = [];
	let j = 0;
	for (let k = 0; k < n; k++) {
		const objetivo = (total * k) / (n - 1);
		while (j < coords.length - 1 && acumulada[j] < objetivo) j++;
		const [lon, lat, ele] = coords[j];
		puntos.push([round(acumulada[j] / 1000, 2), ele == null ? null : Math.round(ele), round(lat, 4), round(lon, 4)]);
	}
	return puntos;
}

const gpxFrom = (name, coords) =>
	`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="garmin-mcp" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${escapeHtml(name)}</name><trkseg>
${coords.map(([lon, lat, ele]) => `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ""}</trkpt>`).join("\n")}
</trkseg></trk></gpx>`;

// ──────────────────────────── Herramientas MCP ────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const round = (n, digits = 2) => (typeof n === "number" ? Number(n.toFixed(digits)) : null);

// ──────────────── Análisis de una actividad a partir de sus series ────────────────
//
// El resumen de Garmin da medias. Para saber cómo sube, cuánto aguanta y en qué
// zonas entrena alguien sin potenciómetro hacen falta las series (pulso,
// altitud, distancia y tiempo). Todo lo de aquí es determinista: se calcula,
// no se estima con un modelo.

/**
 * Las series vienen como filas de valores con un índice por métrica. Los
 * nombres varían según el aparato, así que se buscan por lista de candidatos.
 */
function seriesDeActividad(details) {
	const desc = details?.metricDescriptors || [];
	const indice = (...claves) => {
		for (const clave of claves) {
			const d = desc.find((x) => x.key === clave);
			if (d) return d.metricsIndex;
		}
		return -1;
	};
	const iFc = indice("directHeartRate");
	const iAlt = indice("directElevation", "directCorrectedElevation");
	const iDist = indice("sumDistance");
	const iDur = indice("sumMovingDuration", "sumDuration", "sumElapsedDuration");
	const iTs = indice("directTimestamp");
	const filas = (details?.activityDetailMetrics || []).map((m) => m.metrics || []);
	if (!filas.length || iDist < 0) return [];

	const t0 = iTs >= 0 ? filas.find((f) => typeof f[iTs] === "number")?.[iTs] : null;
	const puntos = [];
	for (const f of filas) {
		const d = f[iDist];
		if (typeof d !== "number") continue;
		let t = iDur >= 0 && typeof f[iDur] === "number" ? f[iDur] : null;
		if (t == null && iTs >= 0 && typeof f[iTs] === "number" && t0 != null) t = (f[iTs] - t0) / 1000;
		puntos.push({
			t,
			d,
			e: iAlt >= 0 && typeof f[iAlt] === "number" ? f[iAlt] : null,
			fc: iFc >= 0 && typeof f[iFc] === "number" && f[iFc] > 30 ? f[iFc] : null,
		});
	}
	return puntos.sort((a, b) => a.d - b.d);
}

/** Media móvil por distancia, para que el ruido del barómetro no invente repechos. */
function suavizarAltitud(puntos, ventanaM = 150) {
	const out = [];
	let ini = 0;
	let suma = 0;
	let n = 0;
	for (let i = 0; i < puntos.length; i++) {
		if (puntos[i].e == null) { out.push(null); continue; }
		suma += puntos[i].e;
		n++;
		while (puntos[i].d - puntos[ini].d > ventanaM) {
			if (puntos[ini].e != null) { suma -= puntos[ini].e; n--; }
			ini++;
		}
		out.push(n ? suma / n : null);
	}
	return out;
}

const MEDIA = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Subidas: de un mínimo a un máximo, tolerando bajadas de menos de 15 m.
 * Se quedan las que ganan al menos 50 m al 3 % o más durante 800 m o más.
 * La VAM (metros de desnivel por hora) es la cifra con la que se comparan
 * escaladores sin potenciómetro; de ella sale una estimación de vatios por
 * kilo con la fórmula de Ferrari, que se marca siempre como estimación.
 */
function detectarSubidas(puntos) {
	const e = suavizarAltitud(puntos);
	const validos = puntos.map((p, i) => ({ ...p, es: e[i] })).filter((p) => p.es != null && p.t != null);
	const subidas = [];
	if (validos.length < 3) return subidas;
	const DIP = 15;
	let s = 0;
	let m = 0;
	const cerrar = (a, b) => {
		const pa = validos[a];
		const pb = validos[b];
		const gan = pb.es - pa.es;
		const largo = pb.d - pa.d;
		const seg = pb.t - pa.t;
		if (gan < 50 || largo < 800 || seg <= 0) return;
		const pend = (gan / largo) * 100;
		if (pend < 3) return;
		const fcs = validos.slice(a, b + 1).map((p) => p.fc).filter(Boolean);
		const vam = gan / (seg / 3600);
		subidas.push({
			km_inicio: round(pa.d / 1000, 1),
			largo_km: round(largo / 1000, 2),
			desnivel_m: Math.round(gan),
			pendiente_pct: round(pend, 1),
			minutos: round(seg / 60, 1),
			vam_m_h: Math.round(vam),
			fc_media: fcs.length ? Math.round(MEDIA(fcs)) : null,
			w_kg_estimado: round(vam / (200 + 10 * pend), 2),
		});
	};
	for (let i = 1; i < validos.length; i++) {
		if (validos[i].es > validos[m].es) m = i;
		if (validos[m].es - validos[i].es >= DIP) {
			cerrar(s, m);
			s = i;
			m = i;
		} else if (validos[i].es <= validos[s].es + 0.5) {
			// Mientras no se gana altura, el inicio avanza: si no, un llano
			// largo antes del puerto se contaría como parte de la subida y
			// diluiría la pendiente.
			s = i;
			m = i;
		}
	}
	cerrar(s, m);
	return subidas.sort((x, y) => y.desnivel_m - x.desnivel_m);
}

/** Pulso medio máximo sostenido durante N minutos (media móvil en el tiempo). */
function fcMaxSostenida(puntos, minutos) {
	const p = puntos.filter((x) => x.fc && x.t != null);
	if (p.length < 2 || p.at(-1).t - p[0].t < minutos * 60) return null;
	let mejor = 0;
	let ini = 0;
	let suma = 0;
	for (let i = 0; i < p.length; i++) {
		suma += p[i].fc;
		while (p[i].t - p[ini].t > minutos * 60) { suma -= p[ini].fc; ini++; }
		if (p[i].t - p[ini].t >= minutos * 60 * 0.95) mejor = Math.max(mejor, suma / (i - ini + 1));
	}
	return mejor ? Math.round(mejor) : null;
}

/**
 * Desacople aeróbico (Friel): cuánto cae la relación velocidad/pulso de la
 * primera mitad a la segunda. Solo sirve con el terreno igualado: con un
 * puerto en una mitad y la bajada en la otra salían cifras absurdas (−87 %).
 * Por eso se mide únicamente sobre tramos llanos de 1 km, repartidos entre
 * las dos mitades de la salida, y se exigen al menos 5 en cada una.
 */
function desacople(puntos) {
	const tramos = tramosLlanos(puntos).filter((x) => x.fc);
	if (tramos.length < 10) return null;
	const mitad = (tramos[0].t + tramos.at(-1).t) / 2;
	const ef = (a) => MEDIA(a.map((x) => x.v / x.fc));
	const a = tramos.filter((x) => x.t <= mitad);
	const b = tramos.filter((x) => x.t > mitad);
	if (a.length < 5 || b.length < 5) return null;
	return round(((ef(a) - ef(b)) / ef(a)) * 100, 1);
}

/** Tramos de 1 km con menos del 1,5 % de pendiente media, con su velocidad y pulso. */
function tramosLlanos(puntos) {
	const e = suavizarAltitud(puntos);
	const p = puntos.map((x, i) => ({ ...x, es: e[i] })).filter((x) => x.es != null && x.t != null);
	const tramos = [];
	let a = 0;
	for (let i = 1; i < p.length; i++) {
		if (p[i].d - p[a].d >= 1000) {
			const pend = Math.abs(p[i].es - p[a].es) / (p[i].d - p[a].d);
			if (pend < 0.015 && p[i].t > p[a].t) {
				const fcs = p.slice(a, i + 1).map((x) => x.fc).filter(Boolean);
				tramos.push({ t: p[a].t, v: ((p[i].d - p[a].d) / (p[i].t - p[a].t)) * 3.6, fc: fcs.length ? MEDIA(fcs) : null });
			}
			a = i;
		}
	}
	return tramos;
}

/** Velocidad en llano y pulso con que se consigue. */
function velocidadLlano(puntos) {
	const tramos = tramosLlanos(puntos);
	if (tramos.length < 3) return null;
	return {
		km: tramos.length,
		vel_media_kmh: round(MEDIA(tramos.map((x) => x.v)), 1),
		fc_media: tramos.some((x) => x.fc) ? Math.round(MEDIA(tramos.map((x) => x.fc).filter(Boolean))) : null,
	};
}

/**
 * Minutos por tramo de 5 ppm. Garmin usa zonas distintas según el tipo de
 * actividad y el aparato (la zona 2 empezaba en 122 ppm en una salida y en
 * 146 en otra), así que para contar días suaves e intensos con un único
 * criterio hace falta el pulso en bruto. Cada muestra cuenta como mucho 30 s
 * para que una parada con el reloj en marcha no infle nada.
 */
function histogramaFc(puntos) {
	const p = puntos.filter((x) => x.fc && x.t != null);
	const cubos = {};
	for (let i = 1; i < p.length; i++) {
		const dt = Math.min(30, Math.max(0, p[i].t - p[i - 1].t));
		const c = Math.floor(p[i].fc / 5) * 5;
		cubos[c] = (cubos[c] || 0) + dt;
	}
	return Object.fromEntries(Object.entries(cubos).filter(([, sg]) => sg >= 30).map(([c, sg]) => [c, round(sg / 60, 1)]));
}

function analizarActividad(details) {
	const puntos = seriesDeActividad(details);
	if (puntos.length < 10) return { muestras: puntos.length, nota: "Sin series suficientes." };
	return {
		muestras: puntos.length,
		subidas: detectarSubidas(puntos).slice(0, 8),
		llano: velocidadLlano(puntos),
		desacople_pct: desacople(puntos),
		histograma_fc_min: histogramaFc(puntos),
		fc_max_sostenida: { min5: fcMaxSostenida(puntos, 5), min20: fcMaxSostenida(puntos, 20), min60: fcMaxSostenida(puntos, 60) },
		nota: "W/kg estimado con la fórmula de Ferrari (VAM / (200 + 10 · pendiente)): orientativo, sin potenciómetro.",
	};
}

// ──────────── Todas las metricas de una actividad, por deporte ────────────
//
// Garmin manda dos cosas: un resumen (summaryDTO) y las series segundo a
// segundo (details). Antes solo se usaban pulso y altitud; ahora se ensenan
// todas las que traiga, con nombre y unidad, y un perfil resumido de las
// principales para que Claude "vea" el grafico (stamina incluida) sin pedir
// capturas. Lo que no se reconoce tambien sale, con su clave de Garmin.

const kmh = (ms) => (typeof ms === "number" ? round(ms * 3.6, 1) : null);
const ritmoKm = (ms) => {
	if (typeof ms !== "number" || ms <= 0.3) return null;
	const s = Math.round(1000 / ms);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
};
const esCarrera = (tipo) => /run/.test(String(tipo || ""));
const esSkimo = (tipo) => /backcountry|ski_touring|skimo/.test(String(tipo || ""));

// Series de details: [nombre, unidad, conversion]. Las claves son las de Garmin.
const SERIES_GARMIN = {
	directSpeed: ["Velocidad", "km/h", (v) => v * 3.6],
	directGradeAdjustedSpeed: ["Velocidad ajustada a la pendiente", "km/h", (v) => v * 3.6],
	directHeartRate: ["Pulso", "ppm"],
	directPower: ["Potencia", "W"],
	directBikeCadence: ["Cadencia", "rpm"],
	directRunCadence: ["Cadencia", "pasos/min"],
	directDoubleCadence: ["Cadencia", "pasos/min"],
	directFractionalCadence: ["Cadencia (fracción)", ""],
	directElevation: ["Altitud", "m"],
	directCorrectedElevation: ["Altitud corregida", "m"],
	directVerticalSpeed: ["Velocidad vertical", "m/h", (v) => v * 3600],
	directGrade: ["Pendiente", "%"],
	directAirTemperature: ["Temperatura", "°C"],
	directStrideLength: ["Longitud de zancada", "cm"],
	directGroundContactTime: ["Contacto con el suelo", "ms"],
	directGroundContactBalanceLeft: ["Balance de contacto (izq.)", "%"],
	directVerticalOscillation: ["Oscilación vertical", "cm"],
	directVerticalRatio: ["Ratio vertical", "%"],
	directPerformanceCondition: ["Condición de rendimiento", ""],
	directRespirationRate: ["Respiración", "rpm"],
	directAvailableStamina: ["Stamina disponible", "%"],
	directPotentialStamina: ["Stamina potencial", "%"],
	directLeftBalance: ["Balance de potencia (izq.)", "%"],
	directBodyBattery: ["Body Battery", ""],
};
// Lo que no es una medida: posicion, tiempo y acumulados.
const SERIES_IGNORADAS = /^(directTimestamp|directLatitude|directLongitude|sum|directUncorrected)/;
const SERIES_PERFIL = [
	"directSpeed", "directGradeAdjustedSpeed", "directHeartRate", "directPower", "directBikeCadence", "directRunCadence",
	"directDoubleCadence", "directElevation", "directVerticalSpeed", "directAvailableStamina", "directPotentialStamina",
];

function nombreSerie(clave) {
	if (SERIES_GARMIN[clave]) return SERIES_GARMIN[clave];
	// Garmin a veces cambia el nombre exacto: la stamina se reconoce igual.
	if (/stamina/i.test(clave)) return [/potential/i.test(clave) ? "Stamina potencial" : "Stamina disponible", "%"];
	return [clave, ""];
}

/**
 * Resumen de cada serie (min, media, max, inicio y final) y un perfil de
 * `n` puntos por distancia (o por tiempo si no hay distancia) con las
 * principales. Es lo que responde a "enseñame la grafica de...".
 */
function seriesCompletas(details, n = 24) {
	const desc = details?.metricDescriptors || [];
	const filas = (details?.activityDetailMetrics || []).map((m) => m.metrics || []);
	if (!filas.length) return { series: [], perfil: null };
	const iDist = desc.find((x) => x.key === "sumDistance")?.metricsIndex ?? -1;
	const iDur = desc.find((x) => ["sumMovingDuration", "sumDuration", "sumElapsedDuration"].includes(x.key))?.metricsIndex ?? -1;

	const series = [];
	for (const { key, metricsIndex } of desc) {
		if (SERIES_IGNORADAS.test(key)) continue;
		const [nombre, unidad, conv = (v) => v] = nombreSerie(key);
		const vals = filas.map((f) => f[metricsIndex]).filter((v) => typeof v === "number" && Number.isFinite(v)).map(conv);
		// Un pulso de 0 o una cadencia de 0 parado no son medidas: fuera de la media.
		const utiles = /HeartRate|Cadence|Power|Speed/.test(key) ? vals.filter((v) => v > 0) : vals;
		if (!utiles.length) continue;
		series.push({
			clave: key, nombre, unidad,
			min: round(Math.min(...utiles), 1), media: round(utiles.reduce((a, b) => a + b, 0) / utiles.length, 1),
			max: round(Math.max(...utiles), 1), inicio: round(utiles[0], 1), final: round(utiles.at(-1), 1),
		});
	}

	// Perfil: n tramos iguales, media de cada serie principal en cada tramo.
	const eje = iDist >= 0 ? iDist : iDur;
	const presentes = SERIES_PERFIL.map((k) => desc.find((x) => x.key === k)).filter(Boolean)
		.concat(desc.filter((x) => /stamina/i.test(x.key) && !SERIES_PERFIL.includes(x.key)));
	let perfil = null;
	if (eje >= 0 && presentes.length) {
		const conEje = filas.filter((f) => typeof f[eje] === "number");
		const total = Math.max(...conEje.map((f) => f[eje]), 0);
		if (total > 0) {
			const tramos = Array.from({ length: n }, () => ({}));
			for (const f of conEje) {
				const i = Math.min(n - 1, Math.floor((f[eje] / total) * n));
				for (const { key, metricsIndex } of presentes) {
					const v = f[metricsIndex];
					if (typeof v !== "number" || !Number.isFinite(v) || (/HeartRate|Cadence|Power/.test(key) && v <= 0)) continue;
					(tramos[i][key] ||= []).push(v);
				}
			}
			perfil = {
				eje: iDist >= 0 ? "km" : "min",
				columnas: presentes.map((x) => `${nombreSerie(x.key)[0]}${nombreSerie(x.key)[1] ? ` (${nombreSerie(x.key)[1]})` : ""}`),
				puntos: tramos.map((t, i) => [
					iDist >= 0 ? round(((i + 1) * total) / n / 1000, 2) : round(((i + 1) * total) / n / 60, 1),
					...presentes.map(({ key }) => {
						const xs = t[key];
						if (!xs?.length) return null;
						const [, , conv = (v) => v] = nombreSerie(key);
						return round(conv(xs.reduce((a, b) => a + b, 0) / xs.length), 1);
					}),
				]),
			};
		}
	}
	return { series, perfil };
}

// Resumen de Garmin: [campo, nombre, conversion]. Todo lo demas numerico va a "otros".
const RESUMEN_GARMIN = [
	["duration", "duracion_min", (v) => round(v / 60, 1)],
	["movingDuration", "en_movimiento_min", (v) => round(v / 60, 1)],
	["elapsedDuration", "total_min", (v) => round(v / 60, 1)],
	["distance", "distancia_km", (v) => round(v / 1000, 2)],
	["averageSpeed", "velocidad_media_kmh", kmh],
	["averageMovingSpeed", "velocidad_en_movimiento_kmh", kmh],
	["maxSpeed", "velocidad_max_kmh", kmh],
	["avgGradeAdjustedSpeed", "velocidad_ajustada_pendiente_kmh", kmh],
	["elevationGain", "desnivel_positivo_m", (v) => Math.round(v)],
	["elevationLoss", "desnivel_negativo_m", (v) => Math.round(v)],
	["minElevation", "altitud_min_m", (v) => Math.round(v)],
	["maxElevation", "altitud_max_m", (v) => Math.round(v)],
	["maxVerticalSpeed", "velocidad_vertical_max_mh", (v) => Math.round(v * 3600)],
	["averageHR", "fc_media", (v) => Math.round(v)],
	["maxHR", "fc_max", (v) => Math.round(v)],
	["minHR", "fc_min", (v) => Math.round(v)],
	["averagePower", "potencia_media_w", (v) => Math.round(v)],
	["maxPower", "potencia_max_w", (v) => Math.round(v)],
	["normalizedPower", "potencia_normalizada_w", (v) => Math.round(v)],
	["intensityFactor", "factor_intensidad", (v) => round(v, 2)],
	["trainingStressScore", "tss", (v) => Math.round(v)],
	["functionalThresholdPower", "ftp_w", (v) => Math.round(v)],
	["averageBikeCadence", "cadencia_media_rpm", (v) => Math.round(v)],
	["maxBikeCadence", "cadencia_max_rpm", (v) => Math.round(v)],
	["averageRunCadence", "cadencia_media_pasos", (v) => Math.round(v)],
	["maxRunCadence", "cadencia_max_pasos", (v) => Math.round(v)],
	["strideLength", "zancada_cm", (v) => round(v, 1)],
	["groundContactTime", "contacto_suelo_ms", (v) => Math.round(v)],
	["verticalOscillation", "oscilacion_vertical_cm", (v) => round(v, 1)],
	["verticalRatio", "ratio_vertical_pct", (v) => round(v, 1)],
	["averageTemperature", "temperatura_media_c", (v) => round(v, 1)],
	["minTemperature", "temperatura_min_c", (v) => round(v, 1)],
	["maxTemperature", "temperatura_max_c", (v) => round(v, 1)],
	["calories", "calorias", (v) => Math.round(v)],
	["trainingEffect", "efecto_aerobico", (v) => round(v, 1)],
	["anaerobicTrainingEffect", "efecto_anaerobico", (v) => round(v, 1)],
	["activityTrainingLoad", "carga_garmin", (v) => Math.round(v)],
	["beginPotentialStamina", "stamina_potencial_inicio_pct", (v) => Math.round(v)],
	["endPotentialStamina", "stamina_potencial_final_pct", (v) => Math.round(v)],
	["minAvailableStamina", "stamina_disponible_min_pct", (v) => Math.round(v)],
	["avgRespirationRate", "respiracion_media", (v) => round(v, 1)],
	["maxRespirationRate", "respiracion_max", (v) => round(v, 1)],
];

function metricasGarmin(s = {}, tipo) {
	const m = {};
	const usados = new Set();
	for (const [campo, nombre, conv] of RESUMEN_GARMIN) {
		if (typeof s[campo] === "number" && Number.isFinite(s[campo])) { m[nombre] = conv(s[campo]); usados.add(campo); }
	}
	// Lo propio de cada deporte, calculado cuando Garmin no lo da hecho.
	if (esCarrera(tipo)) {
		m.ritmo_medio = ritmoKm(s.averageMovingSpeed ?? s.averageSpeed);
		if (s.avgGradeAdjustedSpeed) m.ritmo_ajustado_pendiente = ritmoKm(s.avgGradeAdjustedSpeed);
		if (s.maxSpeed) m.ritmo_max = ritmoKm(s.maxSpeed);
	}
	const mov = s.movingDuration || s.duration;
	if ((esSkimo(tipo) || DEPORTES_BICI.has(tipo) || /hik|mountain/.test(tipo || "")) && s.elevationGain > 50 && mov > 0)
		m.vam_media_mh = Math.round(s.elevationGain / (mov / 3600)); // metros de subida por hora de actividad
	if (s.averageHR && (s.averageMovingSpeed ?? s.averageSpeed))
		m.metros_por_latido = round((s.averageMovingSpeed ?? s.averageSpeed) * 60 / s.averageHR, 2);
	if (s.averagePower && s.averageHR) m.vatios_por_latido = round(s.averagePower / s.averageHR, 2);

	const otros = {};
	for (const [k, v] of Object.entries(s)) {
		if (!usados.has(k) && typeof v === "number" && Number.isFinite(v) && !/Id$|^start|^end(?!PotentialStamina)|Latitude|Longitude/.test(k)) otros[k] = round(v, 2);
	}
	return Object.fromEntries(Object.entries({ ...m, otros_campos_garmin: Object.keys(otros).length ? otros : null }).filter(([, v]) => v != null));
}

/** Recorta un JSON para poder ver su forma sin llenar la conversación. */
const muestraCruda = (x, n = 700) => {
	try { return JSON.stringify(x).slice(0, n); } catch { return null; }
};

/** Primer valor de un mapa por dispositivo ({deviceId: {...}}): suele haber uno. */
const primeroDelMapa = (m) => (m && typeof m === "object" ? Object.values(m)[0] ?? null : null);

/**
 * Las escalas que Garmin ya calcula, con sus propios umbrales: son las
 * referencias más sólidas que hay para comparar a alguien con la élite sin
 * potenciómetro, porque las mide el reloj y no las estimamos nosotros.
 */
function perfilGarmin({ vo2, endurance, hill, estado, ajustes, fecha }) {
	const ud = ajustes?.userData || {};
	const nacimiento = ud.birthDate ? new Date(ud.birthDate) : null;
	const edad = nacimiento ? Math.floor((Date.parse(fecha) - nacimiento.getTime()) / (365.25 * 86400000)) : null;
	const vo2Reciente = estado?.mostRecentVO2Max?.generic || vo2?.generic || null;
	const balance = primeroDelMapa(estado?.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap);
	const statusDev = primeroDelMapa(estado?.mostRecentTrainingStatus?.latestTrainingStatusData);
	const niveles = endurance?.overallScore != null ? [
		["Principiante", endurance.gaugeLowerLimit], ["Intermedio", endurance.classificationLowerLimitIntermediate],
		["Entrenado", endurance.classificationLowerLimitTrained], ["Muy entrenado", endurance.classificationLowerLimitWellTrained],
		["Experto", endurance.classificationLowerLimitExpert], ["Superior", endurance.classificationLowerLimitSuperior],
		["Élite", endurance.classificationLowerLimitElite],
	].filter(([, v]) => typeof v === "number") : [];
	const nivelActual = niveles.filter(([, v]) => endurance.overallScore >= v).at(-1)?.[0] ?? null;
	const siguiente = niveles.find(([, v]) => v > endurance?.overallScore) ?? null;
	return {
		persona: { edad, sexo: ud.gender ?? null, peso_kg: ud.weight ? round(ud.weight / 1000, 1) : null,
			umbral_lactato_ppm: ud.lactateThresholdHeartRate ?? null },
		vo2max: vo2Reciente?.vo2MaxPreciseValue ?? vo2Reciente?.vo2MaxValue ?? hill?.vo2MaxPreciseValue ?? null,
		vo2max_fecha: vo2Reciente?.calendarDate ?? null,
		vo2max_ciclismo: estado?.mostRecentVO2Max?.cycling?.vo2MaxPreciseValue ?? null,
		endurance: endurance?.overallScore != null ? {
			puntos: endurance.overallScore, nivel: nivelActual,
			siguiente: siguiente ? { nivel: siguiente[0], desde: siguiente[1] } : null,
			escala: Object.fromEntries(niveles), maximo_escala: endurance.gaugeUpperLimit ?? null,
		} : null,
		hill_score: hill?.overallScore ?? null,
		balance_carga_mes: balance ? {
			aerobica_baja: { carga: Math.round(balance.monthlyLoadAerobicLow), objetivo: [balance.monthlyLoadAerobicLowTargetMin, balance.monthlyLoadAerobicLowTargetMax] },
			aerobica_alta: { carga: Math.round(balance.monthlyLoadAerobicHigh), objetivo: [balance.monthlyLoadAerobicHighTargetMin, balance.monthlyLoadAerobicHighTargetMax] },
			anaerobica: { carga: Math.round(balance.monthlyLoadAnaerobic), objetivo: [balance.monthlyLoadAnaerobicTargetMin, balance.monthlyLoadAnaerobicTargetMax] },
			veredicto_garmin: balance.trainingBalanceFeedbackPhrase ?? null,
		} : null,
		estado_entreno: statusDev ? {
			estado: statusDev.trainingStatus ?? null,
			frase: statusDev.trainingStatusFeedbackPhrase ?? null,
			carga_aguda: statusDev.acuteTrainingLoadDTO?.dailyTrainingLoadAcute ?? null,
			carga_cronica: statusDev.acuteTrainingLoadDTO?.dailyTrainingLoadChronic ?? null,
			ratio: statusDev.acuteTrainingLoadDTO?.dailyAcuteChronicWorkloadRatio ?? null,
		} : null,
	};
}

/** Polilínea codificada de Google (precisión 1e-5) a partir de puntos {lat, lon}. */
function codificarPolilinea(puntos) {
	let out = "";
	let plat = 0;
	let plon = 0;
	const cod = (v) => {
		v = v < 0 ? ~(v << 1) : v << 1;
		let s = "";
		while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
		return s + String.fromCharCode(v + 63);
	};
	for (const p of puntos) {
		if (typeof p?.lat !== "number" || typeof p?.lon !== "number") continue;
		const lat = Math.round(p.lat * 1e5);
		const lon = Math.round(p.lon * 1e5);
		out += cod(lat - plat) + cod(lon - plon);
		plat = lat;
		plon = lon;
	}
	return out;
}

const TOOLS = {
	app_leer: {
		title: "Leer datos de myCoach",
		description:
			"Lee un documento guardado por la app myCoach para este usuario. Documentos: 'estado/app' (plan de la semana y la siguiente por fecha, comidas en cuartos de plato, objetivo, deportes, nombre), 'vivo/datos' (actividades y perfil ya procesados), 'notas' (notas de validacion). Uselo antes de proponer cambios de plan o de comentar la comida.",
		schema: { type: "object", properties: { doc: { type: "string", description: "Ruta del documento, p. ej. estado/app" } }, required: ["doc"] },
		run: async (env, userId, { doc }) => {
			if (!APP_DOC.test(doc || "")) throw new HttpError(400, "Documento no valido");
			return (await env.GARMIN.get(appKey(userId, doc), "json")) ?? null;
		},
	},
	app_guardar: {
		title: "Guardar datos en myCoach",
		write: true,
		description:
			"Guarda un documento de la app myCoach para este usuario. Con 'fusionar' mezcla los campos de primer nivel con lo que ya hay (p. ej. solo 'meals' en estado/app); con 'anadir' agrega 'datos' al final de una lista (p. ej. notas). " +
			"PARA CAMBIAR EL PLAN USE coach_proponer, no esta herramienta: valida las reglas y guarda en el sitio correcto. Si aun asi escribe " +
			"'plan' (esta semana) o 'next' (la siguiente) en estado/app, el formato es { \"AAAA-MM-DD\": { dep, t, d, min } } con dep = bici|correr|skimo|fuerza, " +
			"t = rec|fondo|tempo|int|otros|descanso, d = descripcion corta y min = minutos. Escribe en la app del usuario: confirme con el antes los cambios.",
		schema: {
			type: "object",
			properties: {
				doc: { type: "string" },
				datos: { description: "Contenido JSON del documento" },
				fusionar: { type: "boolean" },
				anadir: { type: "boolean" },
				version: { type: "number", description: "Solo para la app: el 'at' que conoce. Si el documento ha cambiado desde entonces, no se guarda." },
			},
			required: ["doc", "datos"],
		},
		run: async (env, userId, { doc, datos, fusionar, anadir, version }) => {
			if (!APP_DOC.test(doc || "")) throw new HttpError(400, "Documento no valido");
			const key = appKey(userId, doc);
			const actual = await env.GARMIN.get(key, "json");
			// La app guarda el documento entero con lo que tiene en local. Si otro (tu Claude,
			// el entrenador) lo ha cambiado despues de que ella lo leyera, no se pisa: se le
			// dice que recargue. Asi un plan subido desde Claude no desaparece al abrir la web.
			if (typeof version === "number" && actual && typeof actual.at === "number" && actual.at !== version)
				return { ok: false, conflicto: true, doc, at: actual.at };
			let normalizado = 0;
			if (doc === "estado/app" && datos && typeof datos === "object" && !Array.isArray(datos)) {
				datos = { ...datos };
				for (const campo of ["plan", "next"]) {
					if (datos[campo] && typeof datos[campo] === "object") {
						const r = normalizarPlan(datos[campo], (datos.sports || actual?.sports || []).find((x) => DEPORTES_ENTRENABLES.has(x)));
						datos[campo] = r.plan;
						normalizado += r.cambiados;
					}
				}
			}
			let value = datos;
			if (anadir) value = [...(actual || []), datos].slice(-500);
			else if (fusionar && datos && typeof datos === "object") value = { ...(actual || {}), ...datos };
			// Sello de tiempo: la app sabe asi que hay cambios hechos desde Claude.
			if (value && typeof value === "object" && !Array.isArray(value)) value = { ...value, at: Date.now() };
			const text = JSON.stringify(value);
			if (text.length > 5_000_000) throw new HttpError(413, "Documento demasiado grande");
			await env.GARMIN.put(key, text);
			return { ok: true, doc, bytes: text.length, at: value?.at ?? null, ...(normalizado ? { sesiones_normalizadas: normalizado } : {}) };
		},
	},
	garmin_status: {
		title: "Estado de la conexion con Garmin",
		description:
			"Comprueba si hay una sesion valida de Garmin para quien pregunta y cuando se obtuvo. Uselo si cualquier otra herramienta falla con un error de autenticacion.",
		schema: { type: "object", properties: {} },
		run: async (env, userId) => {
			const user = await env.GARMIN.get(userKey(userId), "json");
			if (!user) return { connected: false, reason: sinGarmin().message };

			// Se comprueba contra Garmin de verdad: que exista un token guardado
			// no significa que siga siendo valido, y eso es justo lo que se
			// viene a diagnosticar aqui.
			try {
				return { connected: true, display_name: await displayName(env, userId), obtained_at: user.obtained_at };
			} catch (err) {
				return {
					connected: false,
					reason: err instanceof HttpError ? err.message : String(err),
					obtained_at: user.obtained_at,
				};
			}
		},
	},

	garmin_daily_summary: {
		title: "Resumen diario",
		description:
			"Resumen de un dia: pasos, calorias, pisos, minutos de intensidad, frecuencia cardiaca en reposo, estres medio y Body Battery (maximo y minimo). Es la herramienta por defecto para '?como he estado hoy?' o para comparar dias.",
		schema: {
			type: "object",
			properties: { date: { type: "string", description: "Dia en formato YYYY-MM-DD. Por defecto, hoy." } },
		},
		run: async (env, userId, { date }) => {
			const d = date || today();
			const s = await apiGet(env, userId, `/usersummary-service/usersummary/daily/${await displayName(env, userId)}`, {
				calendarDate: d,
			});
			return {
				date: d,
				steps: s.totalSteps ?? null,
				step_goal: s.dailyStepGoal ?? null,
				distance_km: round((s.totalDistanceMeters ?? 0) / 1000),
				calories_total: s.totalKilocalories ?? null,
				calories_active: s.activeKilocalories ?? null,
				floors_climbed: s.floorsAscended ?? null,
				intensity_minutes: (s.moderateIntensityMinutes ?? 0) + (s.vigorousIntensityMinutes ?? 0),
				resting_hr: s.restingHeartRate ?? null,
				min_hr: s.minHeartRate ?? null,
				max_hr: s.maxHeartRate ?? null,
				stress_avg: s.averageStressLevel ?? null,
				body_battery_high: s.bodyBatteryHighestValue ?? null,
				body_battery_low: s.bodyBatteryLowestValue ?? null,
			};
		},
	},

	garmin_sleep: {
		title: "Sueno de una noche",
		description:
			"Datos de sueno de una noche: horas totales, desglose por fases (profundo, ligero, REM, despierto), puntuacion de sueno y HRV nocturna. Uselo para preguntas sobre descanso, recuperacion o calidad del sueno.",
		schema: {
			type: "object",
			properties: { date: { type: "string", description: "Dia en formato YYYY-MM-DD (la noche que termina ese dia). Por defecto, hoy." } },
		},
		run: async (env, userId, { date }) => {
			const d = date || today();
			const data = await apiGet(env, userId, `/wellness-service/wellness/dailySleepData/${await displayName(env, userId)}`, {
				date: d,
				nonSleepBufferMinutes: "60",
			});
			const dto = data?.dailySleepDTO || {};
			const hours = (sec) => round((sec ?? 0) / 3600);
			return {
				date: d,
				sleep_hours: hours(dto.sleepTimeSeconds),
				deep_hours: hours(dto.deepSleepSeconds),
				light_hours: hours(dto.lightSleepSeconds),
				rem_hours: hours(dto.remSleepSeconds),
				awake_hours: hours(dto.awakeSleepSeconds),
				sleep_score: dto?.sleepScores?.overall?.value ?? null,
				avg_overnight_hrv: data?.avgOvernightHrv ?? null,
				resting_hr: data?.restingHeartRate ?? null,
			};
		},
	},

	garmin_activities: {
		title: "Actividades recientes",
		description:
			"Lista de las ultimas actividades registradas (carrera, ciclismo, fuerza, etc.) con duracion, distancia, ritmo cardiaco medio y maximo, calorias y efecto del entrenamiento. Devuelve un activity_id que puede pasarse a garmin_activity_detail.",
		schema: {
			type: "object",
			properties: { limit: { type: "integer", description: "Cuantas actividades devolver (1-300). Por defecto 10. Por encima de 50 se devuelve un formato compacto para recorrer el historico." } },
		},
		run: async (env, userId, { limit }) => {
			const n = Math.min(Math.max(limit || 10, 1), 300);
			const list = [];
			for (let desde = 0; desde < n; desde += 100) {
				const pagina = await apiGet(env, userId, "/activitylist-service/activities/search/activities", {
					start: String(desde),
					limit: String(Math.min(100, n - desde)),
				});
				list.push(...(pagina || []));
				if (!pagina || pagina.length < Math.min(100, n - desde)) break;
			}
			// Pedir más de 50 es para recorrer el histórico (mapas, recuentos):
			// entonces se devuelve lo justo para no llenar la conversación.
			if (n > 50)
				return list.map((a) => ({
					id: a.activityId,
					t: a.activityType?.typeKey ?? null,
					d: (a.startTimeLocal || "").slice(0, 10),
					km: round((a.distance ?? 0) / 1000, 1),
					min: Math.round((a.duration ?? 0) / 60),
					fc: a.averageHR ?? null,
					te: a.trainingEffectLabel ?? null,
					n: a.activityName,
				}));
			return list.map((a) => ({
				activity_id: a.activityId,
				name: a.activityName,
				type: a.activityType?.typeKey ?? null,
				start: a.startTimeLocal,
				duration_min: round((a.duration ?? 0) / 60, 1),
				distance_km: round((a.distance ?? 0) / 1000),
				calories: a.calories ?? null,
				avg_hr: a.averageHR ?? null,
				max_hr: a.maxHR ?? null,
				aerobic_training_effect: a.aerobicTrainingEffect ?? null,
				anaerobic_training_effect: a.anaerobicTrainingEffect ?? null,
				tipo_sesion_garmin: a.trainingEffectLabel ?? null,
			}));
		},
	},

	garmin_activity_detail: {
		title: "Detalle de una actividad",
		description:
			"Todas las metricas de UNA actividad (activity_id de garmin_activities): velocidad, ritmo, potencia, cadencia, pulso, " +
			"desnivel, velocidad vertical, dinamicas de carrera, temperatura, efecto de entrenamiento y stamina de Garmin cuando " +
			"existan. 'series' resume cada grafica (min, media, max, inicio, final) y 'perfil' da sus valores a lo largo de la " +
			"actividad (24 tramos): uselo para contestar sobre graficas (stamina, pulso, potencia...) en vez de pedir capturas.",
		schema: {
			type: "object",
			properties: { activity_id: { type: "string", description: "El activity_id devuelto por garmin_activities." } },
			required: ["activity_id"],
		},
		run: async (env, userId, { activity_id }) => {
			const id = encodeURIComponent(activity_id);
			// El resumen manda: si las series o las zonas fallan, la respuesta
			// sigue saliendo con lo básico.
			const [a, zonas, details] = await Promise.all([
				apiGet(env, userId, `/activity-service/activity/${id}`),
				apiGet(env, userId, `/activity-service/activity/${id}/hrTimeInZones`).catch(() => null),
				apiGet(env, userId, `/activity-service/activity/${id}/details`, { maxChartSize: "3000", maxPolylineSize: "0" }).catch(() => null),
			]);
			const s = a?.summaryDTO || {};
			let analisis = null;
			try { analisis = details ? analizarActividad(details) : null; } catch (err) { analisis = { error: String(err) }; }
			return {
				activity_id,
				name: a?.activityName ?? null,
				type: a?.activityTypeDTO?.typeKey ?? null,
				start: s.startTimeLocal ?? null,
				duration_min: round((s.duration ?? 0) / 60, 1),
				distance_km: round((s.distance ?? 0) / 1000),
				avg_speed_kmh: round((s.averageSpeed ?? 0) * 3.6),
				elevation_gain_m: round(s.elevationGain, 0),
				avg_hr: s.averageHR ?? null,
				max_hr: s.maxHR ?? null,
				calories: s.calories ?? null,
				avg_power: s.averagePower ?? null,
				training_effect: s.trainingEffect ?? null,
				anaerobic_training_effect: s.anaerobicTrainingEffect ?? null,
				tipo_sesion_garmin: s.trainingEffectLabel ?? a?.trainingEffectLabel ?? null,
				metricas: metricasGarmin(s, a?.activityTypeDTO?.typeKey),
				...(() => { try { return details ? seriesCompletas(details) : { series: [], perfil: null }; } catch (err) { return { series: [], perfil: null, error_series: String(err) }; } })(),
				zonas_fc: Array.isArray(zonas)
					? zonas.map((z) => ({ zona: z.zoneNumber, desde_ppm: z.zoneLowBoundary, minutos: round((z.secsInZone ?? 0) / 60, 1) }))
					: null,
				analisis,
			};
		},
	},

	garmin_body_battery: {
		title: "Body Battery por dias",
		description:
			"Evolucion de la Body Battery (reserva de energia) a lo largo de varios dias, con maximo, minimo, carga y descarga. Uselo para ver tendencias de energia y recuperacion.",
		schema: {
			type: "object",
			properties: { days: { type: "integer", description: "Cuantos dias hacia atras, contando hoy (1-28). Por defecto 7." } },
		},
		run: async (env, userId, { days }) => {
			const n = Math.min(Math.max(days || 7, 1), 28);
			const data = await apiGet(env, userId, "/wellness-service/wellness/bodyBattery/reports/daily", {
				startDate: daysAgo(n - 1),
				endDate: today(),
			});
			return (data || []).map((d) => ({
				date: d.date ?? null,
				charged: d.charged ?? null,
				drained: d.drained ?? null,
				highest: d.bodyBatteryStat?.highestValue ?? null,
				lowest: d.bodyBatteryStat?.lowestValue ?? null,
			}));
		},
	},

	garmin_hrv: {
		title: "HRV de una noche",
		description:
			"Variabilidad de la frecuencia cardiaca (HRV) de una noche, con su estado respecto a la linea base personal. Es el mejor indicador para preguntas sobre recuperacion, fatiga acumulada o si conviene entrenar fuerte.",
		schema: {
			type: "object",
			properties: { date: { type: "string", description: "Dia en formato YYYY-MM-DD. Por defecto, hoy." } },
		},
		run: async (env, userId, { date }) => {
			const d = date || today();
			const data = await apiGet(env, userId, `/hrv-service/hrv/${d}`);
			const s = data?.hrvSummary || {};
			return {
				date: d,
				last_night_avg: s.lastNightAvg ?? null,
				last_night_5min_high: s.lastNight5MinHigh ?? null,
				status: s.status ?? null,
				baseline_low: s.baseline?.lowUpper ?? null,
				baseline_high: s.baseline?.balancedUpper ?? null,
			};
		},
	},

	garmin_activity_route: {
		title: "Por donde paso una actividad",
		description:
			"Devuelve el recorrido real de una actividad ya hecha, reducido a unos pocos puntos de paso representativos. Uselo cuando el usuario quiera repetir, variar o inspirarse en una salida concreta: esos puntos se pueden pasar tal cual a garmin_plan_route. Las carreteras por las que el usuario ya ha pasado son mejor prueba de lo que le gusta que cualquier suposicion.",
		schema: {
			type: "object",
			properties: {
				activity_id: { type: "string", description: "El activity_id devuelto por garmin_activities." },
				puntos: { type: "integer", description: "Cuantos puntos de paso devolver (5-40). Por defecto 15." },
			},
			required: ["activity_id"],
		},
		run: async (env, userId, { activity_id, puntos }) => {
			const cuantos = Math.min(Math.max(puntos || 15, 5), 40);
			const data = await apiGet(
				env,
				userId,
				`/activity-service/activity/${encodeURIComponent(activity_id)}/details`,
				{ maxChartSize: "0", maxPolylineSize: "500" },
			);

			const linea = data?.geoPolylineDTO?.polyline || [];
			if (linea.length < 2) throw new HttpError(404, "Esa actividad no tiene trazado guardado.");

			// Se reparten los puntos a lo largo del recorrido: la forma se
			// conserva y el resultado cabe en una conversacion.
			const paso = (linea.length - 1) / (cuantos - 1);
			const waypoints = Array.from({ length: cuantos }, (_, i) => {
				const p = linea[Math.round(i * paso)];
				return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
			});

			return {
				activity_id,
				waypoints,
				// El mismo recorrido con más puntos y comprimido (polilínea de Google,
				// precisión 1e-5): cabe el trazado de muchas salidas en poco texto,
				// que es lo que hace falta para mapas de lo recorrido.
				polilinea: codificarPolilinea(linea.filter((_, i) => i % Math.max(1, Math.floor(linea.length / 120)) === 0 || i === linea.length - 1)),
				distancia_km: round((data?.summaryDTO?.distance ?? 0) / 1000),
				desnivel_m: round(data?.summaryDTO?.elevationGain, 0),
				nota: "Puntos del recorrido real. Paselos a garmin_plan_route para repetirlo, o quite y anada alguno para variarlo.",
			};
		},
	},

	garmin_plan_route: {
		title: "Trazar y medir una ruta de bici",
		description:
			"Traza una ruta de bici entre los puntos de paso indicados siguiendo carreteras reales, y devuelve sus metricas: distancia, desnivel acumulado, numero de semaforos y tipos de carretera, mas un perfil resumido de 40 puntos [km, altitud, lat, lon] para poder decir donde estan las subidas. El trazado completo no se devuelve: se guarda como GPX con un route_id y un enlace de descarga. Uselo de forma iterativa — proponga puntos, lea las metricas, ajuste los puntos y vuelva a llamar hasta que la distancia y el desnivel cuadren con lo pedido. Para una ruta circular, repita el punto de salida al final.",
		schema: {
			type: "object",
			properties: {
				waypoints: {
					type: "array",
					items: { type: "string" },
					description:
						'Puntos de paso en orden, cada uno como "latitud,longitud" (ej. "41.4914,2.1408"). Minimo 2. Para un circuito, el ultimo debe ser igual al primero.',
				},
				profile: {
					type: "string",
					description:
						"fastbike (carretera, rapido y directo), trekking (equilibrado) o safety (prioriza evitar trafico). Por defecto fastbike.",
				},
				name: { type: "string", description: "Nombre para la ruta. Por defecto, uno generico." },
			},
			required: ["waypoints"],
		},
		run: async (env, userId, { waypoints, profile, name }) => {
			if (!Array.isArray(waypoints) || waypoints.length < 2)
				throw new HttpError(400, "Hacen falta al menos dos puntos de paso.");
			if (waypoints.length > 30) throw new HttpError(400, "Demasiados puntos de paso (maximo 30).");

			const chosen = ROUTE_PROFILES[profile] ? profile : "fastbike";
			const route = await routeVia(waypoints.map(parsePoint), chosen);
			const routeName = name || `Ruta ${route.distance_km} km`;

			const id = randomToken();
			await env.GARMIN.put(
				routeKey(id),
				JSON.stringify({ userId, name: routeName, profile: chosen, ...route }),
				{ expirationTtl: 60 * 60 * 24 * 30 },
			);

			return {
				route_id: id,
				name: routeName,
				profile: chosen,
				distance_km: route.distance_km,
				elevation_gain_m: route.elevation_gain_m,
				traffic_signals: route.traffic_signals,
				road_types: route.road_types,
				points: route.coords.length,
				perfil: perfilResumido(route.coords, 40),
				gpx_url: `${env.PUBLIC_ORIGIN || ""}/route/${id}.gpx`,
				next_step:
					"Si la distancia o el desnivel no cuadran, ajuste los puntos de paso y vuelva a llamar. " +
					"Cuando convenga, use garmin_save_course para subirla a Garmin.",
			};
		},
	},

	garmin_save_course: {
		title: "Guardar una ruta en Garmin Connect",
		// La unica herramienta que escribe. El resto solo lee, y el cliente
		// usa esta marca para decidir si puede llamarla sin preguntar.
		write: true,
		description:
			"Sube una ruta ya trazada (por su route_id) a Garmin Connect como recorrido, para poder enviarla al dispositivo. ESCRIBE en la cuenta del usuario: pida su confirmacion explicita antes de llamar, y pase confirm=true solo cuando la haya dado.",
		schema: {
			type: "object",
			properties: {
				route_id: { type: "string", description: "El route_id devuelto por garmin_plan_route." },
				confirm: { type: "boolean", description: "Debe ser true, y solo tras que el usuario lo autorice." },
			},
			required: ["route_id", "confirm"],
		},
		run: async (env, userId, { route_id, confirm }) => {
			if (confirm !== true) throw new HttpError(400, "Falta la confirmacion explicita del usuario.");

			const route = await env.GARMIN.get(routeKey(route_id), "json");
			if (!route) throw new HttpError(404, "No existe esa ruta (o ha caducado). Vuelva a trazarla.");
			if (route.userId !== userId) throw new HttpError(403, "Esa ruta pertenece a otro usuario.");

			// Los recorridos de Garmin no necesitan la densidad del router, y
			// un cuerpo enorme es la forma mas facil de que rechace la subida.
			// Se mide sobre el trazado COMPLETO, no sobre el submuestreado: las
			// rectas entre los puntos que se conservan recortan las curvas y
			// acortan la ruta cerca de un 1%. Cada punto conservado se queda
			// con su distancia real, no con la del atajo.
			const acumuladas = [0];
			for (let i = 1; i < route.coords.length; i++)
				acumuladas.push(acumuladas[i - 1] + metresBetween(route.coords[i - 1], route.coords[i]));

			const step = Math.ceil(route.coords.length / 1000);
			const indices = route.coords
				.map((_, i) => i)
				.filter((i) => i % step === 0 || i === route.coords.length - 1);

			// Garmin calcula distancia y desnivel a partir del campo `distance`
			// de cada punto, no del total que se le manda: dejandolo a null,
			// el recorrido aparecia con 0 km y 0 m de desnivel aunque el perfil
			// de elevacion se dibujase bien. Es la distancia acumulada desde
			// el inicio, y se mide sobre los puntos ya submuestreados para que
			// cuadre con la linea que Garmin acaba guardando.
			// El desnivel tambien se acumula sobre el trazado completo, por el
			// mismo motivo: saltarse puntos se come subidas y bajadas cortas.
			let desnivelPositivo = 0;
			let desnivelNegativo = 0;
			for (let i = 1; i < route.coords.length; i++) {
				const salto = (route.coords[i][2] ?? 0) - (route.coords[i - 1][2] ?? 0);
				if (salto > 0) desnivelPositivo += salto;
				else desnivelNegativo -= salto;
			}

			const recorrido = acumuladas[acumuladas.length - 1];

			const geoPoints = indices.map((idx) => {
				const [lon, lat, ele] = route.coords[idx];
				return {
					longitude: lon,
					latitude: lat,
					...(ele != null ? { elevation: ele } : {}),
					distance: Number(acumuladas[idx].toFixed(1)),
				};
			});

			const body = {
				courseName: route.name,
				description: `Trazada con perfil ${route.profile}.`,
				// Nombres tomados del recorrido tal y como Garmin lo devuelve.
				// Se manda tambien `distance` porque el DTO de creacion y el de
				// lectura no tienen por que coincidir, y sobrar no cuesta nada.
				distance: Number(recorrido.toFixed(1)),
				distanceMeter: Number(recorrido.toFixed(1)),
				elevationGainMeter: Math.round(desnivelPositivo),
				elevationLossMeter: Math.round(desnivelNegativo),
				// Garmin guardaba el desnivel a cero aunque se lo enviara
				// relleno, y el recorrido sale con `elevationSource: 2`: parece
				// que el servidor lo recalcula por su cuenta. Con 1 se le pide
				// que respete la altitud que viene en los puntos.
				elevationSource: 1,
				activityTypePk: 2, // ciclismo
				// Los tres campos que Garmin exige y que no estan documentados
				// en ningun sitio: los dicta su propio error de validacion.
				rulePK: 2, // privacidad: 1 publica, 2 privada, 4 grupo
				sourceTypeId: 1,
				coordinateSystem: "WGS84",
				geoPoints,
				startPoint: geoPoints[0],
			};

			const res = await apiPost(env, userId, "/course-service/course", body);
			const courseId = res?.courseId ?? null;

			// Se relee lo que Garmin ha guardado de verdad. Subir sin mirar es
			// como se colaron una distancia un 1% corta y un desnivel a cero:
			// la subida decia "correcta" y el recorrido estaba mal.
			let guardado = null;
			if (courseId) {
				try {
					const c = await apiGet(env, userId, `/course-service/course/${courseId}`);
					guardado = {
						distancia_km: round((c?.distanceMeter ?? 0) / 1000, 2),
						desnivel_m: c?.elevationGainMeter ?? null,
					};
				} catch {
					// No poder comprobarlo no invalida la subida, que ya esta hecha.
					guardado = { error: "No se pudo releer el recorrido para comprobarlo." };
				}
			}

			return {
				saved: true,
				course_id: courseId,
				name: route.name,
				// Lo que Garmin dice tener, para poder contrastarlo con lo pedido.
				segun_garmin: guardado,
				hint: "Abre Garmin Connect y usa 'Enviar al dispositivo' para tenerla en el ciclocomputador.",
			};
		},
	},

	garmin_courses: {
		title: "Recorridos guardados en Garmin",
		description:
			"Lista los recorridos (courses) que el usuario tiene guardados en Garmin Connect, con nombre, distancia, desnivel y fecha. Devuelve un course_id que puede pasarse a garmin_course_detail. Uselo antes de proponer una ruta nueva, para no repetirle una que ya tiene, y para comprobar que una subida ha quedado bien.",
		schema: {
			type: "object",
			properties: { limit: { type: "integer", description: "Cuantos recorridos devolver (1-50). Por defecto 20." } },
		},
		run: async (env, userId, { limit }) => {
			const n = Math.min(Math.max(limit || 20, 1), 50);
			const nombre = await displayName(env, userId);
			const params = { includeGeoPoints: "false", start: "1", limit: String(n) };

			// El servicio de recorridos no esta documentado y no responde en
			// una sola ruta segun la version de la app que se imite. Se prueban
			// las conocidas y se devuelve cual ha contestado: si Garmin la
			// cambia, el error dira exactamente que se intento.
			const candidatos = [
				`/course-service/course/owner/${encodeURIComponent(nombre)}`,
				"/course-service/course/owner",
				"/web-gateway/course/owner",
			];

			let datos = null;
			let usado = null;
			const fallos = [];
			for (const path of candidatos) {
				try {
					datos = await apiGet(env, userId, path, params);
					usado = path;
					break;
				} catch (e) {
					fallos.push(`${path} (${e.message})`);
				}
			}
			if (datos == null)
				throw new HttpError(502, `Garmin no devolvio la lista de recorridos. Se intento: ${fallos.join("; ")}`);

			const lista = Array.isArray(datos)
				? datos
				: datos.coursesForUser ?? datos.courses ?? datos.content ?? [];

			return { endpoint: usado, total: lista.length, courses: lista.slice(0, n).map(resumirCourse) };
		},
	},

	garmin_course_detail: {
		title: "Por donde va un recorrido guardado",
		description:
			"Devuelve un recorrido guardado de Garmin Connect: sus metricas y su trazado reducido a unos pocos puntos de paso. Esos puntos se pueden pasar tal cual a garmin_plan_route para variarlo o rehacerlo sin partir de cero.",
		schema: {
			type: "object",
			properties: {
				course_id: {
					type: "string",
					description: "El course_id devuelto por garmin_courses o por garmin_save_course.",
				},
				puntos: { type: "integer", description: "Cuantos puntos de paso devolver (5-40). Por defecto 15." },
			},
			required: ["course_id"],
		},
		run: async (env, userId, { course_id, puntos }) => {
			const cuantos = Math.min(Math.max(puntos || 15, 5), 40);
			const path = `/course-service/course/${encodeURIComponent(String(course_id))}`;

			// Se pide el trazado explicitamente; si ese parametro no le gusta,
			// se repite sin el antes de darlo por perdido.
			let c;
			try {
				c = await apiGet(env, userId, path, { includeGeoPoints: "true" });
			} catch {
				c = await apiGet(env, userId, path);
			}

			const resumen = resumirCourse(c || {});
			const linea = c?.geoPoints || [];
			if (linea.length < 2)
				return { ...resumen, waypoints: [], nota: "Garmin no ha devuelto el trazado de este recorrido." };

			// Mismo reparto que en las actividades: la forma se conserva y el
			// resultado cabe en una conversacion.
			const paso = (linea.length - 1) / (cuantos - 1);
			const waypoints = Array.from({ length: cuantos }, (_, i) => {
				const p = linea[Math.round(i * paso)];
				return `${Number(p.latitude).toFixed(4)},${Number(p.longitude).toFixed(4)}`;
			});

			return {
				...resumen,
				waypoints,
				nota: "Puntos del recorrido guardado. Paselos a garmin_plan_route para variarlo.",
			};
		},
	},

	garmin_training_readiness: {
		title: "Preparacion para entrenar",
		description:
			"Puntuacion de Training Readiness (0-100) de Garmin para un dia, con los factores que la componen (sueno, HRV, carga aguda, recuperacion). Responde directamente a '?estoy listo para entrenar hoy?'.",
		schema: {
			type: "object",
			properties: { date: { type: "string", description: "Dia en formato YYYY-MM-DD. Por defecto, hoy." } },
		},
		run: async (env, userId, { date }) => {
			const d = date || today();
			const [data, maxmet, endurance, hill, estado, ajustes] = await Promise.all([
				apiGet(env, userId, `/metrics-service/metrics/trainingreadiness/${d}`),
				apiGet(env, userId, `/metrics-service/metrics/maxmet/daily/${d}/${d}`).catch((e) => ({ error: e.message })),
				apiGet(env, userId, "/metrics-service/metrics/endurancescore", { calendarDate: d }).catch((e) => ({ error: e.message })),
				apiGet(env, userId, "/metrics-service/metrics/hillscore", { calendarDate: d }).catch((e) => ({ error: e.message })),
				apiGet(env, userId, `/metrics-service/metrics/trainingstatus/aggregated/${d}`).catch((e) => ({ error: e.message })),
				apiGet(env, userId, "/userprofile-service/userprofile/user-settings").catch((e) => ({ error: e.message })),
			]);
			const r = Array.isArray(data) ? data[0] : data;
			const vo2 = Array.isArray(maxmet) ? maxmet[0] : maxmet;
			return {
				date: d,
				score: r?.score ?? null,
				level: r?.level ?? null,
				sleep_score: r?.sleepScore ?? null,
				hrv_factor: r?.hrvFactorPercent ?? null,
				recovery_time_hours: r?.recoveryTime ? round(r.recoveryTime / 60, 1) : null,
				acute_load: r?.acuteLoad ?? null,
				// Lo que Garmin ya puntúa por su cuenta, interpretado.
				perfil_garmin: perfilGarmin({ vo2, endurance, hill, estado, ajustes, fecha: d }),
			};
		},
	},
};

// ──────────────────────────── MCP (JSON-RPC) ────────────────────────────

/**
 * La version lleva una huella de las herramientas (nombre, descripcion y esquema).
 * Claude guarda la lista de herramientas y, sin cambio de version, sigue con la vieja
 * aunque despleguemos herramientas nuevas: asi ve que el servidor ha cambiado.
 */
let serverInfoMemo = null;
function serverInfo() {
	if (serverInfoMemo) return serverInfoMemo;
	const texto = JSON.stringify(Object.entries(TOOLS).map(([n, t]) => [n, t.description, t.schema]));
	let h = 0x811c9dc5;
	for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
	return (serverInfoMemo = { name: "garmin", title: "Garmin Connect", version: `1.1.0+${h.toString(16).padStart(8, "0")}` });
}
const DEFAULT_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];

// resultType lo exige la revision 2026-07-28 en todos los resultados; para las
// anteriores es un campo mas. Sin el, un cliente nuevo rechaza la respuesta.
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result: { resultType: "complete", ...result } });
// Versiones que se anuncian en server/discover: solo las que el servidor cumple
// entero. Anunciar 2026-07-28 hizo que Claude validara con sus reglas y
// rechazara las respuestas; con estas, el cliente sigue con initialize.
const VERSIONES_DESCUBRIMIENTO = SUPPORTED_PROTOCOLS.filter((v) => v !== "2026-07-28");
// Cache de MCP (2026-07-28): sin ttlMs, cada cliente decide y Claude guardaba
// la lista y la pantalla hasta reconectar. Un minuto basta para no repetir
// peticiones y deja ver un despliegue enseguida.
const CACHE_LISTA = { ttlMs: 60 * 1000, cacheScope: "public" };
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(message, env, userId) {
	const { id, method, params } = message;

	const capacidades = { tools: { listChanged: false }, resources: { listChanged: false } };
	const instrucciones = async () =>
				"Datos de Garmin Connect del usuario que ha autorizado este conector. Las fechas van en " +
				"YYYY-MM-DD y por defecto es hoy. Para preguntas sobre descanso use garmin_sleep y garmin_hrv; " +
				"para carga y rendimiento, garmin_activities y garmin_training_readiness. Si una herramienta " +
				"falla con error de autenticacion, llame a garmin_status para diagnosticar.\n\n" +
				"Para planificar rutas de bici: proponga usted los puntos de paso a partir de su conocimiento " +
				"geografico y llame a garmin_plan_route, que los une por carreteras reales y devuelve las " +
				"metricas. No invente el trazado ni suponga la distancia: la que cuenta es la que mide la " +
				"herramienta. Si no cuadra con lo pedido, mueva los puntos y repita. Para saber de donde sale " +
				"el usuario habitualmente, mire garmin_activities. Guardar la ruta en Garmin (garmin_save_course) " +
				"Los recorridos ya guardados se leen con garmin_courses y garmin_course_detail: mirelos antes " +
				"de proponer una ruta nueva, para no repetir una que el usuario ya tiene. " +
				"escribe en su cuenta: pida permiso antes." +
				instruccionesCoach(await nombreEntrenador(env, userId).catch(() => NOMBRE_COACH));

	if (method === "initialize") {
		const asked = params?.protocolVersion;
		return rpcResult(id, {
			protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : DEFAULT_PROTOCOL,
			capabilities: capacidades,
			serverInfo: serverInfo(),
			instructions: await instrucciones(),
		});
	}

	// MCP 2026-07-28: descubrimiento sin sesion. Las instrucciones llevan el
	// nombre del entrenador de cada usuario: privado.
	if (method === "server/discover")
		return rpcResult(id, {
			resultType: "complete",
			supportedVersions: VERSIONES_DESCUBRIMIENTO,
			capabilities: capacidades,
			_meta: { "io.modelcontextprotocol/serverInfo": serverInfo() },
			instructions: await instrucciones(),
			...CACHE_LISTA,
			cacheScope: "private",
		});

	if (method === "tools/list") {
		const ui = await uriApp(env);
		return rpcResult(id, {
			resultType: "complete",
			...CACHE_LISTA,
			tools: Object.entries(TOOLS).map(([name, t]) => ({
				name,
				title: t.title,
				description: t.description,
				inputSchema: t.schema,
				annotations: { readOnlyHint: t.write !== true, destructiveHint: false },
				// MCP Apps: la herramienta se enseña con una pantalla (ui://) si el cliente sabe.
				...(t.ui ? { _meta: { ui: { resourceUri: ui }, "ui/resourceUri": ui } } : {}),
			})),
		});
	}

	if (method === "resources/list") {
		const ui = await uriApp(env);
		return rpcResult(id, { resultType: "complete", ...CACHE_LISTA, resources: RECURSOS_UI.map((r) => ({ ...r, uri: ui, _meta: metaApp(env, r._meta) })) });
	}

	if (method === "resources/read") {
		// Vale cualquier version: se sirve siempre la ultima.
		const uri = String(params?.uri || "");
		const recurso = RECURSOS_UI.find((r) => uri === r.uri || uri.startsWith(`${r.uri}?v=`));
		if (!recurso) return rpcError(id, -32602, `Recurso desconocido: ${params?.uri}`);
		// ttlMs 0: la pantalla se pide fresca cada vez, para ver lo recien desplegado.
		return rpcResult(id, {
			resultType: "complete",
			ttlMs: 0,
			cacheScope: "public",
			contents: [{ uri, mimeType: recurso.mimeType, text: await htmlDeLaApp(env), _meta: metaApp(env, recurso._meta) }],
		});
	}

	if (method === "tools/call") {
		const tool = TOOLS[params?.name];
		if (!tool) return rpcError(id, -32602, `Herramienta desconocida: ${params?.name}`);

		try {
			const data = await tool.run(env, userId, params.arguments || {});
			return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
		} catch (err) {
			return rpcResult(id, {
				content: [{ type: "text", text: err instanceof HttpError ? err.message : String(err) }],
				isError: true,
			});
		}
	}

	if (method === "ping") return rpcResult(id, {});
	return rpcError(id, -32601, `Metodo no soportado: ${method}`);
}

// ───────────────────────── OAuth 2.1: almacenamiento ─────────────────────────

const ACCESS_TTL = 60 * 60 * 8;
const REFRESH_TTL = 60 * 60 * 24 * 60;
const CODE_TTL = 60 * 5;
const MFA_TTL = 60 * 10;

const userKey = (id) => `user:${id}`;
// Documentos de la app myCoach, por usuario. Rutas cortas tipo "estado/app".
const APP_DOC = /^[a-z0-9-]{1,32}(\/[a-z0-9-]{1,32})?$/;
const appKey = (id, doc) => `app:${id}:${doc}`;
const burnKey = (hash) => `burnt:${hash}`;
const refreshKey = (hash) => `refresh:${hash}`;
const mfaKey = (id) => `mfa:${id}`;
const routeKey = (id) => `route:${id}`;

function randomToken(prefix = "") {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return prefix + base64url(bytes);
}

function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromBase64url(value) {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * Credenciales firmadas en vez de guardadas.
 *
 * El KV de Cloudflare es eventualmente consistente: una escritura tarda
 * hasta 60s en verse desde otra parte del mundo. El handshake OAuth cruza
 * justo esa frontera — el usuario autoriza desde su pais y Claude canjea el
 * codigo desde los servidores de Anthropic — asi que guardar el codigo o el
 * token era una carrera que unas veces se gana y otras no. Firmandolos,
 * validarlos es comprobar una firma: cero lecturas, cero carreras.
 */
async function signingKey(env) {
	if (!env.SIGNING_KEY) throw new HttpError(500, "Falta el secreto 'SIGNING_KEY'.");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.SIGNING_KEY),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

async function signBlob(env, payload) {
	const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
	const sig = await crypto.subtle.sign("HMAC", await signingKey(env), new TextEncoder().encode(body));
	return `${body}.${base64url(new Uint8Array(sig))}`;
}

/** Devuelve el contenido, o null si la firma no cuadra o ya ha caducado. */
async function readBlob(env, token) {
	const [body, sig] = String(token || "").split(".");
	if (!body || !sig) return null;

	let valid;
	try {
		valid = await crypto.subtle.verify(
			"HMAC",
			await signingKey(env),
			bytesFromBase64url(sig),
			new TextEncoder().encode(body),
		);
	} catch {
		return null;
	}
	if (!valid) return null;

	try {
		const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64url(body)));
		if (payload.exp && payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

async function sha256Hex(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return base64url(new Uint8Array(digest));
}

/** El id de usuario es un hash del email: asi no se guarda el email en claro. */
const userIdFor = (email) => sha256Hex(email.trim().toLowerCase());

// ───────────────────────── OAuth 2.1: endpoints ─────────────────────────

const HTML = { "Content-Type": "text/html; charset=utf-8" };

const json = (data, status = 200) =>
	new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
	});

function metadata(origin) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
	};
}

const isAcceptableRedirect = (uri) => {
	try {
		const u = new URL(uri);
		if (u.protocol === "https:") return true;
		return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
	} catch {
		return false;
	}
};

/**
 * Registro dinamico. Claude lo llama solo al pegar la URL, que es lo que hace
 * que no haya que repartir client ids. Registrar es abierto a proposito: un
 * cliente registrado no es una credencial — lo que protege los datos es el
 * login de Garmin en /oauth/authorize mas PKCE.
 */
async function handleRegister(request, env) {
	const body = await request.json().catch(() => null);
	const uris = Array.isArray(body?.redirect_uris)
		? body.redirect_uris.filter((u) => typeof u === "string")
		: [];

	if (uris.length === 0 || !uris.every(isAcceptableRedirect))
		return json({ error: "invalid_redirect_uri" }, 400);

	// El propio client_id lleva dentro (firmadas) las redirect_uris, asi que
	// autorizar no necesita leer nada.
	const clientId = "client_" + (await signBlob(env, { uris }));
	const clientSecret = randomToken("secret_");

	return json(
		{
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uris: uris,
			token_endpoint_auth_method: "client_secret_post",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
		201,
	);
}

function readAuthorizeParams(source) {
	const clientId = source.get("client_id");
	const redirectUri = source.get("redirect_uri");
	const codeChallenge = source.get("code_challenge");
	const method = source.get("code_challenge_method") ?? "S256";

	// PKCE obligatorio y solo S256: "plain" anula el sentido del challenge.
	if (!clientId || !redirectUri || !codeChallenge || method !== "S256") return null;
	return { clientId, redirectUri, state: source.get("state") ?? "", codeChallenge };
}

async function clientAllows(env, clientId, redirectUri) {
	const client = await readBlob(env, String(clientId).replace(/^client_/, ""));
	// Coincidencia exacta, nunca por prefijo: un "empieza por" es como se
	// fabrican los open redirect, y un open redirect aqui filtra el codigo.
	return Boolean(client?.uris) && client.uris.includes(redirectUri);
}

/** Emite el codigo de autorizacion y devuelve el redirect al cliente. */
async function issueCodeAndRedirect(env, params, userId) {
	const code = await signBlob(env, {
		clientId: params.clientId,
		userId,
		redirectUri: params.redirectUri,
		codeChallenge: params.codeChallenge,
		// Por el mismo motivo que el token: ademas, la marca de "ya usado" se
		// indexa por el hash del codigo, y dos codigos iguales la compartirian.
		nonce: randomToken(),
		exp: Date.now() + CODE_TTL * 1000,
	});

	const location = new URL(params.redirectUri);
	location.searchParams.set("code", code);
	if (params.state) location.searchParams.set("state", params.state);
	return new Response(null, { status: 302, headers: { Location: location.toString() } });
}

// ───────────────────────── Cuentas de myCoach ─────────────────────────
//
// Entras en myCoach con tu email y tu contrasena de myCoach; Garmin e
// Intervals.icu son fuentes que vinculas desde la app. Asi conectar Claude no
// depende del login de Garmin (que a veces pide captcha a los servidores), y
// cuando haya acceso oficial a Garmin solo cambia como se vincula.
// El id sigue siendo el hash del email: quien ya entraba con Garmin conserva
// sus datos al crear su contrasena.

const cuentaKey = (id) => `cuenta:${id}`;
const intentosKey = (id) => `intentos:${id}`;
// El maximo que permite Workers.
const PBKDF2_ITER = 100000;
const MAX_INTENTOS = 10;
const INTENTOS_TTL = 60 * 15;
const MODOS = new Set(["entrar", "crear", "garmin"]);

async function derivarClave(password, salt, iter) {
	const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 256);
	return base64url(new Uint8Array(bits));
}

async function guardarContrasena(env, userId, password) {
	if (typeof password !== "string" || password.length < 8)
		throw new HttpError(400, "La contraseña necesita al menos 8 caracteres.");
	if (password.length > 200) throw new HttpError(400, "La contraseña es demasiado larga.");
	const salt = crypto.getRandomValues(new Uint8Array(16));
	await env.GARMIN.put(
		cuentaKey(userId),
		JSON.stringify({
			salt: base64url(salt),
			hash: await derivarClave(password, salt, PBKDF2_ITER),
			iter: PBKDF2_ITER,
			at: new Date().toISOString(),
		}),
	);
}

const igualSeguro = (a, b) => {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
};

/** Lanza 401 si no cuadra y 429 tras demasiados fallos seguidos. */
async function comprobarContrasena(env, userId, cuenta, password) {
	const fallos = Number(await env.GARMIN.get(intentosKey(userId))) || 0;
	if (fallos >= MAX_INTENTOS) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos y vuelve a probar.");
	const hash = await derivarClave(String(password || ""), bytesFromBase64url(cuenta.salt), cuenta.iter);
	if (!igualSeguro(hash, cuenta.hash)) {
		await env.GARMIN.put(intentosKey(userId), String(fallos + 1), { expirationTtl: INTENTOS_TTL });
		throw new HttpError(401, "Email o contraseña incorrectos.");
	}
	if (fallos) await env.GARMIN.delete(intentosKey(userId));
}

/** Vincula Garmin a una cuenta: con el login de Garmin (y MFA si lo pide). */
async function vincularGarmin(env, userId, body) {
	if (body.pendiente) {
		const pending = await env.GARMIN.get(mfaKey(String(body.pendiente)), "json");
		if (!pending || pending.userId !== userId) throw new HttpError(400, "La verificación ha caducado. Empieza de nuevo.");
		const ticket = await ssoVerifyMfa(String(body.codigo || ""), pending.method, pending.cookie, pending.flowName);
		await env.GARMIN.put(userKey(userId), JSON.stringify(await exchangeTicket(ticket, pending.flowName)));
		await env.GARMIN.delete(mfaKey(String(body.pendiente)));
		return { ok: true };
	}
	const email = String(body.email || "").trim();
	const password = String(body.password || "");
	if (!email || !password) throw new HttpError(400, "Pon el email y la contraseña de Garmin.");
	const result = await ssoLogin(email, password);
	if (result.mfaRequired) {
		const id = randomToken();
		await env.GARMIN.put(
			mfaKey(id),
			JSON.stringify({ method: result.mfaMethod, cookie: result.cookie, userId, flowName: result.flowName }),
			{ expirationTtl: MFA_TTL },
		);
		return { mfa: true, pendiente: id, metodo: result.mfaMethod };
	}
	await env.GARMIN.put(userKey(userId), JSON.stringify(await exchangeTicket(result.ticket, result.flowName)));
	return { ok: true };
}

/**
 * La cuenta, para la app (con el Bearer del usuario). No son herramientas MCP
 * a proposito: las contrasenas no deben pasar por el chat.
 *   GET    /cuenta             → { contrasena, garmin: { vinculado, desde } }
 *   POST   /cuenta/contrasena  → { nueva, actual? }
 *   POST   /cuenta/garmin      → { email, password } | { pendiente, codigo }
 *   DELETE /cuenta/garmin
 */
async function handleCuenta(request, env, pathname) {
	const userId = await userForRequest(request, env);
	if (!userId) return json({ error: "unauthorized" }, 401);
	const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
	try {
		if (pathname === "/cuenta" && request.method === "GET") {
			const [cuenta, garmin] = await Promise.all([
				env.GARMIN.get(cuentaKey(userId), "json"),
				env.GARMIN.get(userKey(userId), "json"),
			]);
			return json({
				contrasena: Boolean(cuenta),
				garmin: garmin?.di_token ? { vinculado: true, desde: garmin.obtained_at || null } : { vinculado: false },
			});
		}
		if (pathname === "/cuenta/contrasena" && request.method === "POST") {
			const cuenta = await env.GARMIN.get(cuentaKey(userId), "json");
			// Cambiarla pide la actual; crearla basta con la sesion abierta.
			if (cuenta) await comprobarContrasena(env, userId, cuenta, body.actual);
			await guardarContrasena(env, userId, body.nueva);
			return json({ ok: true });
		}
		if (pathname === "/cuenta/garmin" && request.method === "POST") return json(await vincularGarmin(env, userId, body));
		if (pathname === "/cuenta/garmin" && request.method === "DELETE") {
			await env.GARMIN.delete(userKey(userId));
			return json({ ok: true });
		}
		return json({ error: "not_found" }, 404);
	} catch (err) {
		if (err instanceof HttpError) return json({ error: err.message }, err.status);
		throw err;
	}
}

const pagina = (html, status = 200) =>
	new Response(html, {
		status,
		// Que nadie la meta en un iframe para hacer pulsar "Entrar".
		headers: { ...HTML, "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" },
	});

async function handleAuthorize(request, env) {
	if (request.method === "GET") {
		const params = readAuthorizeParams(new URL(request.url).searchParams);
		if (!params) return new Response(errorPage("Faltan parametros de OAuth o PKCE."), { status: 400, headers: HTML });
		if (!(await clientAllows(env, params.clientId, params.redirectUri)))
			return new Response(errorPage("Cliente o redirect_uri no reconocido."), { status: 400, headers: HTML });
		const modo = new URL(request.url).searchParams.get("modo");
		return pagina(loginPage(params, null, MODOS.has(modo) ? modo : "entrar"));
	}

	const form = new URLSearchParams(await request.text());
	const params = readAuthorizeParams(form);
	if (!params) return new Response(errorPage("Faltan parametros de OAuth o PKCE."), { status: 400, headers: HTML });
	if (!(await clientAllows(env, params.clientId, params.redirectUri)))
		return new Response(errorPage("Cliente o redirect_uri no reconocido."), { status: 400, headers: HTML });

	// Sin modo es un formulario de antes (o el de MFA): el login de Garmin.
	const modo = MODOS.has(form.get("modo")) ? form.get("modo") : "garmin";

	try {
		// Segunda pantalla: el usuario ya paso la contrasena y vuelve con el codigo MFA.
		const pendingId = form.get("mfa_pending");
		if (pendingId) {
			const pending = await env.GARMIN.get(mfaKey(pendingId), "json");
			if (!pending)
				return new Response(loginPage(params, "La verificacion ha caducado. Empieza de nuevo."), {
					status: 400,
					headers: HTML,
				});

			const ticket = await ssoVerifyMfa(form.get("code") || "", pending.method, pending.cookie, pending.flowName);
			const tokens = await exchangeTicket(ticket, pending.flowName);
			await env.GARMIN.put(userKey(pending.userId), JSON.stringify(tokens));
			await env.GARMIN.delete(mfaKey(pendingId));
			return issueCodeAndRedirect(env, params, pending.userId);
		}

		const email = (form.get("email") || "").trim();
		const password = form.get("password") || "";
		if (!email || !password) return pagina(loginPage(params, "Rellena email y contrasena.", modo), 400);

		const userId = await userIdFor(email);

		if (modo === "entrar") {
			const cuenta = await env.GARMIN.get(cuentaKey(userId), "json");
			if (!cuenta)
				throw new HttpError(
					401,
					(await env.GARMIN.get(userKey(userId)))
						? "Aún no tienes contraseña de myCoach. Créala en la app (Ajustes, Tu cuenta) o entra esta vez con Garmin."
						: "Email o contraseña incorrectos.",
				);
			await comprobarContrasena(env, userId, cuenta, password);
			return issueCodeAndRedirect(env, params, userId);
		}

		if (modo === "crear") {
			// Si ya existe (tambien quien entraba solo con Garmin), no se pisa:
			// su contrasena se crea desde la app, con su sesion abierta.
			if ((await env.GARMIN.get(cuentaKey(userId))) || (await env.GARMIN.get(userKey(userId))))
				throw new HttpError(
					409,
					"Ya hay una cuenta con ese email. Entra con tu contraseña o, si aún no tienes, entra con Garmin y créala en la app.",
				);
			await guardarContrasena(env, userId, password);
			return issueCodeAndRedirect(env, params, userId);
		}

		const result = await ssoLogin(email, password);

		if (result.mfaRequired) {
			const id = randomToken();
			await env.GARMIN.put(
				mfaKey(id),
				JSON.stringify({
					method: result.mfaMethod,
					cookie: result.cookie,
					userId,
					flowName: result.flowName,
				}),
				{ expirationTtl: MFA_TTL },
			);
			return pagina(mfaPage(params, id, result.mfaMethod));
		}

		const tokens = await exchangeTicket(result.ticket, result.flowName);
		await env.GARMIN.put(userKey(userId), JSON.stringify(tokens));
		return issueCodeAndRedirect(env, params, userId);
	} catch (err) {
		const message = err instanceof HttpError ? err.message : "No se pudo completar la conexion.";
		const status = err instanceof HttpError ? err.status : 500;
		return pagina(loginPage(params, message, modo), status);
	}
}

async function handleToken(request, env) {
	const form = new URLSearchParams(await request.text());
	const grantType = form.get("grant_type");

	if (grantType === "refresh_token") {
		const presented = form.get("refresh_token");
		if (!presented) return json({ error: "invalid_request" }, 400);

		const hash = await sha256Hex(presented);
		const record = await env.GARMIN.get(refreshKey(hash), "json");
		if (!record) return json({ error: "invalid_grant" }, 400);

		// Rotacion: un refresh token se usa una sola vez.
		await env.GARMIN.delete(refreshKey(hash));
		return json(await issueTokens(env, record.clientId, record.userId));
	}

	if (grantType !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);

	const code = form.get("code");
	const clientId = form.get("client_id");
	const redirectUri = form.get("redirect_uri");
	const verifier = form.get("code_verifier");
	if (!code || !clientId || !redirectUri || !verifier) return json({ error: "invalid_request" }, 400);

	const record = await readBlob(env, code);
	if (!record?.userId) return json({ error: "invalid_grant" }, 400);

	// El codigo se quema en cuanto se presenta, antes de validar nada mas:
	// un intento fallido no puede repetirse probando otro verifier.
	// Es defensa en profundidad y no la principal —lo son PKCE, los cinco
	// minutos de vida y el redirect exacto— porque esta marca tarda en
	// propagarse por el KV igual que todo lo demas.
	const burnt = burnKey(await sha256Hex(code));
	if (await env.GARMIN.get(burnt)) return json({ error: "invalid_grant" }, 400);
	await env.GARMIN.put(burnt, "1", { expirationTtl: CODE_TTL });

	if (record.clientId !== clientId || record.redirectUri !== redirectUri)
		return json({ error: "invalid_grant" }, 400);
	if ((await sha256Base64Url(verifier)) !== record.codeChallenge)
		return json({ error: "invalid_grant" }, 400);

	return json(await issueTokens(env, clientId, record.userId));
}

/**
 * El access token va firmado (se valida sin leer nada); el refresh si se
 * guarda, porque se usa horas mas tarde y para entonces ha propagado de
 * sobra — y a cambio se puede revocar.
 */
async function issueTokens(env, clientId, userId) {
	// El `nonce` no es decorativo: sin el, el token es una funcion pura de
	// (usuario, caducidad), y dos emitidos en el mismo milisegundo salen
	// identicos. Cada token emitido debe ser un artefacto distinto.
	const accessToken = await signBlob(env, {
		userId,
		nonce: randomToken(),
		exp: Date.now() + ACCESS_TTL * 1000,
	});
	const refreshToken = randomToken("gmn_r_");

	await env.GARMIN.put(refreshKey(await sha256Hex(refreshToken)), JSON.stringify({ userId, clientId }), {
		expirationTtl: REFRESH_TTL,
	});

	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: ACCESS_TTL,
		refresh_token: refreshToken,
	};
}

/** Resuelve el Bearer presentado por Claude al usuario al que pertenece. */
async function userForRequest(request, env) {
	const header = request.headers.get("Authorization") || "";
	if (!header.startsWith("Bearer ")) return null;
	const payload = await readBlob(env, header.slice(7));
	// El codigo de autorizacion tambien lleva userId, pero no es un token.
	if (payload?.codeChallenge) return null;
	return payload?.userId ?? null;
}

// ──────────────────────────────── Paginas ────────────────────────────────

const escapeHtml = (v) =>
	v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: #fafaf9; color: #1c1917; margin: 0; padding: 32px 20px;
         display: flex; justify-content: center; }
  @media (prefers-color-scheme: dark) { body { background: #16150f; color: #f2ede6; } }
  main { width: 100%; max-width: 380px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { color: #57534e; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  @media (prefers-color-scheme: dark) { p { color: #a8a29e; } }
  label { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
          color: #57534e; margin: 0 0 6px; }
  @media (prefers-color-scheme: dark) { label { color: #a8a29e; } }
  input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 14px;
          border-radius: 12px; border: 1px solid #d6d3d1; background: #fff; color: inherit;
          margin: 0 0 16px; }
  @media (prefers-color-scheme: dark) { input { background: #221f18; border-color: #3b352b; } }
  button { width: 100%; font-size: 16px; padding: 15px; border: 0; border-radius: 12px;
           background: #1c1917; color: #fff; font-weight: 600; cursor: pointer; }
  @media (prefers-color-scheme: dark) { button { background: #4f46e5; } }
  .err { background: #fdecec; color: #a3261f; padding: 12px 14px; border-radius: 10px;
         font-size: 14px; margin: 0 0 16px; }
  @media (prefers-color-scheme: dark) { .err { background: #3a1e1c; color: #ffb4ad; } }
  .note { font-size: 12px; color: #78716c; margin-top: 18px; }
  .links { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
  .links a { display: block; text-align: center; font-size: 15px; font-weight: 600; padding: 12px;
             min-height: 44px; box-sizing: border-box; color: #4338ca; text-decoration: none; border-radius: 12px; }
  @media (prefers-color-scheme: dark) { .links a { color: #c7d2fe; } }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid #6366f1; outline-offset: 2px; }
`;

const hiddenFields = (params, extra = {}) =>
	Object.entries({
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		state: params.state,
		code_challenge: params.codeChallenge,
		code_challenge_method: "S256",
		...extra,
	})
		.map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
		.join("");

const page = (title, inner) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${PAGE_STYLE}</style></head><body><main>${inner}</main></body></html>`;

/** Enlace a la misma autorizacion en otro modo (entrar, crear, garmin). */
const enlaceModo = (params, modo) =>
	`/oauth/authorize?${escapeHtml(
		new URLSearchParams({
			response_type: "code", client_id: params.clientId, redirect_uri: params.redirectUri,
			code_challenge: params.codeChallenge, code_challenge_method: "S256", modo,
			...(params.state ? { state: params.state } : {}),
		}).toString(),
	)}`;

const TEXTOS_LOGIN = {
	entrar: {
		titulo: "Entra en myCoach",
		intro: "Con tu cuenta de myCoach, Claude ve tu plan, tu entrenador y los datos que tengas vinculados (Garmin, Intervals.icu).",
		boton: "Entrar",
		auto: "current-password",
		otros: [["crear", "Crear una cuenta"], ["garmin", "Aún no tengo contraseña: entrar con Garmin"]],
	},
	crear: {
		titulo: "Crea tu cuenta de myCoach",
		intro: "Después vinculas Garmin o Intervals.icu desde la app, en Ajustes. La contraseña necesita al menos 8 caracteres.",
		boton: "Crear cuenta",
		auto: "new-password",
		otros: [["entrar", "Ya tengo cuenta"]],
	},
	garmin: {
		titulo: "Entrar con Garmin",
		intro: "Solo si aún no tienes contraseña de myCoach. Luego créala en la app (Ajustes, Tu cuenta) y no volverás a necesitar este paso. Tu contraseña de Garmin no se guarda.",
		boton: "Entrar con Garmin",
		auto: "current-password",
		otros: [["entrar", "Entrar con mi cuenta de myCoach"]],
	},
};

const loginPage = (params, error, modo = "entrar") => {
	const t = TEXTOS_LOGIN[modo] || TEXTOS_LOGIN.entrar;
	return page(
		t.titulo,
		`<h1>${t.titulo}</h1>
<p>${t.intro}</p>
${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/oauth/authorize">
  ${hiddenFields(params, { modo })}
  <label for="email">Email${modo === "garmin" ? " de Garmin" : ""}</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Contraseña${modo === "garmin" ? " de Garmin" : ""}</label>
  <input id="password" name="password" type="password" autocomplete="${t.auto}" required${modo === "crear" ? ' minlength="8"' : ""}>
  <button type="submit">${t.boton}</button>
</form>
<nav class="links">${t.otros.map(([m, txt]) => `<a href="${enlaceModo(params, m)}">${txt}</a>`).join("")}</nav>
<p class="note">Para dibujar tu progreso, este servidor guarda tus actividades y tus datos diarios, y los actualiza una vez al día.
Puedes revocar el acceso borrando el conector en Claude.</p>`,
	);
};

const mfaPage = (params, pendingId, method) =>
	page(
		"Verificacion",
		`<h1>Verificacion en dos pasos</h1>
<p>Garmin te ha enviado un codigo por ${escapeHtml(method)}. Introducelo para terminar.</p>
<form method="post" action="/oauth/authorize">
  ${hiddenFields(params, { mfa_pending: pendingId })}
  <label for="code">Codigo</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus>
  <button type="submit">Verificar</button>
</form>`,
	);

const errorPage = (message) =>
	page("No se pudo conectar", `<h1>No se pudo conectar</h1><div class="err">${escapeHtml(message)}</div>`);

function collectCookies(res) {
	const raw =
		typeof res.headers.getSetCookie === "function"
			? res.headers.getSetCookie()
			: [res.headers.get("set-cookie")].filter(Boolean);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

// ───────────────── Panel de progreso: almacen en D1 ─────────────────
//
// Hasta aqui el servidor no guardaba ni un dato de Garmin. El panel si:
// sin historico no hay curva de forma, y la curva de forma es lo unico
// que de verdad distingue un panel de entrenamiento de una lista de
// salidas. Queda dicho en la pantalla de login y en el README.

const ESQUEMA = [
	`CREATE TABLE IF NOT EXISTS activities (
		user_id TEXT NOT NULL, activity_id TEXT NOT NULL,
		start_date TEXT NOT NULL, start_time TEXT, type TEXT, name TEXT,
		duration_s REAL, moving_duration_s REAL, distance_m REAL, elevation_gain_m REAL,
		avg_hr REAL, max_hr REAL, avg_speed_ms REAL, calories REAL,
		avg_power REAL, norm_power REAL, max_power REAL,
		avg_cadence REAL, max_cadence REAL,
		aerobic_te REAL, anaerobic_te REAL, garmin_load REAL,
		PRIMARY KEY (user_id, activity_id)
	)`,
	`CREATE INDEX IF NOT EXISTS activities_por_fecha ON activities (user_id, start_date)`,
	`CREATE TABLE IF NOT EXISTS days (
		user_id TEXT NOT NULL, date TEXT NOT NULL,
		resting_hr REAL, sleep_h REAL, sleep_score REAL, hrv REAL,
		body_battery_max REAL, body_battery_min REAL, readiness REAL, steps REAL,
		PRIMARY KEY (user_id, date)
	)`,
	`CREATE TABLE IF NOT EXISTS sync_state (
		user_id TEXT PRIMARY KEY, last_sync TEXT, oldest TEXT, newest TEXT,
		total INTEGER DEFAULT 0, done INTEGER DEFAULT 0,
		hr_rest REAL, hr_max REAL, ftp REAL, note TEXT
	)`,
];

let esquemaListo = false;

async function prepararEsquema(env) {
	if (esquemaListo || !env.LOGS) return Boolean(env.LOGS);
	for (const sentencia of ESQUEMA) await env.LOGS.prepare(sentencia).run();
	esquemaListo = true;
	return true;
}

const COLS_ACTIVIDAD = [
	"user_id", "activity_id", "start_date", "start_time", "type", "name",
	"duration_s", "moving_duration_s", "distance_m", "elevation_gain_m",
	"avg_hr", "max_hr", "avg_speed_ms", "calories",
	"avg_power", "norm_power", "max_power", "avg_cadence", "max_cadence",
	"aerobic_te", "anaerobic_te", "garmin_load",
];

const COLS_DIA = [
	"user_id", "date", "resting_hr", "sleep_h", "sleep_score", "hrv",
	"body_battery_max", "body_battery_min", "readiness", "steps",
];

const insertaEn = (tabla, columnas) =>
	`INSERT OR REPLACE INTO ${tabla} (${columnas.join(", ")}) VALUES (${columnas.map(() => "?").join(", ")})`;

async function guardarFilas(env, tabla, columnas, filas) {
	if (!filas.length) return;
	const sentencia = env.LOGS.prepare(insertaEn(tabla, columnas));
	// D1 agrupa el batch en una sola transaccion: o entran todas o ninguna,
	// que es justo lo que interesa cuando la sincronizacion se corta a medias.
	const lote = filas.map((fila) => sentencia.bind(...columnas.map((c) => fila[c] ?? null)));
	for (let i = 0; i < lote.length; i += 50) await env.LOGS.batch(lote.slice(i, i + 50));
}

const leerTabla = async (env, tabla, userId, orden) =>
	(await env.LOGS.prepare(`SELECT * FROM ${tabla} WHERE user_id = ? ORDER BY ${orden}`).bind(userId).all())
		?.results ?? [];

async function leerEstado(env, userId) {
	const r = await env.LOGS.prepare("SELECT * FROM sync_state WHERE user_id = ?").bind(userId).first();
	return r || { user_id: userId, total: 0, done: 0 };
}

const guardarEstado = (env, estado) =>
	guardarFilas(env, "sync_state", Object.keys(estado), [estado]);

// ──────────────── Panel: traer los datos de Garmin ────────────────

/**
 * Garmin no usa un solo nombre para la potencia ni para la cadencia segun
 * el dispositivo que haya grabado. Se prueban los que existen y ya.
 */
const primerValor = (obj, ...claves) => {
	for (const clave of claves) {
		const v = obj?.[clave];
		if (typeof v === "number" && Number.isFinite(v)) return v;
	}
	return null;
};

function normalizarActividad(userId, a) {
	const inicio = a.startTimeLocal || a.startTimeGMT || "";
	return {
		user_id: userId,
		activity_id: String(a.activityId),
		start_date: inicio.slice(0, 10),
		start_time: inicio,
		type: a.activityType?.typeKey ?? null,
		name: a.activityName ?? null,
		duration_s: primerValor(a, "duration", "elapsedDuration"),
		moving_duration_s: primerValor(a, "movingDuration"),
		distance_m: primerValor(a, "distance"),
		elevation_gain_m: primerValor(a, "elevationGain"),
		avg_hr: primerValor(a, "averageHR", "avgHr"),
		max_hr: primerValor(a, "maxHR", "maxHr"),
		avg_speed_ms: primerValor(a, "averageSpeed", "avgSpeed"),
		calories: primerValor(a, "calories"),
		// Potencia y cadencia todavia no las tiene nadie aqui, pero el dia
		// que se conecte un potenciometro los datos entran sin tocar nada.
		avg_power: primerValor(a, "avgPower", "averagePower", "averageWatts"),
		norm_power: primerValor(a, "normPower", "normalizedPower"),
		max_power: primerValor(a, "maxPower", "maxWatts"),
		avg_cadence: primerValor(
			a, "averageBikingCadenceInRevPerMinute", "averageRunningCadenceInStepsPerMinute", "averageCadence"),
		max_cadence: primerValor(
			a, "maxBikingCadenceInRevPerMinute", "maxRunningCadenceInStepsPerMinute", "maxCadence"),
		aerobic_te: primerValor(a, "aerobicTrainingEffect"),
		anaerobic_te: primerValor(a, "anaerobicTrainingEffect"),
		garmin_load: primerValor(a, "activityTrainingLoad", "trainingLoad"),
	};
}

const PAGINA = 100;

/**
 * Trae actividades y bienestar. Se llama tanto desde el cron como desde el
 * propio panel, y siempre avanza un trozo acotado: Garmin responde 429 si se
 * le pide el historico entero de golpe, asi que la primera carga se completa
 * en varias pasadas en vez de en una que falla.
 */
async function sincronizar(env, userId, { paginas = 4, dias = 30 } = {}) {
	if (!(await prepararEsquema(env))) throw new HttpError(500, "Falta la base de datos D1.");

	const estado = await leerEstado(env, userId);
	let traidas = 0;
	let agotado = false;

	// Mientras falta historico se avanza por el desplazamiento guardado. Una
	// vez completo se vuelve siempre al principio de la lista: las salidas
	// nuevas entran por delante, asi que un desplazamiento se las saltaria.
	const desde = estado.done ? 0 : estado.total;

	for (let p = 0; p < paginas; p++) {
		const lista = await apiGet(env, userId, "/activitylist-service/activities/search/activities", {
			start: String(desde + traidas),
			limit: String(PAGINA),
		});
		const filas = (lista || []).map((a) => normalizarActividad(userId, a)).filter((f) => f.start_date);
		await guardarFilas(env, "activities", COLS_ACTIVIDAD, filas);
		traidas += filas.length;
		if (filas.length < PAGINA) { agotado = true; break; }
	}

	const bienestar = await sincronizarDias(env, userId, dias);

	const fechas = await env.LOGS.prepare(
		"SELECT MIN(start_date) AS oldest, MAX(start_date) AS newest, COUNT(*) AS n FROM activities WHERE user_id = ?",
	).bind(userId).first();

	await guardarEstado(env, {
		user_id: userId,
		last_sync: new Date().toISOString(),
		oldest: fechas?.oldest ?? null,
		newest: fechas?.newest ?? null,
		total: agotado || estado.done ? 0 : estado.total + traidas,
		// Una vez completo ya no se vuelve atras: si un dia caen justo 100
		// salidas nuevas, no debe reinterpretarse como que falta historico.
		done: agotado || estado.done ? 1 : 0,
		hr_rest: estado.hr_rest ?? null,
		hr_max: estado.hr_max ?? null,
		ftp: estado.ftp ?? null,
		note: null,
	});

	return { actividades: fechas?.n ?? 0, traidas, dias: bienestar, completo: Boolean(agotado) };
}

/**
 * El bienestar no tiene endpoint por rangos que se pueda dar por estable, asi
 * que va dia a dia. Por eso se piden solo los que faltan y se para al primer
 * bloqueo: mejor quedarse corto que comerse un 429 que tumba tambien al MCP.
 */
async function sincronizarDias(env, userId, cuantos) {
	const nombre = await displayName(env, userId);
	const previos = new Set(
		(await env.LOGS.prepare("SELECT date FROM days WHERE user_id = ? AND date >= ?")
			.bind(userId, daysAgo(cuantos)).all())?.results?.map((r) => r.date) ?? [],
	);

	const filas = [];
	for (let i = 1; i <= cuantos; i++) {
		const d = daysAgo(i);
		// Ayer se vuelve a pedir siempre: al sincronizar de madrugada el sueno
		// y el HRV de esa noche todavia no estaban puestos.
		if (previos.has(d) && i > 1) continue;
		try {
			const [resumen, sueno, hrv] = await Promise.all([
				apiGet(env, userId, `/usersummary-service/usersummary/daily/${nombre}`, { calendarDate: d }),
				apiGet(env, userId, `/wellness-service/wellness/dailySleepData/${nombre}`, { date: d, nonSleepBufferMinutes: "60" })
					.catch(() => null),
				apiGet(env, userId, `/hrv-service/hrv/${d}`).catch(() => null),
			]);
			filas.push({
				user_id: userId,
				date: d,
				resting_hr: primerValor(resumen, "restingHeartRate"),
				sleep_h: resumen?.sleepingSeconds ? resumen.sleepingSeconds / 3600
					: (sueno?.dailySleepDTO?.sleepTimeSeconds ?? 0) / 3600 || null,
				sleep_score: primerValor(sueno?.dailySleepDTO?.sleepScores?.overall || {}, "value"),
				hrv: primerValor(hrv?.hrvSummary || {}, "lastNightAvg"),
				body_battery_max: primerValor(resumen, "bodyBatteryHighestValue"),
				body_battery_min: primerValor(resumen, "bodyBatteryLowestValue"),
				readiness: null,
				steps: primerValor(resumen, "totalSteps"),
			});
		} catch {
			break; // Garmin ha dicho basta; el resto se recoge en la siguiente pasada.
		}
	}

	await guardarFilas(env, "days", COLS_DIA, filas);
	return filas.length;
}

// ──────────── Panel: de las salidas a un indicador de forma ────────────
//
// El modelo estandar (CTL/ATL/TSB de Coggan) se apoya en el TSS, que se
// calcula con potencia. Sin potenciometro hay que sustituirlo por carga de
// frecuencia cardiaca: TRIMP de Banister, escalado para que una hora a
// umbral valga 100, igual que un TSS. No es lo mismo, pero se comporta
// igual y permite la misma lectura. Si algun dia entra potencia, el mismo
// grafico pasa a calcularse con ella sin cambiar nada del panel.

const DEPORTES_BICI = new Set([
	"cycling", "road_biking", "gravel_cycling", "mountain_biking",
	"virtual_ride", "indoor_cycling", "cyclocross",
]);

/**
 * Garmin etiqueta lo mismo de varias maneras: la misma salida de carretera
 * llega como "cycling" o como "road_biking" segun el aparato que la grabe.
 * Contarlas por separado partia el deporte principal en dos trozos y lo
 * echaba al cajon de "otros". Se agrupan por familia y la bici va siempre
 * primera, que es de lo que va todo esto.
 */
const FAMILIAS = [
	["bici", DEPORTES_BICI],
	["correr", new Set(["running", "trail_running", "treadmill_running", "track_running", "virtual_run"])],
	["fuerza", new Set(["strength_training", "indoor_cardio", "hiit", "pilates", "yoga", "bouldering"])],
];
const familiaDe = (tipo) => FAMILIAS.find(([, tipos]) => tipos.has(tipo))?.[0] ?? "otros";
const FAMILIAS_EN_ORDEN = ["bici", "correr", "fuerza", "otros"];

const UMBRAL_HRR = 0.85; // fraccion de reserva cardiaca que se toma por umbral
const TRIMP_HORA_UMBRAL = 60 * UMBRAL_HRR * 0.64 * Math.exp(1.92 * UMBRAL_HRR);

const percentil = (valores, p) => {
	const orden = valores.filter((v) => typeof v === "number" && v > 0).sort((a, b) => a - b);
	if (!orden.length) return null;
	return orden[Math.min(orden.length - 1, Math.floor(p * orden.length))];
};

/**
 * Las referencias salen de los propios datos en vez de preguntarselas al
 * usuario: la maxima, de la pulsacion mas alta registrada; el reposo, del
 * percentil bajo de las lecturas diarias, que aguanta mejor un mal dia que
 * el minimo absoluto. El panel las ensena y se pueden corregir a mano.
 */
function referenciasFC(actividades, dias, estado) {
	const maxObservada = Math.max(0, ...actividades.map((a) => a.max_hr || 0));
	const reposoObservado = percentil(dias.map((d) => d.resting_hr), 0.1);
	return {
		max: estado?.hr_max || (maxObservada > 120 ? Math.round(maxObservada) : 190),
		rest: estado?.hr_rest || (reposoObservado || 60),
		maxAuto: !estado?.hr_max,
		restAuto: !estado?.hr_rest,
	};
}

/**
 * Sin FTP declarado se estima a partir de la potencia normalizada mas alta
 * sostenida en salidas largas. Es una estimacion tosca y el panel lo dice:
 * sirve para que la curva tenga forma, no para prescribir entrenamientos.
 */
function referenciaFTP(actividades, estado) {
	if (estado?.ftp) return { ftp: estado.ftp, estimado: false };
	const largas = actividades
		.filter((a) => (a.duration_s || 0) >= 1800)
		.map((a) => a.norm_power || a.avg_power)
		.filter(Boolean);
	if (!largas.length) return { ftp: null, estimado: false };
	return { ftp: Math.round((percentil(largas, 0.95) || 0) * 0.95) || null, estimado: true };
}

function cargaDe(a, fc, ftp) {
	const segundos = a.moving_duration_s || a.duration_s || 0;
	if (segundos < 300) return { carga: 0, fuente: "corta" };

	const np = a.norm_power || a.avg_power;
	if (np && ftp) {
		const intensidad = np / ftp;
		return { carga: ((segundos * np * intensidad) / (ftp * 3600)) * 100, fuente: "potencia" };
	}

	if (a.avg_hr && fc.max > fc.rest) {
		const reserva = Math.min(Math.max((a.avg_hr - fc.rest) / (fc.max - fc.rest), 0), 1);
		const trimp = (segundos / 60) * reserva * 0.64 * Math.exp(1.92 * reserva);
		return { carga: (100 * trimp) / TRIMP_HORA_UMBRAL, fuente: "pulso" };
	}

	// Sin pulso queda lo que calcula el propio reloj, que es mejor que un cero.
	if (a.garmin_load) return { carga: a.garmin_load, fuente: "garmin" };
	return { carga: 0, fuente: "sin datos" };
}

const sumaDias = (desde, n) => {
	const d = new Date(`${desde}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

const diasEntre = (a, b) =>
	Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Medias moviles exponenciales de 42 y 7 dias sobre la carga diaria. La
 * frescura del dia se mide con los valores de ayer, que es lo que hace que
 * un entreno duro de hoy no baje la forma antes de haberla asimilado.
 */
function curvaDeForma(actividades, fc, ftp) {
	if (!actividades.length) return [];

	const porDia = new Map();
	for (const a of actividades) {
		const { carga } = cargaDe(a, fc, ftp);
		porDia.set(a.start_date, (porDia.get(a.start_date) || 0) + carga);
	}

	const primera = actividades[0].start_date;
	const ultima = today() > actividades.at(-1).start_date ? today() : actividades.at(-1).start_date;
	const total = diasEntre(primera, ultima);

	const curva = [];
	let ctl = 0;
	let atl = 0;
	for (let i = 0; i <= total; i++) {
		const d = sumaDias(primera, i);
		const carga = porDia.get(d) || 0;
		const tsb = ctl - atl; // con los valores de ayer, antes de aplicar hoy
		ctl += (carga - ctl) / 42;
		atl += (carga - atl) / 7;
		curva.push({ d, carga: round(carga, 1), ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(tsb, 1) });
	}
	return curva;
}

const lunesDe = (fecha) => {
	const d = new Date(`${fecha}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
};

/** Horas por familia de deporte y semana. */
function semanas(actividades, fc, ftp) {
	const porSemana = new Map();
	for (const a of actividades) {
		const semana = lunesDe(a.start_date);
		const fila = porSemana.get(semana) || { semana, carga: 0, horas: {}, km: 0, desnivel: 0 };
		const clave = familiaDe(a.type);
		fila.horas[clave] = round((fila.horas[clave] || 0) + (a.duration_s || 0) / 3600, 2);
		fila.carga = round(fila.carga + cargaDe(a, fc, ftp).carga, 1);
		if (DEPORTES_BICI.has(a.type)) {
			fila.km = round(fila.km + (a.distance_m || 0) / 1000, 1);
			fila.desnivel = Math.round(fila.desnivel + (a.elevation_gain_m || 0));
		}
		porSemana.set(semana, fila);
	}

	// Orden fijo: la bici siempre primera y siempre del mismo color, aunque
	// una temporada se corra mas que se pedalee.
	const usadas = new Set([...porSemana.values()].flatMap((f) => Object.keys(f.horas)));
	return {
		deportes: FAMILIAS_EN_ORDEN.filter((f) => usadas.has(f)),
		filas: [...porSemana.values()].sort((x, y) => x.semana.localeCompare(y.semana)),
	};
}

/**
 * Metros recorridos por pulsacion. Sin potenciometro es el mejor indicio de
 * que uno esta mejorando: la misma velocidad con menos pulsaciones. Solo
 * tiene sentido entre salidas comparables, asi que se limita a la bici y a
 * salidas de al menos 45 minutos, y aun asi el viento y el desnivel mueven
 * el punto: lo que se lee es la tendencia, no un dia suelto.
 */
function eficiencia(actividades) {
	return actividades
		.filter((a) => DEPORTES_BICI.has(a.type) && (a.duration_s || 0) >= 2700 && a.avg_hr > 60 && a.distance_m > 0)
		.map((a) => ({
			d: a.start_date,
			valor: round(a.distance_m / (a.avg_hr * ((a.moving_duration_s || a.duration_s) / 60)), 2),
			km: round(a.distance_m / 1000, 1),
			desnivel: Math.round(a.elevation_gain_m || 0),
			fc: Math.round(a.avg_hr),
			vatios_por_pulso: a.avg_power ? round(a.avg_power / a.avg_hr, 2) : null,
			nombre: a.name,
		}));
}

/**
 * Cuanto ha mejorado, en una cifra. Compara la eficiencia de los ultimos
 * tres meses con la de la misma epoca del año pasado, por medianas: una
 * salida con viento a favor no puede decidir la respuesta. Devuelve null si
 * no hay salidas suficientes a ambos lados, que es mejor que un porcentaje
 * calculado sobre dos dias.
 */
function progresoEficiencia(puntos) {
	const mediana = (arr) => {
		const orden = arr.slice().sort((a, b) => a - b);
		return orden.length ? orden[Math.floor(orden.length / 2)] : null;
	};
	const ahora = puntos.filter((p) => diasEntre(p.d, today()) < 90).map((p) => p.valor);
	const antes = puntos
		.filter((p) => diasEntre(p.d, today()) >= 335 && diasEntre(p.d, today()) < 455)
		.map((p) => p.valor);
	if (ahora.length < 3 || antes.length < 3) return null;
	const a = mediana(ahora);
	const b = mediana(antes);
	return { ahora: round(a, 2), antes: round(b, 2), variacion: round(((a - b) / b) * 100, 1), salidas: ahora.length };
}

/** Todo lo que la pagina necesita, ya calculado: el navegador solo dibuja. */
function resumenPanel(actividades, dias, estado) {
	const fc = referenciasFC(actividades, dias, estado);
	const { ftp, estimado } = referenciaFTP(actividades, estado);
	const curva = curvaDeForma(actividades, fc, ftp);
	const hoy = curva.at(-1) || { ctl: 0, atl: 0, tsb: 0 };
	const mejor = curva.reduce((mx, p) => (p.ctl > (mx?.ctl ?? -1) ? p : mx), null);
	const hace = (n) => curva[Math.max(0, curva.length - 1 - n)] || curva[0] || { ctl: 0 };
	const bici = actividades.filter((a) => DEPORTES_BICI.has(a.type));
	const ef = eficiencia(actividades);

	return {
		ajustes: { hr_rest: fc.rest, hr_max: fc.max, hr_auto: fc.restAuto || fc.maxAuto, ftp, ftp_estimado: estimado },
		hoy,
		mejor: mejor && { ctl: mejor.ctl, d: mejor.d },
		hace30: hace(30).ctl,
		hace90: hace(90).ctl,
		hace365: hace(365).ctl,
		curva,
		semanas: semanas(actividades, fc, ftp),
		eficiencia: ef,
		progreso: progresoEficiencia(ef),
		dias,
		tiene_potencia: actividades.some((a) => a.avg_power || a.norm_power),
		tiene_cadencia: actividades.some((a) => a.avg_cadence),
		fuentes: [...new Set(actividades.map((a) => cargaDe(a, fc, ftp).fuente))],
		total: {
			actividades: actividades.length,
			desde: actividades[0]?.start_date ?? null,
			horas: Math.round(actividades.reduce((s, a) => s + (a.duration_s || 0), 0) / 3600),
			km: Math.round(bici.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000),
			desnivel: Math.round(bici.reduce((s, a) => s + (a.elevation_gain_m || 0), 0)),
		},
		estado: { ultima: estado?.last_sync ?? null, completo: Boolean(estado?.done) },
	};
}

// ─────────────────── Entrenador: el motor que decide ───────────────────
//
// Las herramientas coach_* son el "metodo" de myCoach. Deciden con reglas
// fijas (semaforo del dia, limites de intensidad, validacion del plan) y
// devuelven el porque de cada decision. El modelo que las llama —el Claude
// del usuario, la web o un bot— solo explica y negocia: asi da igual quien
// hable, la logica es siempre la misma. Es la leccion de otros entrenadores
// de IA: si quien decide no es quien explica, las explicaciones dejan de
// cuadrar con las decisiones.
//
// Estado en el KV de la app (mismos documentos que lee y escribe la web):
//   estado/app        plan (esta semana), next (la siguiente), goal, sports
//   atleta/perfil     objetivo con fecha, disponibilidad, lesiones, preferencias
//   atleta/diario     sensaciones y dolores anotados (lista)
//   coach/hoy         ultimo semaforo calculado (lo deja el cron cada manana)
//   coach/decisiones  cambios de plan aplicados y su porque (lista)

const ZONA_COACH = "Europe/Madrid";

/** Fecha local del usuario: a las 00:30 en Madrid ya es "hoy" aunque en UTC no. */
const fechaLocal = (d = new Date(), zona = ZONA_COACH) =>
	new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const diaDe = (fecha) => DIAS_SEMANA[new Date(`${fecha}T12:00:00Z`).getUTCDay()];
const semanaDe = (fecha) => [0, 1, 2, 3, 4, 5, 6].map((i) => sumaDias(lunesDe(fecha), i));

// Los mismos objetivos que la app (MODOS en 10-estado.js): horas por semana,
// dias intensos (minimo, maximo) y sesiones de fuerza.
const MODOS_COACH = {
	forma: { nombre: "Estar en forma y sano", h: [5, 7], int: [1, 2], fuerza: 2 },
	reto: { nombre: "Preparar un reto", h: [7, 10], int: [1, 2], fuerza: 2 },
	mejorar: { nombre: "Mejorar en un deporte", h: [6, 9], int: [2, 2], fuerza: 2 },
	volver: { nombre: "Volver tras un paron", h: [3, 5], int: [0, 1], fuerza: 2 },
};
const TIPOS_SESION = new Set(["rec", "fondo", "tempo", "int", "otros", "descanso"]);
const DEPORTES_APP = new Set(["bici", "correr", "skimo", "montana", "raqueta", "fuerza", "esqui", "caminar", "otros"]);
const DUROS = new Set(["int", "tempo"]);
// Lo que el entrenador planifica: deportes que se miden con pulso, ritmo,
// potencia o cadencia. La fuerza entra como complemento. Todo lo demas
// (padel, montana, esqui de pista...) cuenta como carga, pero no se planifica.
const DEPORTES_ENTRENABLES = new Set(["bici", "correr", "skimo"]);
const NOMBRE_COACH = "myCoach";

async function nombreEntrenador(env, userId) {
	const perfil = await leerDoc(env, userId, "atleta/perfil");
	const n = String(perfil?.entrenador?.nombre || "").trim().slice(0, 24);
	return n || NOMBRE_COACH;
}

/**
 * Un plan escrito a mano (por Claude con app_guardar, por ejemplo) puede
 * llegar con otros nombres de campo: tipo, titulo, detalle, duracion_min…
 * Se traduce al formato de la app ({ dep, t, d, min }) en vez de guardar
 * algo que la app no sabe leer. Lo que no se puede entender, se rechaza
 * explicando el formato.
 */
const ALIAS_TIPO = [
	[/descans|rest|off|libre/, "descanso"],
	[/recup|recover|regenera|muy suave/, "rec"],
	[/serie|interval|vo2|int\b|intens|hiit|sprint|anaerob/, "int"],
	[/tempo|umbral|threshold|sweet|ritmo/, "tempo"],
	[/fondo|z2|zona 2|base|suave|endurance|resistencia|largo|rodaje|aerob/, "fondo"],
	[/fuerza|gym|gimnas|core|pesas|strength|movilidad|otros/, "otros"],
];
const ALIAS_DEPORTE = [
	[/bici|cicl|bike|cycl|ride|mtb|gravel|rodillo/, "bici"],
	[/corr|run|carrera|trail/, "correr"],
	[/skimo|travesia|ski.?touring|backcountry/, "skimo"],
	[/fuerza|gym|gimnas|core|pesas|strength|movilidad|superior|inferior|cuerpo/, "fuerza"],
];
const buscar = (tabla, texto) => tabla.find(([re]) => re.test(texto))?.[1] ?? null;

function normalizarSesion(s, deporteDefecto) {
	if (!s || typeof s !== "object") return null;
	if (DEPORTES_APP.has(s.dep) && TIPOS_SESION.has(s.t)) return null; // ya esta bien
	const texto = [s.t, s.tipo, s.type, s.titulo, s.title, s.detalle, s.descripcion, s.d, s.dep, s.deporte, s.sport]
		.filter((x) => typeof x === "string").join(" ").toLowerCase();
	const t = TIPOS_SESION.has(s.t) ? s.t : buscar(ALIAS_TIPO, String(s.tipo ?? s.type ?? s.t ?? "").toLowerCase()) || buscar(ALIAS_TIPO, texto);
	let dep = DEPORTES_APP.has(s.dep) ? s.dep : buscar(ALIAS_DEPORTE, String(s.deporte ?? s.sport ?? s.dep ?? "").toLowerCase()) || buscar(ALIAS_DEPORTE, texto);
	if (!dep && t === "descanso") dep = "bici";
	if (!dep && t === "otros") dep = "fuerza";
	if (!dep && t && DEPORTES_ENTRENABLES.has(deporteDefecto)) dep = deporteDefecto; // "60 min Z2" sin deporte: el suyo
	if (!t || !dep) throw new HttpError(400,
		`No entiendo la sesion ${JSON.stringify(s).slice(0, 120)}. Formato del plan: { "AAAA-MM-DD": { "dep": "bici|correr|skimo|fuerza", ` +
		`"t": "rec|fondo|tempo|int|otros|descanso", "d": "descripcion corta", "min": 60 } }. Mejor aun: use coach_proponer.`);
	const titulo = [s.titulo ?? s.title, s.detalle ?? s.descripcion ?? s.d].filter((x) => typeof x === "string" && x.trim()).join(": ");
	const minutos = [s.min, s.minutos, s.duracion_min, s.duracion, s.duration_min].find((x) => Number.isFinite(Number(x)) && x !== null && x !== "");
	return {
		dep: t === "otros" && dep !== "fuerza" && /fuerza|core|gym|superior|inferior/.test(texto) ? "fuerza" : dep,
		t: dep === "fuerza" && t !== "descanso" ? "otros" : t,
		d: (titulo || (t === "descanso" ? "Descanso" : t)).slice(0, 120),
		min: t === "descanso" ? 0 : Math.round(Number(minutos) || 0),
		...(Number.isFinite(Number(s.fc_max)) ? { fc_max: Math.round(Number(s.fc_max)) } : {}),
		// Un dia de fuerza puede apuntar a un entreno con nombre (fuerza_entrenos).
		...(typeof s.entreno === "string" && s.entreno.trim() ? { entreno: s.entreno.trim().slice(0, 40) } : {}),
		...(typeof s.entreno_cardio === "string" && s.entreno_cardio.trim() ? { entreno_cardio: s.entreno_cardio.trim().slice(0, 40) } : {}),
	};
}

function normalizarPlan(plan, deporteDefecto) {
	const salida = {};
	let cambiados = 0;
	for (const [fecha, s] of Object.entries(plan || {})) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpError(400, `Fecha no valida en el plan: ${fecha} (use AAAA-MM-DD).`);
		const n = normalizarSesion(s, deporteDefecto);
		if (n) cambiados++;
		salida[fecha] = n || s;
	}
	return { plan: salida, cambiados };
}

function objetivoDe(estadoApp) {
	const goal = estadoApp?.goal || {};
	const modo = MODOS_COACH[goal.modo] ? goal.modo : "forma";
	const m = MODOS_COACH[modo];
	return { modo, nombre: m.nombre, h: goal.h || m.h, int: goal.int || m.int, fuerza: goal.fuerza ?? m.fuerza };
}

/** Tipo de actividad de Garmin -> deporte de la app. */
function deporteApp(tipo) {
	const t = String(tipo || "");
	if (DEPORTES_BICI.has(t)) return "bici";
	if (/run/.test(t)) return "correr";
	if (/backcountry|skimo|ski_touring/.test(t)) return "skimo";
	if (/hik|mountaineer|climb/.test(t)) return "montana";
	if (/tennis|padel|paddel|squash|badminton|racket|pickleball/.test(t)) return "raqueta";
	if (familiaDe(t) === "fuerza") return "fuerza";
	if (/ski|snowboard/.test(t)) return "esqui";
	if (/walk/.test(t)) return "caminar";
	return "otros";
}

/**
 * Intensidad de una actividad hecha. Es una estimacion con el efecto de
 * entrenamiento de Garmin: el tipo exacto (series, umbral) no viaja en la
 * lista de actividades, y para contar dias duros basta con esto.
 */
function intensidadHecha(a) {
	if ((a.anaerobic_te ?? 0) >= 2 || (a.aerobic_te ?? 0) >= 4) return "int";
	if ((a.aerobic_te ?? 0) >= 3.5) return "tempo";
	return "suave";
}

const mediana = (valores) => {
	const orden = valores.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
	if (!orden.length) return null;
	const m = Math.floor(orden.length / 2);
	return orden.length % 2 ? orden[m] : (orden[m - 1] + orden[m]) / 2;
};

/** Linea base personal: mediana de los 28 dias anteriores a hoy. */
function lineaBase(dias, hoy) {
	const previos = dias.filter((d) => d.date < hoy && diasEntre(d.date, hoy) <= 28);
	return {
		hrv: mediana(previos.map((d) => d.hrv)),
		resting_hr: mediana(previos.map((d) => d.resting_hr)),
		sleep_h: mediana(previos.map((d) => d.sleep_h)),
		dias: previos.length,
	};
}

const horasTexto = (h) => {
	const min = Math.round(h * 60);
	return `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
};

function lecturaFrescura(tsb) {
	if (tsb == null) return null;
	if (tsb > 10) return "fresco";
	if (tsb >= -10) return "equilibrado";
	if (tsb >= -30) return "cargado (normal en un bloque de entreno)";
	return "muy cargado";
}

/**
 * Semaforo del dia. Cada senal suma 1 (leve) o 2 (fuerte): rojo desde 4,
 * ambar desde 2. Ninguna senal sola pone el dia en rojo salvo un readiness
 * muy bajo o un dolor anotado: un mal dato suelto no debe tirar una semana.
 */
function semaforo({ hoy, datosHoy = {}, base = {}, tsb = null, diario = [], perfil = {} }) {
	const senales = [];
	const positivos = [];
	const senal = (peso, texto) => senales.push({ peso, texto });
	// Cada dato con su valor, lo normal para ti y como lo lee el semaforo:
	// es lo que la app ensena para que se vea POR QUE sale ese color.
	const datos = [];
	const dato = (clave, nombre, valor, normal, estado) => datos.push({ clave, nombre, valor, normal, estado });

	const r = datosHoy.readiness;
	if (r != null) {
		if (r < 35) senal(4, `readiness ${r} de Garmin`);
		else if (r < 55) senal(1, `readiness ${r} de Garmin`);
		else if (r >= 70) positivos.push(`readiness ${r}`);
		dato("readiness", "Readiness de Garmin", String(r), null, r < 35 ? "fuerte" : r < 55 ? "leve" : r >= 70 ? "bien" : "normal");
	} else dato("readiness", "Readiness de Garmin", null, null, "sin_dato");

	const sueno = datosHoy.sleep_h;
	if (sueno != null && sueno > 0) {
		let est = "normal";
		if (sueno < 5) { senal(2, `has dormido ${horasTexto(sueno)}`); est = "fuerte"; }
		else if (sueno < 6.25) { senal(1, `has dormido ${horasTexto(sueno)}`); est = "leve"; }
		else if (datosHoy.sleep_score != null && datosHoy.sleep_score < 45) { senal(1, `sueño de mala calidad (${datosHoy.sleep_score}/100)`); est = "leve"; }
		else if (sueno >= 7) { positivos.push(`has dormido ${horasTexto(sueno)}`); est = "bien"; }
		dato("sueno", "Sueño", `${horasTexto(sueno)}${datosHoy.sleep_score != null ? ` · ${datosHoy.sleep_score}/100` : ""}`,
			base.sleep_h ? horasTexto(base.sleep_h) : null, est);
	} else dato("sueno", "Sueño", null, null, "sin_dato");

	const hrv = datosHoy.hrv;
	if (hrv != null && base.hrv) {
		const ratio = hrv / base.hrv;
		let est = "bien";
		if (ratio < 0.8) { senal(2, `VFC ${Math.round(hrv)} ms, muy por debajo de lo normal para ti (${Math.round(base.hrv)})`); est = "fuerte"; }
		else if (ratio < 0.9) { senal(1, `VFC ${Math.round(hrv)} ms, algo baja (tu normal: ${Math.round(base.hrv)})`); est = "leve"; }
		else positivos.push("VFC normal");
		dato("vfc", "VFC nocturna", `${Math.round(hrv)} ms`, `${Math.round(base.hrv)} ms`, est);
	} else if (datosHoy.hrv_status) {
		const s = String(datosHoy.hrv_status).toUpperCase();
		let est = "normal";
		if (s === "POOR") { senal(2, "VFC en estado malo según Garmin"); est = "fuerte"; }
		else if (s === "LOW" || s === "UNBALANCED") { senal(1, "VFC desequilibrada según Garmin"); est = "leve"; }
		else if (s === "BALANCED") { positivos.push("VFC equilibrada"); est = "bien"; }
		dato("vfc", "VFC nocturna", hrv != null ? `${Math.round(hrv)} ms` : s.toLowerCase(), null, est);
	} else dato("vfc", "VFC nocturna", hrv != null ? `${Math.round(hrv)} ms` : null, null, hrv != null ? "normal" : "sin_dato");

	const fc = datosHoy.resting_hr;
	if (fc != null && base.resting_hr) {
		const sube = fc - base.resting_hr;
		let est = "bien";
		if (sube >= 7) { senal(2, `pulso en reposo ${Math.round(fc)}, ${Math.round(sube)} por encima de lo normal`); est = "fuerte"; }
		else if (sube >= 4) { senal(1, `pulso en reposo ${Math.round(fc)}, algo alto`); est = "leve"; }
		dato("pulso", "Pulso en reposo", `${Math.round(fc)} ppm`, `${Math.round(base.resting_hr)} ppm`, est);
	} else dato("pulso", "Pulso en reposo", fc != null ? `${Math.round(fc)} ppm` : null, null, fc != null ? "normal" : "sin_dato");

	if (tsb != null) {
		let est = "normal";
		if (tsb < -30) { senal(2, `mucha fatiga acumulada (frescura ${Math.round(tsb)})`); est = "fuerte"; }
		else if (tsb < -18) { senal(1, `fatiga acumulada (frescura ${Math.round(tsb)})`); est = "leve"; }
		else if (tsb > 5) { positivos.push("llegas fresco"); est = "bien"; }
		dato("frescura", "Frescura (forma − fatiga)", `${Math.round(tsb)} · ${lecturaFrescura(tsb)}`, null, est);
	} else dato("frescura", "Frescura (forma − fatiga)", null, null, "sin_dato");

	// Lo que el usuario ha contado en las ultimas 36 h pesa tanto como los datos.
	const reciente = diario.filter((n) => n?.fecha && diasEntre(n.fecha, hoy) <= 1);
	for (const n of reciente) {
		if (n.tipo === "dolor") {
			senal(4, `anotaste dolor: ${String(n.texto || "").slice(0, 60)}`);
			dato("diario", "Lo que has anotado", `Dolor: ${String(n.texto || "").slice(0, 60)}`, null, "fuerte");
		} else if (n.tipo === "sensacion" && (n.fisico ?? n.nivel) != null) {
			const f = n.fisico ?? n.nivel;
			if (f <= 1) senal(2, "dijiste que estabas agotado");
			else if (f === 2) senal(1, "dijiste que estabas cansado");
			if (n.animo != null && n.animo <= 1) senal(1, "dijiste que tenías el ánimo muy bajo");
			dato("diario", "Lo que has anotado", String(n.texto || textoSensacion(n)).slice(0, 60), null,
				f <= 1 ? "fuerte" : f === 2 ? "leve" : f >= 4 ? "bien" : "normal");
		}
	}

	const lesiones = (perfil.lesiones || []).filter((l) => l && l.estado !== "curada");
	if (lesiones.length) {
		senal(1, `lesión activa: ${lesiones.map((l) => l.zona).join(", ")}`);
		dato("lesion", "Lesión", lesiones.map((l) => l.zona).join(", "), null, "leve");
	}

	const puntos = senales.reduce((s, x) => s + x.peso, 0);
	const color = puntos >= 4 ? "rojo" : puntos >= 2 ? "ambar" : "verde";
	const faltan = ["readiness", "hrv", "sleep_h"].filter((k) => datosHoy[k] == null);
	return {
		color,
		dolor: reciente.some((n) => n.tipo === "dolor"),
		puntos,
		razones: senales.sort((a, b) => b.peso - a.peso).map((s) => s.texto),
		positivos,
		datos,
		datos_que_faltan: faltan,
	};
}

/**
 * Dia de esta semana, despues de hoy, donde cabe una sesion dura sin pegarse
 * a otra. Primero los dias libres, luego los de recuperacion y los fondos
 * cortos. Nunca un descanso ni el dia largo: tambien son parte del plan.
 */
function diaParaMover(plan, hoy, { desde = 1 } = {}) {
	// La sesion de hoy es justo la que se mueve: no cuenta como dura.
	const duro = (f) => f !== hoy && DUROS.has(plan[f]?.t);
	const preferencia = (f) => {
		const s = plan[f];
		if (!s) return 0;
		if (s.t === "rec") return 1;
		if (s.t === "fondo" && (s.min || 0) < 150) return 2;
		if (s.t === "otros") return 3;
		return null; // descanso, fondo largo o duro
	};
	const candidatos = semanaDe(hoy)
		.filter((f) => f >= sumaDias(hoy, desde) && !duro(sumaDias(f, -1)) && !duro(sumaDias(f, 1)) && preferencia(f) != null)
		.sort((a, b) => preferencia(a) - preferencia(b) || a.localeCompare(b));
	return candidatos[0] ?? null;
}

/** Que hacer hoy con la sesion prevista segun el semaforo. null = mantenerla. */
function ajusteDelDia(sesion, color, plan, hoy, semaforoDolor = false) {
	if (!sesion) {
		if (color === "verde") return { accion: "libre", texto: "Día libre. Si te apetece, 45-60 min suaves." };
		return { accion: "descansar", texto: "Día libre: aprovecha para descansar." };
	}
	// Ya ajustada por el semaforo: no se vuelve a recortar lo recortado.
	if (sesion.t === "descanso" || color === "verde" || sesion.ajustada) return null;

	const min = sesion.min || 0;
	const duro = DUROS.has(sesion.t);
	// Con dolor no se reprograma la intensidad: primero, que deje de doler.
	// En rojo, mañana todavia es pronto.
	const destino = duro && !semaforoDolor ? diaParaMover(plan, hoy, { desde: color === "rojo" ? 2 : 1 }) : null;
	// Lo que habia ese dia se sustituye: se dice, para que nadie lo pierda sin saberlo.
	const mover = destino ? { a: destino, dia: diaDe(destino), sesion, sustituye: plan[destino] || null } : null;

	if (color === "rojo") {
		return {
			accion: "cambiar",
			sesion: { dep: sesion.dep, t: "rec", d: "Descanso o 30 min muy suaves", min: 30, ajustada: true },
			mover,
			texto: `Hoy descanso o 30 min muy suaves${mover ? `; ${sesion.d || "la sesión"} pasa al ${mover.dia}` : ""}.` +
				(semaforoDolor ? " Nada exigente hasta que deje de doler; si no mejora, consulta a un profesional." : ""),
		};
	}
	// Ambar
	if (duro) {
		const suave = Math.max(30, Math.round((min * 0.75) / 5) * 5);
		return {
			accion: "cambiar",
			sesion: { dep: sesion.dep, t: "fondo", d: `${suave} min suaves en lugar de: ${sesion.d || sesion.t}`, min: suave, ajustada: true },
			mover,
			texto: `Cambia ${sesion.d || "la sesión dura"} por ${suave} min suaves${mover ? ` y pásala al ${mover.dia}` : ""}.`,
		};
	}
	if (sesion.t === "fondo" && min >= 120) {
		const corto = Math.round((min * 0.7) / 5) * 5;
		return {
			accion: "recortar",
			sesion: { ...sesion, d: `${sesion.d || "Fondo"} (recortado a ${corto} min)`, min: corto, ajustada: true },
			texto: `Recorta el fondo a ${corto} min y sin apretar.`,
		};
	}
	return { accion: "suave", texto: "Mantenla, pero sin apretar." };
}

function mensajeDelDia({ color, razones, positivos }, sesion, ajuste) {
	const circulo = { verde: "🟢", ambar: "🟠", rojo: "🔴" }[color];
	const porque = (color === "verde" ? positivos : razones).slice(0, 2).join(" y ");
	const que = ajuste?.texto
		? ajuste.texto
		: sesion && sesion.t !== "descanso"
			? `Hoy toca ${sesion.d || sesion.t}${sesion.min ? ` (${sesion.min} min)` : ""}.`
			: "Hoy descanso.";
	return `${circulo} ${que}${porque ? ` ${porque.charAt(0).toUpperCase()}${porque.slice(1)}.` : ""}`;
}

async function leerDoc(env, userId, doc) {
	return (await env.GARMIN.get(appKey(userId, doc), "json")) ?? null;
}

async function guardarDoc(env, userId, doc, valor) {
	const v = valor && typeof valor === "object" && !Array.isArray(valor) ? { ...valor, at: Date.now() } : valor;
	await env.GARMIN.put(appKey(userId, doc), JSON.stringify(v));
	return v;
}

const ANIMO = ["", "muy mal", "mal", "normal", "bien", "muy bien"];
const FISICO = ["", "agotado", "cansado", "normal", "bien", "genial"];
const textoSensacion = (n) => [n.animo ? `Ánimo ${ANIMO[n.animo]}` : "", (n.fisico ?? n.nivel) ? `físico ${FISICO[n.fisico ?? n.nivel]}` : ""].filter(Boolean).join(", ");

/** La sensacion y el dolor son uno por dia: anotar otra vez ese dia lo corrige. Las notas se acumulan. */
async function anotarDelDia(env, userId, entrada, max = 300) {
	const lista = (await leerDoc(env, userId, "atleta/diario")) || [];
	const mismo = (n) => n?.fecha === entrada.fecha && n.tipo === entrada.tipo;
	// Si quedaron varias de antes (cuando se acumulaban), se funden en una.
	const previa = lista.filter(mismo).reduce((a, n) => ({ ...a, ...n }), null);
	const resto = lista.filter((n) => !mismo(n));
	const nueva = entrada.borrar ? null : { ...(previa || {}), ...entrada };
	if (nueva) delete nueva.borrar;
	await env.GARMIN.put(appKey(userId, "atleta/diario"), JSON.stringify((nueva ? [...resto, nueva] : resto).slice(-max)));
	return { entrada: nueva, corregida: Boolean(previa) };
}

async function anadirADoc(env, userId, doc, entrada, max = 300) {
	const lista = (await leerDoc(env, userId, doc)) || [];
	const nueva = [...(Array.isArray(lista) ? lista : []), entrada].slice(-max);
	await env.GARMIN.put(appKey(userId, doc), JSON.stringify(nueva));
	return nueva;
}

const planCompleto = (estadoApp) => ({ ...(estadoApp?.next || {}), ...(estadoApp?.plan || {}) });

/** Historico de D1 y la curva de forma. Si el cron aun no ha pasado, trae un trozo. */
async function historico(env, userId) {
	if (!(await prepararEsquema(env))) return { actividades: [], dias: [], curva: [], fc: null, ftp: null };
	let estado = await leerEstado(env, userId);
	const viejo = !estado.last_sync || Date.now() - Date.parse(estado.last_sync) > 3 * 3600 * 1000;
	if (viejo) {
		try {
			await sincronizar(env, userId, estado.done ? { paginas: 1, dias: 5 } : { paginas: 3, dias: 14 });
			estado = await leerEstado(env, userId);
		} catch {
			// Sin Garmin se decide con lo que haya guardado.
		}
	}
	const [actividades, dias] = await Promise.all([
		leerTabla(env, "activities", userId, "start_date"),
		leerTabla(env, "days", userId, "date"),
	]);
	const fc = referenciasFC(actividades, dias, estado);
	const { ftp } = referenciaFTP(actividades, estado);
	return { actividades, dias, curva: curvaDeForma(actividades, fc, ftp), fc, ftp };
}

/** Lo de esta manana, en vivo: la noche de hoy aun no esta en D1. */
async function datosDeHoy(env, userId, fecha) {
	const [sueno, hrv, readiness] = await Promise.all([
		TOOLS.garmin_sleep.run(env, userId, { date: fecha }).catch(() => null),
		TOOLS.garmin_hrv.run(env, userId, { date: fecha }).catch(() => null),
		apiGet(env, userId, `/metrics-service/metrics/trainingreadiness/${fecha}`).catch(() => null),
	]);
	const r = Array.isArray(readiness) ? readiness[0] : readiness;
	return {
		sleep_h: sueno?.sleep_hours || null,
		sleep_score: sueno?.sleep_score ?? null,
		resting_hr: sueno?.resting_hr ?? null,
		hrv: hrv?.last_night_avg ?? sueno?.avg_overnight_hrv ?? null,
		hrv_status: hrv?.status ?? null,
		readiness: r?.score ?? null,
	};
}

/** Lo anotado ese dia: la sensacion (animo y fisico) y el dolor, para enseñarlo y poder corregirlo. */
function anotadoDelDia(diario, dia) {
	const de = (tipo) => diario.filter((n) => n?.fecha === dia && n.tipo === tipo).at(-1) || null;
	const s = de("sensacion"), d = de("dolor");
	return {
		sensacion: s && { animo: s.animo ?? null, fisico: s.fisico ?? s.nivel ?? null, texto: s.texto || null },
		dolor: d && { texto: d.texto || "" },
	};
}

async function calcularHoy(env, userId, { fecha } = {}) {
	const hoy = fecha || fechaLocal();
	const [estadoApp, perfil, diario, hist, datosHoy] = await Promise.all([
		leerDoc(env, userId, "estado/app"),
		leerDoc(env, userId, "atleta/perfil"),
		leerDoc(env, userId, "atleta/diario"),
		historico(env, userId),
		datosDeHoy(env, userId, hoy),
	]);
	const plan = planCompleto(estadoApp);
	const sesion = plan[hoy] || null;
	const forma = hist.curva.at(-1) || null;
	const base = lineaBase(hist.dias, hoy);
	const sem = semaforo({ hoy, datosHoy, base, tsb: forma?.tsb ?? null, diario: diario || [], perfil: perfil || {} });
	const hechoHoy = hist.actividades.filter((a) => a.start_date === hoy);
	// Si ya ha entrenado, no tiene sentido proponerle cambiar la sesion de hoy.
	const ajuste = hechoHoy.length ? null : ajusteDelDia(sesion, sem.color, plan, hoy, sem.dolor);

	return {
		fecha: hoy,
		dia: diaDe(hoy),
		semaforo: sem,
		sesion_prevista: sesion,
		ya_entrenado_hoy: hechoHoy.map((a) => ({ deporte: deporteApp(a.type), min: Math.round((a.duration_s || 0) / 60), nombre: a.name })),
		propuesta: ajuste,
		forma: forma && { forma_ctl: forma.ctl, fatiga_atl: forma.atl, frescura_tsb: forma.tsb, lectura: lecturaFrescura(forma.tsb) },
		datos_hoy: datosHoy,
		linea_base_28d: base,
		entrenador: String(perfil?.entrenador?.nombre || "").trim() || NOMBRE_COACH,
		anotado_hoy: anotadoDelDia(diario || [], hoy),
		mensaje: mensajeDelDia(sem, sesion, ajuste),
		calculado_en: new Date().toISOString(),
	};
}

/**
 * Reglas del plan de una semana. Errores = no se guarda; avisos = se guarda
 * pero se le dice al usuario. Devuelve tambien una version corregida para que
 * quien habla pueda ofrecerla en vez de un simple "no".
 */
function validarSemana(semanaPlan, { objetivo, hoy, colorHoy = null, perfil = {} }) {
	const errores = [];
	const avisos = [];
	const corregido = structuredClone(semanaPlan);
	const fechas = Object.keys(semanaPlan).sort();

	for (const f of fechas) {
		const s = semanaPlan[f];
		if (s == null) continue;
		if (typeof s !== "object" || !TIPOS_SESION.has(s.t) || !DEPORTES_APP.has(s.dep))
			errores.push({ fecha: f, regla: "formato", texto: `La sesión del ${diaDe(f)} necesita dep (${[...DEPORTES_APP].join(", ")}) y t (${[...TIPOS_SESION].join(", ")}).` });
		else if (s.min != null && !(Number(s.min) >= 0 && Number(s.min) <= 600))
			errores.push({ fecha: f, regla: "formato", texto: `Duración no válida el ${diaDe(f)}: ${s.min} min.` });
	}
	if (errores.length) return { errores, avisos, corregido: null };

	for (const f of fechas) {
		const s = semanaPlan[f];
		if (s && s.t !== "descanso" && s.dep !== "fuerza" && !DEPORTES_ENTRENABLES.has(s.dep))
			avisos.push({ fecha: f, regla: "deporte", texto: `El ${diaDe(f)} (${s.dep}) cuenta como carga, pero no lo planifico: solo bici, correr y skimo, y fuerza como complemento.` });
	}

	const intensas = fechas.filter((f) => corregido[f]?.t === "int");
	const max = objetivo.int[1];
	if (intensas.length > max) {
		errores.push({ fecha: null, regla: "max_intensos", texto: `${intensas.length} días intensos: el máximo para "${objetivo.nombre}" es ${max}.` });
		for (const f of intensas.slice(max)) corregido[f] = { ...corregido[f], t: "fondo", d: `Suave (era intenso): ${corregido[f].d || ""}`.trim() };
	}

	for (const f of fechas) {
		const ayer = sumaDias(f, -1);
		if (corregido[f]?.t === "int" && corregido[ayer]?.t === "int") {
			errores.push({ fecha: f, regla: "intensos_seguidos", texto: `Dos días intensos seguidos (${diaDe(ayer)} y ${diaDe(f)}): entre uno y otro, al menos un día suave.` });
			corregido[f] = { ...corregido[f], t: "fondo", d: `Suave (era intenso): ${corregido[f].d || ""}`.trim() };
		} else if (DUROS.has(corregido[f]?.t) && DUROS.has(corregido[ayer]?.t)) {
			avisos.push({ fecha: f, regla: "duros_seguidos", texto: `${diaDe(ayer)} y ${diaDe(f)} son los dos exigentes: vigila como llegas.` });
		}
	}

	if (colorHoy && DUROS.has(corregido[hoy]?.t)) {
		if (colorHoy === "rojo") {
			errores.push({ fecha: hoy, regla: "semaforo", texto: "Hoy estás en rojo: nada exigente." });
			corregido[hoy] = { ...corregido[hoy], t: "rec", d: "30 min muy suaves", min: 30 };
		} else if (colorHoy === "ambar") {
			avisos.push({ fecha: hoy, regla: "semaforo", texto: "Hoy estás en ámbar: mejor suave." });
		}
	}

	const minutos = fechas.reduce((s, f) => s + (corregido[f]?.t === "descanso" ? 0 : Number(corregido[f]?.min) || 0), 0);
	const horas = minutos / 60;
	if (fechas.length >= 5 && horas > 0) {
		if (horas < objetivo.h[0] * 0.85) avisos.push({ fecha: null, regla: "horas", texto: `${round(horas, 1)} h: por debajo de tus ${objetivo.h[0]}-${objetivo.h[1]} h.` });
		if (horas > objetivo.h[1] * 1.15) avisos.push({ fecha: null, regla: "horas", texto: `${round(horas, 1)} h: por encima de tus ${objetivo.h[0]}-${objetivo.h[1]} h.` });
		const fuerza = fechas.filter((f) => corregido[f]?.dep === "fuerza" && corregido[f]?.t !== "descanso").length;
		if (fuerza < objetivo.fuerza) avisos.push({ fecha: null, regla: "fuerza", texto: `${fuerza} de ${objetivo.fuerza} sesiones de fuerza recomendadas.` });
		const larga = Math.max(0, ...fechas.map((f) => Number(corregido[f]?.min) || 0));
		if (minutos > 240 && larga > minutos * 0.45) avisos.push({ fecha: null, regla: "sesion_larga", texto: "Una sola sesión se lleva casi la mitad de la semana: reparte un poco." });
	}

	const lesiones = (perfil.lesiones || []).filter((l) => l && l.estado !== "curada");
	if (lesiones.length && fechas.some((f) => DUROS.has(corregido[f]?.t)))
		avisos.push({ fecha: null, regla: "lesion", texto: `Con ${lesiones.map((l) => l.zona).join(", ")} sin curar, nada exigente que la cargue.` });

	return { errores, avisos, corregido };
}

function resumenSemana(lunes, plan, actividades, hist, objetivo, hoy) {
	const dias = semanaDe(lunes).map((f) => {
		const prevista = plan[f] || null;
		const hecho = actividades
			.filter((a) => a.start_date === f)
			.map(metricasFila);
		let estado;
		if (prevista?.t === "descanso") estado = hecho.length ? "extra" : "descanso";
		else if (prevista) estado = hecho.length ? "hecho" : f < hoy ? "saltado" : "pendiente";
		else estado = hecho.length ? "extra" : "libre";
		return { fecha: f, dia: diaDe(f), prevista, hecho, estado };
	});

	const cargaSemana = (l) =>
		round(actividades.filter((a) => lunesDe(a.start_date) === l).reduce((s, a) => s + cargaDe(a, hist.fc, hist.ftp).carga, 0), 0);
	const previas = [1, 2, 3, 4].map((i) => cargaSemana(sumaDias(lunes, -7 * i)));
	const media = previas.reduce((s, x) => s + x, 0) / 4;
	const carga = cargaSemana(lunes);
	const subidas = [0, 1, 2].every((i) => (i === 0 ? carga : previas[i - 1]) > previas[i] * 1.05 && previas[i] > 0);

	const hechas = dias.flatMap((d) => d.hecho);
	const previstas = dias.filter((d) => d.prevista && d.prevista.t !== "descanso");
	const totales = {
		min_previstos: previstas.reduce((s, d) => s + (Number(d.prevista.min) || 0), 0),
		min_hechos: hechas.reduce((s, h) => s + h.min, 0),
		sesiones_previstas: previstas.length,
		sesiones_hechas: dias.filter((d) => d.estado === "hecho").length,
		saltadas: dias.filter((d) => d.estado === "saltado").length,
		intensas_hechas: hechas.filter((h) => h.intensidad === "int").length,
		fuerza_hecha: hechas.filter((h) => h.deporte === "fuerza").length,
	};

	const avisos = [];
	const semanaAcabada = sumaDias(lunes, 6) < hoy;
	if (media > 0 && carga > media * 1.3 && semanaAcabada)
		avisos.push(`La carga ha subido un ${Math.round((carga / media - 1) * 100)} % sobre tu media de 4 semanas: sube poco a poco.`);
	if (subidas) avisos.push("Llevas tres semanas subiendo carga: la siguiente toca descarga (un 30-40 % menos).");
	if (semanaAcabada && totales.fuerza_hecha < objetivo.fuerza) avisos.push(`Fuerza: ${totales.fuerza_hecha} de ${objetivo.fuerza}.`);
	if (totales.intensas_hechas > objetivo.int[1]) avisos.push(`${totales.intensas_hechas} días intensos hechos: más de los ${objetivo.int[1]} recomendados.`);

	return {
		lunes,
		dias,
		totales,
		carga: { semana: carga, media_4_semanas: round(media, 0), rampa_pct: media ? Math.round((carga / media - 1) * 100) : null },
		avisos,
	};
}

const esquemaSesion = {
	type: ["object", "null"],
	description: "Sesion del dia, o null para dejarlo libre.",
	properties: {
		dep: { type: "string", description: "bici, correr o skimo; fuerza como complemento" },
		t: { type: "string", description: "rec, fondo, tempo, int, otros o descanso" },
		ajustada: { type: "boolean", description: "true si viene de una propuesta de coach_hoy (no se vuelve a ajustar)" },
		d: { type: "string", description: "Descripcion corta, p. ej. 'Umbral: 3 x 10 min a 160-166 ppm'" },
		min: { type: "number", description: "Duracion en minutos" },
	},
};

const COACH_TOOLS = {
	coach_hoy: {
		title: "Entrenador: que hago hoy",
		description:
			"Semaforo del dia (verde, ambar o rojo) con sus razones, la sesion prevista en el plan de myCoach y, si hace falta, " +
			"la propuesta de ajuste del motor (cambiar, recortar o mover la sesion). Incluye forma, fatiga y frescura, y un " +
			"mensaje corto ya redactado. Es la primera herramienta para '¿que hago hoy?', '¿puedo apretar?' o '¿como estoy?'. " +
			"La decision la toma el motor: explíquela con sus razones, no la cambie por su cuenta.",
		schema: { type: "object", properties: { fecha: { type: "string", description: "YYYY-MM-DD. Por defecto hoy (hora de Madrid)." } } },
		run: async (env, userId, { fecha } = {}) => {
			const hoy = await calcularHoy(env, userId, { fecha });
			if (!fecha || fecha === fechaLocal()) await guardarDoc(env, userId, "coach/hoy", hoy);
			return hoy;
		},
	},

	coach_semana: {
		title: "Entrenador: mi semana",
		description:
			"Semana dia a dia: lo previsto en el plan de myCoach frente a lo hecho en Garmin (hecho, saltado, pendiente, extra), " +
			"totales, carga de la semana frente a la media de 4 semanas, forma actual y avisos del metodo (rampa de carga, " +
			"descarga, fuerza, intensidad). Uselo para revisar la semana o antes de planificar la siguiente. Para ENSENAR la " +
			"semana al usuario, abra la app con mycoach_abrir (pantalla plan) en vez de dibujarla.",
		schema: {
			type: "object",
			properties: {
				semana: { type: "string", description: "'actual' (por defecto), 'anterior', 'siguiente' o una fecha YYYY-MM-DD de esa semana." },
			},
		},
		run: async (env, userId, { semana } = {}) => {
			const hoy = fechaLocal();
			const ref = semana === "siguiente" ? sumaDias(hoy, 7) : semana === "anterior" ? sumaDias(hoy, -7) : /^\d{4}-\d{2}-\d{2}$/.test(semana || "") ? semana : hoy;
			const [estadoApp, perfil, hist] = await Promise.all([
				leerDoc(env, userId, "estado/app"),
				leerDoc(env, userId, "atleta/perfil"),
				historico(env, userId),
			]);
			const objetivo = objetivoDe(estadoApp);
			const plan = planCompleto(estadoApp);
			const lunes = lunesDe(ref);
			const res = resumenSemana(lunes, plan, hist.actividades, hist, objetivo, hoy);
			const semanaPlan = Object.fromEntries(semanaDe(lunes).filter((f) => plan[f]).map((f) => [f, plan[f]]));
			const reglas = validarSemana(semanaPlan, { objetivo, hoy, perfil: perfil || {} });
			const forma = hist.curva.at(-1);
			return {
				objetivo,
				...res,
				plan_cumple_reglas: { errores: reglas.errores, avisos: reglas.avisos },
				siguiente_semana_planificada: semanaDe(sumaDias(lunes, 7)).some((f) => plan[f]),
				forma: forma && { forma_ctl: forma.ctl, fatiga_atl: forma.atl, frescura_tsb: forma.tsb, lectura: lecturaFrescura(forma.tsb) },
			};
		},
	},

	coach_proponer: {
		title: "Entrenador: cambiar el plan",
		write: true,
		description:
			"Propone cambios en el plan de myCoach (esta semana o la siguiente) y el motor los valida con las reglas del metodo: " +
			"maximo de dias intensos segun el objetivo, nada de intensos seguidos, nada exigente con el semaforo en rojo, horas, " +
			"fuerza y lesiones. Con guardar=false (por defecto) solo valida y devuelve errores, avisos y una version corregida. " +
			"Enseñe la propuesta al usuario y, cuando diga que si, llame otra vez con guardar=true. Si hay errores no se guarda: " +
			"ofrezca la version corregida. 'porque' queda registrado como memoria de las decisiones.",
		schema: {
			type: "object",
			properties: {
				cambios: {
					type: "object",
					description: "Mapa fecha YYYY-MM-DD -> sesion { dep, t, d, min } o null para dejar el dia libre.",
					additionalProperties: esquemaSesion,
				},
				porque: { type: "string", description: "Motivo en una frase, p. ej. 'Cena el martes; series al jueves'." },
				guardar: { type: "boolean", description: "true solo cuando el usuario ya ha dicho que si." },
			},
			required: ["cambios", "porque"],
		},
		run: async (env, userId, { cambios, porque, guardar = false } = {}) => {
			if (!cambios || typeof cambios !== "object" || Array.isArray(cambios)) throw new HttpError(400, "cambios debe ser un objeto fecha -> sesion");
			const hoy = fechaLocal();
			const actual = lunesDe(hoy);
			const siguiente = sumaDias(actual, 7);
			const fechas = Object.keys(cambios);
			for (const f of fechas) {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new HttpError(400, `Fecha no valida: ${f}`);
				if (f < hoy) throw new HttpError(400, `El ${f} ya ha pasado: el plan solo se cambia de hoy en adelante.`);
				if (![actual, siguiente].includes(lunesDe(f))) throw new HttpError(400, `El ${f} no es de esta semana ni de la siguiente.`);
			}

			const [estadoApp, perfil, hoyGuardado] = await Promise.all([
				leerDoc(env, userId, "estado/app"),
				leerDoc(env, userId, "atleta/perfil"),
				leerDoc(env, userId, "coach/hoy"),
			]);
			const objetivo = objetivoDe(estadoApp);
			const plan = planCompleto(estadoApp);
			const nuevo = { ...plan };
			for (const [f, s] of Object.entries(cambios)) {
				if (s == null) delete nuevo[f];
				else nuevo[f] = {
					dep: s.dep, t: s.t, d: String(s.d || "").slice(0, 120),
					min: s.min == null ? undefined : Math.round(Number(s.min)),
					...(s.ajustada === true ? { ajustada: true } : {}),
				};
			}
			const colorHoy = hoyGuardado?.fecha === hoy ? hoyGuardado.semaforo?.color : null;

			const semanas = [...new Set(fechas.map(lunesDe))].sort();
			const resultado = semanas.map((l) => {
				const semanaPlan = Object.fromEntries(semanaDe(l).filter((f) => nuevo[f]).map((f) => [f, nuevo[f]]));
				const v = validarSemana(semanaPlan, { objetivo, hoy, colorHoy, perfil: perfil || {} });
				// Con errores, la version corregida completa: lo que cambia respecto al plan de antes.
				const corregidos = v.errores.length && v.corregido
					? Object.fromEntries(semanaDe(l)
						.filter((f) => JSON.stringify(v.corregido[f] ?? null) !== JSON.stringify(plan[f] ?? null))
						.map((f) => [f, v.corregido[f] ?? null]))
					: null;
				return { semana: l, errores: v.errores, avisos: v.avisos, cambios_corregidos: corregidos };
			});
			const errores = resultado.flatMap((r) => r.errores);

			if (!guardar || errores.length) {
				return {
					guardado: false,
					valido: errores.length === 0,
					semanas: resultado,
					siguiente_paso: errores.length
						? "No cumple las reglas. Explique el motivo y ofrezca los cambios_corregidos."
						: "Valido. Enseñe los cambios y, si el usuario dice que si, llame de nuevo con guardar=true.",
				};
			}

			// Mismo reparto que la app: esta semana en 'plan', la siguiente en 'next'.
			const planApp = { ...(estadoApp?.plan || {}) };
			const nextApp = { ...(estadoApp?.next || {}) };
			for (const f of fechas) {
				const destino = lunesDe(f) === actual ? planApp : nextApp;
				const otro = destino === planApp ? nextApp : planApp;
				delete otro[f];
				if (nuevo[f]) destino[f] = nuevo[f];
				else delete destino[f];
			}
			await guardarDoc(env, userId, "estado/app", { ...(estadoApp || {}), plan: planApp, next: Object.keys(nextApp).length ? nextApp : null });
			await anadirADoc(env, userId, "coach/decisiones", { at: new Date().toISOString(), fecha: hoy, cambios, porque: String(porque || "").slice(0, 200) });
			// El semaforo guardado describia el plan viejo.
			if (hoyGuardado && fechas.includes(hoy)) await env.GARMIN.delete(appKey(userId, "coach/hoy"));
			return { guardado: true, avisos: resultado.flatMap((r) => r.avisos), semanas: resultado.map((r) => r.semana) };
		},
	},

	coach_perfil: {
		title: "Entrenador: perfil del deportista",
		description:
			"Perfil del deportista que usa el metodo: objetivo con fecha (evento), disponibilidad (dias y horas), lesiones, " +
			"preferencias (lo que le gusta y lo que no), material (potenciometro, rodillo...) y notas. Lealo al empezar una " +
			"conversacion de entrenamiento. Si esta vacio, pregunte lo basico y guardelo con coach_perfil_guardar.",
		schema: { type: "object", properties: {} },
		run: async (env, userId) => {
			const perfil = (await leerDoc(env, userId, "atleta/perfil")) || {};
			const estadoApp = await leerDoc(env, userId, "estado/app");
			return {
				perfil,
				vacio: Object.keys(perfil).length === 0,
				nombre_entrenador: String(perfil.entrenador?.nombre || "").trim() || NOMBRE_COACH,
				objetivo_app: objetivoDe(estadoApp),
				deportes: estadoApp?.sports ?? [],
				deportes_que_planifico: [...DEPORTES_ENTRENABLES, "fuerza (complemento)"],
			};
		},
	},

	coach_perfil_guardar: {
		title: "Entrenador: guardar en el perfil",
		write: true,
		description:
			"Mezcla campos en el perfil del deportista: objetivo { evento, fecha, tipo }, disponibilidad { dias, horas_semana, " +
			"franjas }, lesiones (lista completa de { zona, desde, estado: activa|mejorando|curada }), preferencias, material y " +
			"notas. Guarde lo que el usuario cuente y deba recordarse, diciendole que lo guarda.",
		schema: {
			type: "object",
			properties: {
				cambios: { type: "object", description: "Campos a mezclar: objetivo, disponibilidad, lesiones, preferencias, material, notas." },
			},
			required: ["cambios"],
		},
		run: async (env, userId, { cambios } = {}) => {
			if (!cambios || typeof cambios !== "object" || Array.isArray(cambios)) throw new HttpError(400, "cambios debe ser un objeto");
			const permitidos = ["objetivo", "disponibilidad", "lesiones", "preferencias", "material", "notas", "entrenador"];
			if (limpio_entrenador_invalido(cambios)) throw new HttpError(400, "entrenador debe ser { nombre } (hasta 24 letras)");
			const limpio = Object.fromEntries(Object.entries(cambios).filter(([k]) => permitidos.includes(k)));
			if (!Object.keys(limpio).length) throw new HttpError(400, `Campos validos: ${permitidos.join(", ")}`);
			const actual = (await leerDoc(env, userId, "atleta/perfil")) || {};
			const nuevo = { ...actual, ...limpio };
			if (JSON.stringify(nuevo).length > 50_000) throw new HttpError(413, "Perfil demasiado grande");
			return { guardado: true, perfil: await guardarDoc(env, userId, "atleta/perfil", nuevo) };
		},
	},

	coach_anotar: {
		title: "Entrenador: anotar como estoy",
		write: true,
		description:
			"Anota en el diario del deportista como esta hoy: el animo y el estado fisico (1 = muy mal / agotado ... 5 = muy bien / genial), " +
			"un dolor o una nota. La sensacion y el dolor son uno por dia: anotarlos otra vez ese dia los corrige (lo que no pases se queda); " +
			"las notas se acumulan. Dolor con borrar=true lo quita (ya no duele). El semaforo tiene en cuenta lo anotado en las ultimas 36 h: " +
			"un dolor lo pone en rojo. Uselo cuando el usuario diga como se encuentra o como le ha ido una sesion.",
		schema: {
			type: "object",
			properties: {
				tipo: { type: "string", enum: ["sensacion", "dolor", "nota"] },
				texto: { type: "string" },
				animo: { type: "integer", minimum: 1, maximum: 5, description: "Sensacion: animo. 1 muy mal, 2 mal, 3 normal, 4 bien, 5 muy bien." },
				fisico: { type: "integer", minimum: 1, maximum: 5, description: "Sensacion: estado fisico. 1 agotado, 2 cansado, 3 normal, 4 bien, 5 genial." },
				nivel: { type: "integer", minimum: 1, maximum: 5, description: "Antiguo: igual que fisico." },
				borrar: { type: "boolean", description: "Quita la sensacion o el dolor de ese dia." },
				fecha: { type: "string", description: "YYYY-MM-DD. Por defecto hoy." },
			},
			required: ["tipo"],
		},
		run: async (env, userId, { tipo, texto, animo, fisico, nivel, borrar, fecha } = {}) => {
			if (!["sensacion", "dolor", "nota"].includes(tipo)) throw new HttpError(400, "tipo: sensacion, dolor o nota");
			const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha || "") ? fecha : fechaLocal();
			const escala = (v) => (v == null || v === "" ? undefined : Math.min(5, Math.max(1, Math.round(Number(v)))));
			const txt = texto == null ? undefined : String(texto).trim().slice(0, 300);
			if (tipo === "nota") {
				if (!txt) throw new HttpError(400, "La nota necesita texto.");
				const entrada = { fecha: dia, tipo, texto: txt, at: new Date().toISOString() };
				const diario = await anadirADoc(env, userId, "atleta/diario", entrada);
				return { guardado: true, entrada, total: diario.length };
			}
			const entrada = { fecha: dia, tipo, at: new Date().toISOString() };
			if (borrar === true) entrada.borrar = true;
			else if (tipo === "dolor") {
				if (!txt) throw new HttpError(400, "Di que te duele, o borrar=true si ya no.");
				entrada.texto = txt;
			} else {
				const a = escala(animo), f = escala(fisico ?? nivel);
				if (a == null && f == null && !txt) throw new HttpError(400, "Pasa animo, fisico o un texto.");
				if (a != null) entrada.animo = a;
				if (f != null) { entrada.fisico = f; entrada.nivel = f; }
				if (txt !== undefined) entrada.texto = txt;
			}
			const r = await anotarDelDia(env, userId, entrada);
			return { guardado: true, borrado: borrar === true, corregida: r.corregida, entrada: r.entrada };
		},
	},
};

/**
 * Metricas de una actividad guardada en D1, segun su deporte. Velocidad
 * siempre; ritmo en carrera; VAM (metros de subida por hora) cuando hay
 * desnivel; potencia y cadencia cuando el aparato las graba; y la
 * eficiencia (metros por latido), que es la forma de ver mejora sin
 * potenciometro: mas distancia con el mismo pulso.
 */
function metricasFila(a) {
	const dep = deporteApp(a.type);
	const mov = a.moving_duration_s || a.duration_s || 0;
	const v = a.avg_speed_ms || (a.distance_m && mov ? a.distance_m / mov : null);
	const m = {
		deporte: dep,
		nombre: a.name,
		min: Math.round((a.duration_s || 0) / 60),
		km: a.distance_m ? round(a.distance_m / 1000, 1) : null,
		velocidad_kmh: v ? round(v * 3.6, 1) : null,
		ritmo: dep === "correr" ? ritmoKm(v) : null,
		desnivel_m: a.elevation_gain_m ? Math.round(a.elevation_gain_m) : null,
		vam_mh: a.elevation_gain_m > 100 && mov > 0 ? Math.round(a.elevation_gain_m / (mov / 3600)) : null,
		fc_media: a.avg_hr ? Math.round(a.avg_hr) : null,
		fc_max: a.max_hr ? Math.round(a.max_hr) : null,
		potencia_media_w: a.avg_power ? Math.round(a.avg_power) : null,
		potencia_normalizada_w: a.norm_power ? Math.round(a.norm_power) : null,
		cadencia_media: a.avg_cadence ? Math.round(a.avg_cadence) : null,
		metros_por_latido: v && a.avg_hr ? round((v * 60) / a.avg_hr, 2) : null,
		intensidad: intensidadHecha(a),
	};
	return Object.fromEntries(Object.entries(m).filter(([, x]) => x != null));
}

const pesoMedio = (filas, valor, peso) => {
	let s = 0, w = 0;
	for (const f of filas) {
		const x = valor(f), p = peso(f);
		if (typeof x === "number" && x > 0 && p > 0) { s += x * p; w += p; }
	}
	return w ? s / w : null;
};

/** Agregado de un grupo de actividades del mismo deporte. */
function agregado(filas, dep) {
	const mov = (a) => a.moving_duration_s || a.duration_s || 0;
	const dist = filas.reduce((s, a) => s + (a.distance_m || 0), 0);
	const tMov = filas.filter((a) => a.distance_m).reduce((s, a) => s + mov(a), 0);
	const v = tMov ? dist / tMov : null;
	const subidas = filas.filter((a) => (a.elevation_gain_m || 0) > 100);
	const conPulso = filas.filter((a) => a.avg_hr && a.distance_m);
	const latidos = conPulso.reduce((s, a) => s + a.avg_hr * (mov(a) / 60), 0);
	const x = {
		sesiones: filas.length,
		horas: round(filas.reduce((s, a) => s + (a.duration_s || 0), 0) / 3600, 1),
		km: round(dist / 1000, 1),
		desnivel_m: Math.round(filas.reduce((s, a) => s + (a.elevation_gain_m || 0), 0)),
		velocidad_kmh: v ? round(v * 3.6, 1) : null,
		ritmo: dep === "correr" ? ritmoKm(v) : null,
		vam_mh: subidas.length ? Math.round(subidas.reduce((s, a) => s + a.elevation_gain_m, 0) / (subidas.reduce((s, a) => s + mov(a), 0) / 3600)) : null,
		fc_media: round(pesoMedio(filas, (a) => a.avg_hr, mov), 0),
		potencia_media_w: round(pesoMedio(filas, (a) => a.avg_power, mov), 0),
		cadencia_media: round(pesoMedio(filas, (a) => a.avg_cadence, mov), 0),
		metros_por_latido: latidos ? round(conPulso.reduce((s, a) => s + a.distance_m, 0) / latidos, 2) : null,
	};
	return Object.fromEntries(Object.entries(x).filter(([, y]) => y != null));
}

const variacion = (ahora, antes) => (typeof ahora === "number" && typeof antes === "number" && antes > 0 ? round(((ahora - antes) / antes) * 100, 1) : null);

function progresoDeporte(actividades, dep, semanas, hoy) {
	const desde = sumaDias(lunesDe(hoy), -7 * (semanas - 1));
	const propias = actividades.filter((a) => deporteApp(a.type) === dep && a.start_date >= desde && a.start_date <= hoy);
	const porSemana = Array.from({ length: semanas }, (_, i) => sumaDias(desde, 7 * i)).map((l) => ({
		semana: l,
		...agregado(propias.filter((a) => lunesDe(a.start_date) === l), dep),
	}));
	const corte = sumaDias(lunesDe(hoy), -21); // ultimas 4 semanas frente a las 4 anteriores
	const ult = agregado(propias.filter((a) => a.start_date >= corte), dep);
	const ant = agregado(propias.filter((a) => a.start_date < corte && a.start_date >= sumaDias(corte, -28)), dep);
	const mov = (a) => a.moving_duration_s || a.duration_s || 0;
	const mejor = (filtro, clave, etiqueta) => {
		const c = propias.filter(filtro).map((a) => ({ a, m: metricasFila(a) })).filter((x) => x.m[clave] != null)
			.sort((x, y) => (clave === "ritmo" ? 0 : y.m[clave] - x.m[clave]))[0];
		return c ? { que: etiqueta, fecha: c.a.start_date, valor: c.m[clave], nombre: c.a.name } : null;
	};
	return {
		deporte: dep,
		semanas: porSemana,
		ultimas_4_semanas: ult,
		semanas_anteriores_4: ant,
		tendencia_pct: {
			velocidad: variacion(ult.velocidad_kmh, ant.velocidad_kmh),
			metros_por_latido: variacion(ult.metros_por_latido, ant.metros_por_latido),
			fc_media: variacion(ult.fc_media, ant.fc_media),
			potencia: variacion(ult.potencia_media_w, ant.potencia_media_w),
			vam: variacion(ult.vam_mh, ant.vam_mh),
			horas: variacion(ult.horas, ant.horas),
		},
		mejores: [
			mejor((a) => mov(a) >= 2700, "velocidad_kmh", "Sesión más rápida (45 min o más)"),
			mejor(() => true, "desnivel_m", "Más desnivel"),
			mejor((a) => (a.elevation_gain_m || 0) >= 300, "vam_mh", "Mejor VAM (300 m o más de subida)"),
			mejor((a) => mov(a) >= 1200, "potencia_normalizada_w", "Más potencia normalizada (20 min o más)"),
			mejor((a) => mov(a) >= 2700, "metros_por_latido", "Más eficiente (45 min o más)"),
		].filter(Boolean),
		nota: "Velocidad y eficiencia dependen del terreno, el viento y el desnivel: lo que cuenta es la tendencia, no una sesión suelta.",
	};
}

Object.assign(COACH_TOOLS, {
	coach_progreso: {
		title: "Entrenador: progreso por deporte",
		description:
			"Evolucion de un deporte (bici, correr o skimo) semana a semana: sesiones, horas, km, desnivel, velocidad media, " +
			"ritmo (correr), VAM (subida), pulso, potencia, cadencia y eficiencia (metros por latido). Compara las ultimas 4 " +
			"semanas con las 4 anteriores y da los mejores registros del periodo. Uselo para '¿estoy mejorando?' o '¿como voy en bici?'.",
		schema: {
			type: "object",
			properties: {
				deporte: { type: "string", enum: ["bici", "correr", "skimo"] },
				semanas: { type: "integer", minimum: 4, maximum: 52, description: "Cuantas semanas mirar (por defecto 12)." },
			},
			required: ["deporte"],
		},
		run: async (env, userId, { deporte, semanas = 12 } = {}) => {
			if (!DEPORTES_ENTRENABLES.has(deporte)) throw new HttpError(400, "deporte: bici, correr o skimo");
			const hist = await historico(env, userId);
			return progresoDeporte(hist.actividades, deporte, Math.min(52, Math.max(4, Math.round(semanas))), fechaLocal());
		},
	},
});

Object.assign(TOOLS, COACH_TOOLS);

/** Instrucciones del entrenador: como habla y como decide, sea quien sea el que lo llame. */
const instruccionesCoach = (nombre = NOMBRE_COACH) =>
	`\n\nENTRENADOR MYCOACH. Se llama ${nombre}: es el nombre que el usuario le ha puesto (por defecto myCoach). Si el ` +
	"usuario habla de entrenar, de su plan, de como esta o de que hacer hoy, actue como su entrenador, " +
	`${nombre}, con las herramientas coach_*: coach_hoy para el dia, coach_semana para la semana, coach_perfil ` +
	"para su contexto (lealo al empezar; coach_perfil_guardar para lo que deba recordarse) y coach_proponer para cualquier cambio de plan. El metodo lo aplica el motor: no " +
	"invente sesiones ni se salte sus reglas; si el usuario insiste en algo que el motor rechaza, digale que puede hacerlo " +
	"pero que se lo desaconseja y por que. Cambios de plan: primero coach_proponer sin guardar, luego enseñe el resultado y " +
	"guarde solo con su si. Cuando cuente como se encuentra o un dolor, anotelo con coach_anotar. Voz: espanol de Espana, " +
	"tuteando, frases cortas, como un companero que sabe; siempre el porque en una frase; una recomendacion, no un abanico; " +
	"diga que un dato es estimado cuando lo sea; sin calorias ni culpa con la comida; ante dolor o sintomas raros, baje la " +
	"carga y recomiende un profesional, nunca diagnostique." +
	" Planifique solo bici, correr y skimo (y fuerza como complemento); el resto de deportes cuenta como carga pero no se " +
	"planifica. Si el usuario quiere cambiar el nombre del entrenador, guardelo con coach_perfil_guardar en entrenador.nombre." +
	" Para '¿estoy mejorando?' use coach_progreso (velocidad, ritmo, VAM, potencia, cadencia, pulso y eficiencia por deporte)." +
	" DATOS Y GRAFICAS: nunca pida capturas de pantalla. garmin_activity_detail trae todas las metricas y las series de la " +
	"actividad (stamina incluida si el reloj la graba) con un perfil de 24 tramos; si intervals_estado dice que Intervals.icu " +
	"esta conectado, intervals_actividades, intervals_actividad (intervalos y series), intervals_bienestar e intervals_curvas " +
	"(mejores marcas) dan aun mas detalle: eficiencia, desacople, W', zonas de potencia y ritmo, dinamicas de carrera y clima." +
	" PANTALLAS: si el usuario quiere ver su app, su plan, su semana, su forma o sus pueblos, o acaba de cambiar el plan, " +
	"abra la app dentro de la conversacion con mycoach_abrir (pantalla hoy, plan, forma, pueblos o ajustes). Es la app de " +
	"verdad, con sus datos: no dibuje una tarjeta, un grafico ni un artefacto propio imitandola." +
	" FUERZA: cada sesion con ejercicio, series x reps, peso, material y descanso. Antes de proponer, mire fuerza_entrenos " +
	"(entrenos guardados, lo que hizo la ultima vez y los nombres de ejercicio que ya usa: reutilicelos). Para repetir un entreno, " +
	"proponga el ajuste con la ultima vez (si hizo todas las reps, mas reps o mas peso). Si le gusta, guardelo con " +
	"fuerza_entreno_guardar con un nombre (p. ej. 'Pierna A') y el ejercicio de Garmin de cada uno (fuerza_ejercicios_garmin); en el " +
	"plan, el dia de fuerza lleva entreno: '<id>'. Puede mandarlo al reloj con fuerza_enviar_garmin (escribe en Garmin: pida permiso). " +
	"Al acabar: si lo hizo con el reloj, fuerza_desde_garmin; si no, fuerza_registrar con solo lo que cambio. Si subio peso o reps, " +
	"pregunte si lo deja asi para la proxima (actualizar_entreno). El historico, con fuerza_historial." +
	" SERIES Y ENTRENOS DE BICI O CORRER PARA EL RELOJ: con cardio_enviar_garmin, por pasos (calentamiento, bloques que se repiten, " +
	"recuperacion, vuelta a la calma) con objetivo de pulso, potencia, ritmo, velocidad o cadencia. Primero sin confirm para ver la " +
	"vista previa y enseñarsela; solo con su si, confirm=true (escribe en Garmin). Rangos con sus zonas y umbrales; si no los sabe, zona de pulso del reloj.";
const limpio_entrenador_invalido = (c) =>
	c.entrenador !== undefined &&
	(typeof c.entrenador !== "object" || !String(c.entrenador?.nombre || "").trim() || String(c.entrenador.nombre).trim().length > 24);

// ───────────────────────────── Intervals.icu ─────────────────────────────
//
// Segunda fuente de datos, oficial: Intervals.icu es socio de Garmin y
// recibe cada actividad y el bienestar al sincronizar el reloj. Aporta lo
// que Garmin no ensena por su API: eficiencia, desacople, W', tiempo en
// zonas de potencia y ritmo, dinamicas de carrera, clima, curvas de mejores
// marcas y las series completas de cada actividad.
//
// Se conecta con la clave personal del usuario (Intervals.icu → Settings →
// Developer Settings). La clave se guarda cifrada (AES-GCM con una clave
// derivada de SIGNING_KEY): quien lea el KV no puede usarla.

const ICU = "https://intervals.icu";
const icuKey = (userId) => `intervals:${userId}`;

async function claveIcu(env) {
	const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.SIGNING_KEY}|intervals-icu`));
	return crypto.subtle.importKey("raw", bruto, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function cifrar(env, texto) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveIcu(env), new TextEncoder().encode(texto)));
	const todo = new Uint8Array(iv.length + ct.length);
	todo.set(iv);
	todo.set(ct, iv.length);
	return base64url(todo);
}

async function descifrar(env, blob) {
	const todo = bytesFromBase64url(blob);
	const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: todo.slice(0, 12) }, await claveIcu(env), todo.slice(12));
	return new TextDecoder().decode(pt);
}

async function credencialesIcu(env, userId) {
	const guardado = await env.GARMIN.get(icuKey(userId), "json");
	if (!guardado) throw new HttpError(400, "Intervals.icu no está conectado. Se conecta en myCoach → Ajustes → Intervals.icu.");
	return { atleta: guardado.athlete_id, clave: await descifrar(env, guardado.key), nombre: guardado.nombre };
}

async function icuFetch(atleta, clave, ruta, params) {
	const url = new URL(`${ICU}/api/v1${ruta.replace("{id}", encodeURIComponent(atleta))}`);
	for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, String(v));
	const r = await fetch(url, { headers: { Authorization: `Basic ${btoa(`API_KEY:${clave}`)}`, Accept: "application/json" } });
	if (r.status === 401 || r.status === 403) throw new HttpError(401, "Intervals.icu no acepta la clave: vuelve a conectarlo en myCoach → Ajustes.");
	if (r.status === 404) throw new HttpError(404, "Intervals.icu no encuentra eso (¿id correcto?).");
	if (r.status === 429) throw new HttpError(429, "Intervals.icu pide esperar un poco (demasiadas peticiones).");
	if (!r.ok) throw new HttpError(502, `Intervals.icu ha respondido ${r.status}.`);
	return r.json();
}

async function icuGet(env, userId, ruta, params) {
	const { atleta, clave } = await credencialesIcu(env, userId);
	return icuFetch(atleta, clave, ruta, params);
}

const sinNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));
const minutos = (s) => (typeof s === "number" ? round(s / 60, 1) : null);
const esCarreraIcu = (t) => /Run/.test(String(t || ""));

/** Tiempo en zonas: Intervals lo da como segundos por zona (o {id, secs}). */
function zonasIcu(z) {
	if (!Array.isArray(z) || !z.length) return null;
	return z.map((x, i) => (typeof x === "number" ? { zona: `Z${i + 1}`, min: minutos(x) } : { zona: x.id, min: minutos(x.secs) }))
		.filter((x) => x.min > 0);
}

// Campos de la actividad de Intervals.icu → nombre en castellano (y conversion).
const CAMPOS_ICU = [
	["moving_time", "en_movimiento_min", minutos], ["elapsed_time", "total_min", minutos],
	["distance", "distancia_km", (v) => round(v / 1000, 2)], ["average_speed", "velocidad_media_kmh", kmh],
	["max_speed", "velocidad_max_kmh", kmh], ["total_elevation_gain", "desnivel_positivo_m", Math.round],
	["total_elevation_loss", "desnivel_negativo_m", Math.round], ["average_altitude", "altitud_media_m", Math.round],
	["max_altitude", "altitud_max_m", Math.round], ["average_heartrate", "fc_media", Math.round], ["max_heartrate", "fc_max", Math.round],
	["icu_average_watts", "potencia_media_w", Math.round], ["icu_weighted_avg_watts", "potencia_normalizada_w", Math.round],
	["p_max", "potencia_max_w", Math.round], ["icu_ftp", "ftp_w", Math.round], ["icu_intensity", "intensidad_pct", (v) => round(v, 1)],
	["icu_variability_index", "indice_variabilidad", (v) => round(v, 2)], ["icu_efficiency_factor", "factor_eficiencia", (v) => round(v, 2)],
	["icu_power_hr", "vatios_por_latido", (v) => round(v, 2)], ["decoupling", "desacople_pct", (v) => round(v, 1)],
	["icu_training_load", "carga", Math.round], ["hr_load", "carga_pulso", Math.round], ["power_load", "carga_potencia", Math.round],
	["pace_load", "carga_ritmo", Math.round], ["trimp", "trimp", Math.round], ["strain_score", "strain", (v) => round(v, 1)],
	["icu_joules", "trabajo_kj", (v) => Math.round(v / 1000)], ["icu_joules_above_ftp", "trabajo_sobre_ftp_kj", (v) => Math.round(v / 1000)],
	["icu_max_wbal_depletion", "wprime_max_gastado_j", Math.round], ["icu_w_prime", "wprime_j", Math.round],
	["icu_pm_ftp", "ftp_estimado_w", Math.round], ["icu_pm_cp", "potencia_critica_estimada_w", Math.round],
	["average_cadence", "cadencia_media", Math.round], ["average_stride", "zancada_m", (v) => round(v, 2)],
	["average_step_length", "longitud_paso_m", (v) => round(v, 2)], ["average_stance_time", "contacto_suelo_ms", Math.round],
	["average_vertical_oscillation", "oscilacion_vertical_cm", (v) => round(v, 1)], ["average_vertical_ratio", "ratio_vertical_pct", (v) => round(v, 1)],
	["average_leg_spring_stiffness", "rigidez_pierna", (v) => round(v, 1)], ["avg_lr_balance", "balance_izq_pct", (v) => round(v, 1)],
	["polarization_index", "indice_polarizacion", (v) => round(v, 2)], ["icu_rpe", "rpe", Math.round], ["feel", "sensacion", Math.round],
	["calories", "calorias", Math.round], ["carbs_used", "hidratos_usados_g", Math.round], ["carbs_ingested", "hidratos_tomados_g", Math.round],
	["average_temp", "temperatura_media_c", (v) => round(v, 1)], ["average_weather_temp", "temperatura_clima_c", (v) => round(v, 1)],
	["average_feels_like", "sensacion_termica_c", (v) => round(v, 1)], ["average_wind_speed", "viento_medio_kmh", kmh],
	["headwind_percent", "viento_en_contra_pct", Math.round], ["icu_ctl", "forma_ctl_ese_dia", (v) => round(v, 1)],
	["icu_atl", "fatiga_atl_ese_dia", (v) => round(v, 1)], ["icu_hrr", "recuperacion_fc", (v) => (typeof v === "object" ? v : round(v, 1))],
];

function resumirActividadIcu(a) {
	const m = { id: a.id, fecha: a.start_date_local, tipo: a.type, nombre: a.name, dispositivo: a.device_name };
	for (const [campo, nombre, conv] of CAMPOS_ICU) {
		const v = a[campo];
		if (v != null && (typeof v === "number" ? Number.isFinite(v) : true)) m[nombre] = conv(v);
	}
	const v = a.average_speed;
	if (esCarreraIcu(a.type)) {
		m.ritmo_medio = ritmoKm(v);
		if (a.gap) m.ritmo_ajustado_pendiente = ritmoKm(a.gap);
	}
	if (a.total_elevation_gain > 100 && a.moving_time > 0) m.vam_mh = Math.round(a.total_elevation_gain / (a.moving_time / 3600));
	if (v && a.average_heartrate) m.metros_por_latido = round((v * 60) / a.average_heartrate, 2);
	m.zonas_fc_min = zonasIcu(a.icu_hr_zone_times);
	m.zonas_potencia_min = zonasIcu(a.icu_zone_times);
	m.zonas_ritmo_min = zonasIcu(a.pace_zone_times);
	m.series_disponibles = a.stream_types;
	for (const k of ["trainer", "race", "commute"]) if (a[k]) m[k === "trainer" ? "rodillo" : k === "race" ? "competicion" : "desplazamiento"] = true;
	return sinNulos(m);
}

function resumirIntervaloIcu(x) {
	return sinNulos({
		etiqueta: x.label, tipo: x.type, min: minutos(x.moving_time ?? x.elapsed_time), km: x.distance ? round(x.distance / 1000, 2) : null,
		potencia_w: x.average_watts ? Math.round(x.average_watts) : null, potencia_normalizada_w: x.weighted_average_watts ? Math.round(x.weighted_average_watts) : null,
		intensidad_pct: x.intensity ? Math.round(x.intensity) : null, fc_media: x.average_heartrate ? Math.round(x.average_heartrate) : null,
		fc_max: x.max_heartrate ? Math.round(x.max_heartrate) : null, velocidad_kmh: kmh(x.average_speed), ritmo: x.average_speed ? ritmoKm(x.average_speed) : null,
		cadencia: x.average_cadence ? Math.round(x.average_cadence) : null, desnivel_m: x.total_elevation_gain ? Math.round(x.total_elevation_gain) : null,
		pendiente_pct: x.average_gradient != null ? round(x.average_gradient * (Math.abs(x.average_gradient) < 1 ? 100 : 1), 1) : null,
		desacople_pct: x.decoupling != null ? round(x.decoupling, 1) : null, zona: x.zone, wbal_final_j: x.wbal_end != null ? Math.round(x.wbal_end) : null,
	});
}

// Nombres de las series de Intervals.icu.
const SERIES_ICU = {
	watts: ["Potencia", "W"], heartrate: ["Pulso", "ppm"], cadence: ["Cadencia", ""], velocity_smooth: ["Velocidad", "km/h", (v) => v * 3.6],
	altitude: ["Altitud", "m"], grade_smooth: ["Pendiente", "%"], temp: ["Temperatura", "°C"], w_bal: ["W' restante", "J"],
	respiration: ["Respiración", "rpm"], vertical_oscillation: ["Oscilación vertical", "cm"], stance_time: ["Contacto con el suelo", "ms"],
	fixed_heartrate: ["Pulso (corregido)", "ppm"], smo2: ["SmO2", "%"], core_temperature: ["Temperatura corporal", "°C"],
};
const SERIES_ICU_IGNORADAS = new Set(["time", "distance", "latlng", "moving", "fixed_watts", "raw_watts", "torque"]);

function resumirSeriesIcu(streams, n = 24) {
	const lista = Array.isArray(streams) ? streams : [];
	const eje = lista.find((s) => s.type === "distance") || lista.find((s) => s.type === "time");
	const series = [];
	const cols = [];
	for (const st of lista) {
		if (SERIES_ICU_IGNORADAS.has(st.type) || !Array.isArray(st.data)) continue;
		const [nombre, unidad, conv = (v) => v] = SERIES_ICU[st.type] || [st.name || st.type, ""];
		const vals = st.data.filter((v) => typeof v === "number" && Number.isFinite(v)).map(conv);
		const utiles = /watts|heartrate|cadence|velocity/.test(st.type) ? vals.filter((v) => v > 0) : vals;
		if (!utiles.length) continue;
		series.push({ tipo: st.type, nombre, unidad, min: round(Math.min(...utiles), 1), media: round(utiles.reduce((a, b) => a + b, 0) / utiles.length, 1), max: round(Math.max(...utiles), 1), inicio: round(utiles[0], 1), final: round(utiles.at(-1), 1) });
		if (eje && st.data.length === eje.data.length) cols.push({ st, nombre, unidad, conv });
	}
	let perfil = null;
	if (eje && cols.length) {
		const total = Math.max(...eje.data.filter((v) => typeof v === "number"), 0);
		if (total > 0) {
			const tramos = Array.from({ length: n }, () => cols.map(() => []));
			eje.data.forEach((x, i) => {
				if (typeof x !== "number") return;
				const t = Math.min(n - 1, Math.floor((x / total) * n));
				cols.forEach((c, j) => { const v = c.st.data[i]; if (typeof v === "number" && Number.isFinite(v) && !(/watts|heartrate|cadence/.test(c.st.type) && v <= 0)) tramos[t][j].push(v); });
			});
			perfil = {
				eje: eje.type === "distance" ? "km" : "min",
				columnas: cols.map((c) => `${c.nombre}${c.unidad ? ` (${c.unidad})` : ""}`),
				puntos: tramos.map((t, i) => [
					eje.type === "distance" ? round(((i + 1) * total) / n / 1000, 2) : round(((i + 1) * total) / n / 60, 1),
					...t.map((xs, j) => (xs.length ? round(cols[j].conv(xs.reduce((a, b) => a + b, 0) / xs.length), 1) : null)),
				]),
			};
		}
	}
	return { series, perfil };
}

const TIPO_ICU = { bici: "Ride", correr: "Run", skimo: "BackcountrySki" };
const DURACIONES = [[5, "5 s"], [15, "15 s"], [30, "30 s"], [60, "1 min"], [300, "5 min"], [600, "10 min"], [1200, "20 min"], [3600, "60 min"]];
const DISTANCIAS = [[400, "400 m"], [1000, "1 km"], [5000, "5 km"], [10000, "10 km"], [21097, "media maratón"], [42195, "maratón"]];

function resumirCurva(c, tipo) {
	const valor = (xs, ys, objetivo) => {
		const i = (xs || []).findIndex((x) => x >= objetivo);
		return i >= 0 && ys?.[i] != null ? ys[i] : null;
	};
	const puntos = tipo === "ritmo"
		? DISTANCIAS.map(([d, etq]) => {
			const seg = valor(c.distance, c.values, d);
			return seg ? { distancia: etq, tiempo: `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, "0")}`, ritmo: ritmoKm(d / seg) } : null;
		})
		: DURACIONES.map(([s, etq]) => {
			const v = valor(c.secs, c.values, s);
			return v ? { duracion: etq, [tipo === "pulso" ? "ppm" : "vatios"]: Math.round(v) } : null;
		});
	return { periodo: c.label || c.id, desde: c.start_date_local, hasta: c.end_date_local, mejores: puntos.filter(Boolean) };
}

function resumirBienestarIcu(w) {
	return sinNulos({
		fecha: w.id, forma_ctl: w.ctl != null ? round(w.ctl, 1) : null, fatiga_atl: w.atl != null ? round(w.atl, 1) : null,
		rampa: w.rampRate != null ? round(w.rampRate, 1) : null, fc_reposo: w.restingHR, vfc: w.hrv, vfc_sdnn: w.hrvSDNN,
		sueno_h: w.sleepSecs ? round(w.sleepSecs / 3600, 2) : null, sueno_puntuacion: w.sleepScore, sueno_calidad: w.sleepQuality,
		fc_media_sueno: w.avgSleepingHR, readiness: w.readiness, peso_kg: w.weight, grasa_pct: w.bodyFat, vo2max: w.vo2max,
		spo2: w.spO2, respiracion: w.respiration, pasos: w.steps, estres: w.stress, fatiga: w.fatigue, agujetas: w.soreness,
		animo: w.mood, motivacion: w.motivation, lesion: w.injury, comentarios: w.comments,
	});
}

const fechaIso = (v, porDefecto) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : porDefecto);

const INTERVALS_TOOLS = {
	intervals_estado: {
		title: "Intervals.icu: estado",
		description: "Dice si el usuario tiene Intervals.icu conectado a myCoach y con que atleta.",
		schema: { type: "object", properties: {} },
		run: async (env, userId) => {
			const g = await env.GARMIN.get(icuKey(userId), "json");
			return g ? { conectado: true, atleta: g.athlete_id, nombre: g.nombre ?? null, desde: g.at } : { conectado: false, como: "myCoach → Ajustes → Intervals.icu" };
		},
	},

	intervals_conectar: {
		title: "Intervals.icu: conectar",
		write: true,
		description:
			"Conecta Intervals.icu con el id de atleta y la clave personal (Intervals.icu → Settings → Developer Settings). " +
			"Lo normal es hacerlo desde myCoach → Ajustes: si el usuario pega la clave en el chat, conectelo pero recuerdele " +
			"que la clave es como una contrasena.",
		schema: {
			type: "object",
			properties: { athlete_id: { type: "string", description: "p. ej. i123456" }, api_key: { type: "string" } },
			required: ["athlete_id", "api_key"],
		},
		run: async (env, userId, { athlete_id, api_key } = {}) => {
			const atleta = String(athlete_id || "").trim();
			const clave = String(api_key || "").trim();
			if (!/^i?\d{1,12}$/.test(atleta)) throw new HttpError(400, "El id de atleta es como i123456 (en Intervals.icu → Settings).");
			if (clave.length < 8 || clave.length > 200 || /\s/.test(clave)) throw new HttpError(400, "La clave no tiene buena pinta: cópiala entera de Developer Settings.");
			const perfil = await icuFetch(atleta, clave, "/athlete/{id}");
			const nombre = perfil?.name || [perfil?.firstname, perfil?.lastname].filter(Boolean).join(" ") || null;
			await env.GARMIN.put(icuKey(userId), JSON.stringify({ athlete_id: atleta, key: await cifrar(env, clave), nombre, at: new Date().toISOString() }));
			return { conectado: true, atleta, nombre };
		},
	},

	intervals_desconectar: {
		title: "Intervals.icu: desconectar",
		write: true,
		description: "Borra la clave de Intervals.icu guardada para este usuario.",
		schema: { type: "object", properties: {} },
		run: async (env, userId) => {
			await env.GARMIN.delete(icuKey(userId));
			return { conectado: false };
		},
	},

	intervals_actividades: {
		title: "Intervals.icu: actividades",
		description:
			"Actividades de Intervals.icu con todas sus metricas: velocidad, ritmo y ritmo ajustado a la pendiente, potencia " +
			"media y normalizada, intensidad, variabilidad, factor de eficiencia, desacople, carga, W' gastado, cadencia, " +
			"dinamicas de carrera, tiempo en zonas de pulso, potencia y ritmo, RPE, clima y viento. Por defecto, 14 dias.",
		schema: {
			type: "object",
			properties: {
				desde: { type: "string", description: "YYYY-MM-DD" }, hasta: { type: "string", description: "YYYY-MM-DD" },
				limite: { type: "integer", minimum: 1, maximum: 100 },
			},
		},
		run: async (env, userId, { desde, hasta, limite = 30 } = {}) => {
			const hoy = fechaLocal();
			const lista = await icuGet(env, userId, "/athlete/{id}/activities", {
				oldest: fechaIso(desde, sumaDias(hoy, -14)), newest: fechaIso(hasta, hoy), limit: Math.min(100, Math.max(1, limite)),
			});
			return (lista || []).filter((a) => a && a.id && a.type).map(resumirActividadIcu);
		},
	},

	intervals_actividad: {
		title: "Intervals.icu: una actividad a fondo",
		description:
			"Una actividad de Intervals.icu con sus metricas, sus intervalos (cada serie o vuelta con potencia, pulso, " +
			"velocidad, cadencia y desacople) y todas sus series resumidas (min, media, max) con un perfil de 24 tramos: " +
			"sirve para contestar sobre graficas sin pedir capturas.",
		schema: { type: "object", properties: { id: { type: "string", description: "id de Intervals.icu, p. ej. i12345678" } }, required: ["id"] },
		run: async (env, userId, { id } = {}) => {
			if (!/^[\w-]{1,40}$/.test(String(id || ""))) throw new HttpError(400, "id no válido");
			const { atleta, clave } = await credencialesIcu(env, userId);
			const ruta = `/activity/${encodeURIComponent(id)}`;
			const [a, intervalos, streams] = await Promise.all([
				icuFetch(atleta, clave, ruta),
				icuFetch(atleta, clave, `${ruta}/intervals`).catch(() => null),
				icuFetch(atleta, clave, `${ruta}/streams.json`).catch(() => null),
			]);
			return {
				...resumirActividadIcu(a),
				intervalos: (intervalos?.icu_intervals || []).map(resumirIntervaloIcu),
				...resumirSeriesIcu(streams),
			};
		},
	},

	intervals_bienestar: {
		title: "Intervals.icu: bienestar",
		description: "Datos diarios de Intervals.icu: forma y fatiga, rampa, pulso en reposo, VFC, sueno, readiness, peso, VO2max, animo... Por defecto, 14 dias.",
		schema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
		run: async (env, userId, { desde, hasta } = {}) => {
			const hoy = fechaLocal();
			const filas = await icuGet(env, userId, "/athlete/{id}/wellness.json", { oldest: fechaIso(desde, sumaDias(hoy, -14)), newest: fechaIso(hasta, hoy) });
			return (filas || []).map(resumirBienestarIcu);
		},
	},

	intervals_curvas: {
		title: "Intervals.icu: mejores marcas",
		description:
			"Mejores marcas del deportista: potencia (bici: 5 s a 60 min), ritmo (correr: 400 m a maraton) o pulso, en las " +
			"ultimas 6 semanas y en el ultimo ano. Uselo para zonas, objetivos realistas o '¿he mejorado?'.",
		schema: {
			type: "object",
			properties: {
				deporte: { type: "string", enum: ["bici", "correr", "skimo"] },
				tipo: { type: "string", enum: ["potencia", "ritmo", "pulso"] },
			},
			required: ["deporte", "tipo"],
		},
		run: async (env, userId, { deporte, tipo } = {}) => {
			if (!TIPO_ICU[deporte]) throw new HttpError(400, "deporte: bici, correr o skimo");
			const ruta = { potencia: "/athlete/{id}/power-curves.json", ritmo: "/athlete/{id}/pace-curves.json", pulso: "/athlete/{id}/hr-curves.json" }[tipo];
			if (!ruta) throw new HttpError(400, "tipo: potencia, ritmo o pulso");
			const r = await icuGet(env, userId, ruta, { type: TIPO_ICU[deporte], curves: "42d,1y" });
			return { deporte, tipo, curvas: (r?.list || []).map((c) => resumirCurva(c, tipo)) };
		},
	},
};

Object.assign(TOOLS, INTERVALS_TOOLS);

// ─────────────────── myCoach dentro de Claude (MCP Apps) ───────────────────
//
// La app entera se abre dentro de la conversacion como una vista del conector:
// Claude lee el recurso ui://mycoach/app (el HTML de la app, version "mcpapp")
// y lo pinta en un iframe aislado. La vista no tiene red: todo lo pide a Claude
// por postMessage (tools/call), que llama a estas mismas herramientas. Asi la app
// de Claude, la web y el chat comparten estado y metodo.
//
// El HTML lo construye y lo sirve el Worker de la web (repo myCoach,
// dist/mcp-app.html). Aqui se trae por service binding (entre Workers de la
// misma cuenta la URL publica da 404) en cada apertura; la direccion lleva la
// version para que Claude no reutilice una copia vieja.

const APP_UI = "ui://mycoach/app";
const RECURSOS_UI = [{
	uri: APP_UI,
	name: "myCoach",
	title: "myCoach",
	description: "La app myCoach: tu entrenador de hoy, tu semana y tu plan, tu forma y tus pueblos, con tus datos de Garmin.",
	mimeType: "text/html;profile=mcp-app",
	_meta: {
		ui: {
			prefersBorder: true,
			csp: { resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] },
			// El codigo de la app se carga de la web (ver metaApp).
		},
	},
}];

const urlWeb = (env) => env.MYCOACH_URL || "https://mycoach.albertbecervas.workers.dev";

/**
 * El HTML que recibe Claude es pequeno: el codigo (2 MB, sobre todo el mapa de
 * municipios) lo descarga la vista desde la web. Claude en el movil no cargaba
 * la pantalla entera, y asi cada despliegue se ve al momento. Para eso la web
 * tiene que estar en el CSP de la pantalla.
 */
const metaApp = (env, meta) => ({
	...meta,
	ui: {
		...meta.ui,
		csp: { ...meta.ui.csp, resourceDomains: [...meta.ui.csp.resourceDomains, new URL(urlWeb(env)).origin] },
	},
});

// La ultima copia buena, solo por si la web no responde.
let cacheApp = { html: null };
let versionMemo = { uri: null, hasta: 0 };

/**
 * La direccion de la pantalla lleva la version (hash del HTML). Claude guarda
 * la pantalla por su direccion: si no cambiara, seguiria ensenando la vieja
 * despues de desplegar. Se recalcula como mucho una vez por minuto.
 */
async function uriApp(env) {
	if (versionMemo.uri && versionMemo.hasta > Date.now()) return versionMemo.uri;
	const html = await htmlDeLaApp(env);
	versionMemo = { uri: `${APP_UI}?v=${(await sha256Hex(html)).slice(0, 12)}`, hasta: Date.now() + 60 * 1000 };
	return versionMemo.uri;
}

async function htmlDeLaApp(env) {
	// Siempre la version recien desplegada: por el service binding cuesta nada.
	const url = `${urlWeb(env)}/mcp-app`;
	try {
		const r = await (env.MYCOACH ? env.MYCOACH.fetch(new Request(url)) : fetch(url));
		const html = r.ok ? await r.text() : null;
		if (html && html.includes("<html")) {
			cacheApp = { html };
			return html;
		}
	} catch {
		// Sin la web, la ultima copia buena o una pagina que lo diga.
	}
	if (cacheApp.html) return cacheApp.html;
	return `<!doctype html><html lang="es"><meta charset="utf-8"><body style="font:16px system-ui;padding:24px">
<h1 style="font-size:20px">No he podido abrir myCoach</h1><p>La app no responde ahora mismo. Prueba en un momento o abre
<b>mycoach.albertbecervas.workers.dev</b> en el navegador.</p></body></html>`;
}

const PANTALLAS_APP = ["hoy", "plan", "forma", "pueblos", "ajustes"];

Object.assign(TOOLS, {
	mycoach_abrir: {
		title: "Abrir myCoach",
		ui: APP_UI,
		description:
			"Abre la app myCoach dentro de la conversacion, en la pantalla indicada: hoy (el entrenador y la semana), plan, " +
			"forma, pueblos o ajustes. Uselo cuando el usuario quiera ver su app, su plan, su semana, su forma o sus pueblos, " +
			"y despues de guardar un cambio de plan, para que lo vea. La app lee y guarda lo mismo que estas herramientas.",
		schema: {
			type: "object",
			properties: { pantalla: { type: "string", enum: PANTALLAS_APP, description: "Por defecto, hoy." } },
		},
		run: async (env, userId, { pantalla = "hoy" } = {}) => {
			const p = PANTALLAS_APP.includes(pantalla) ? pantalla : "hoy";
			return {
				abierta: true,
				pantalla: p,
				nota: "La app se muestra en la conversacion. Si el cliente no puede ensenar pantallas, el usuario puede abrir mycoach.albertbecervas.workers.dev.",
			};
		},
	},
});

// ──────────────────── Panel: sesion y endpoints ────────────────────

const PANEL_TTL = 1000 * 60 * 60 * 24 * 30;

const cookieDeSesion = (valor, segundos) =>
	`panel=${valor}; Path=/panel; HttpOnly; Secure; SameSite=Lax; Max-Age=${segundos}`;

async function usuarioDelPanel(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const valor = cookie.split(/;\s*/).find((c) => c.startsWith("panel="))?.slice("panel=".length);
	if (!valor) return null;
	const payload = await readBlob(env, decodeURIComponent(valor));
	return payload?.t === "panel" ? payload.sub : null;
}

const redirigeAlPanel = async (env, userId) =>
	new Response(null, {
		status: 302,
		headers: {
			Location: "/panel",
			"Set-Cookie": cookieDeSesion(
				encodeURIComponent(await signBlob(env, { t: "panel", sub: userId, exp: Date.now() + PANEL_TTL })),
				PANEL_TTL / 1000,
			),
		},
	});

async function handlePanelEntrar(request, env) {
	const form = new URLSearchParams(await request.text());
	try {
		const pendingId = form.get("mfa_pending");
		if (pendingId) {
			const pending = await env.GARMIN.get(mfaKey(pendingId), "json");
			if (!pending) return new Response(panelLogin("La verificacion ha caducado. Empieza de nuevo."), { headers: HTML });
			const ticket = await ssoVerifyMfa(form.get("code") || "", pending.method, pending.cookie, pending.flowName);
			await env.GARMIN.put(userKey(pending.userId), JSON.stringify(await exchangeTicket(ticket, pending.flowName)));
			await env.GARMIN.delete(mfaKey(pendingId));
			return redirigeAlPanel(env, pending.userId);
		}

		const email = (form.get("email") || "").trim();
		const password = form.get("password") || "";
		if (!email || !password) return new Response(panelLogin("Rellena email y contrasena."), { headers: HTML });

		const userId = await userIdFor(email);
		const result = await ssoLogin(email, password);

		if (result.mfaRequired) {
			const id = randomToken();
			await env.GARMIN.put(
				mfaKey(id),
				JSON.stringify({ method: result.mfaMethod, cookie: result.cookie, userId, flowName: result.flowName }),
				{ expirationTtl: MFA_TTL },
			);
			return new Response(panelMfa(id, result.mfaMethod), { headers: HTML });
		}

		await env.GARMIN.put(userKey(userId), JSON.stringify(await exchangeTicket(result.ticket, result.flowName)));
		return redirigeAlPanel(env, userId);
	} catch (err) {
		const mensaje = err instanceof HttpError ? err.message : "No se pudo entrar.";
		return new Response(panelLogin(mensaje), { status: 400, headers: HTML });
	}
}

async function handlePanel(request, env, ctx) {
	const { pathname } = new URL(request.url);

	if (pathname === "/panel/entrar" && request.method === "POST") return handlePanelEntrar(request, env);

	if (pathname === "/panel/salir")
		return new Response(null, { status: 302, headers: { Location: "/panel", "Set-Cookie": cookieDeSesion("", 0) } });

	const userId = await usuarioDelPanel(request, env);
	if (!userId) {
		if (pathname !== "/panel") return json({ error: "unauthorized" }, 401);
		return new Response(panelLogin(), { headers: HTML });
	}

	if (pathname === "/panel") return new Response(PANEL_HTML, { headers: HTML });

	if (!(await prepararEsquema(env))) return json({ error: "Falta la base de datos D1." }, 500);

	if (pathname === "/panel/sync" && request.method === "POST") {
		const estado = await leerEstado(env, userId);
		// La primera carga trae mucho de golpe; despues basta con mirar si hay
		// algo nuevo, que es una sola pagina.
		const avance = await sincronizar(env, userId, estado.done ? { paginas: 1, dias: 7 } : { paginas: 5, dias: 15 });
		return json(avance);
	}

	if (pathname === "/panel/ajustes" && request.method === "POST") {
		const cuerpo = await request.json();
		const numero = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
		const estado = await leerEstado(env, userId);
		await guardarEstado(env, {
			...estado,
			user_id: userId,
			hr_rest: numero(cuerpo.hr_rest),
			hr_max: numero(cuerpo.hr_max),
			ftp: numero(cuerpo.ftp),
		});
		return json({ ok: true });
	}

	if (pathname === "/panel/datos") {
		const [actividades, dias, estado] = await Promise.all([
			leerTabla(env, "activities", userId, "start_date"),
			leerTabla(env, "days", userId, "date"),
			leerEstado(env, userId),
		]);
		// Si aun no hay nada, se arranca la primera carga sin hacer esperar a
		// la pagina: ella vuelve a preguntar hasta que aparezcan datos.
		if (!actividades.length) ctx?.waitUntil?.(sincronizar(env, userId, { paginas: 5, dias: 15 }).catch(() => {}));
		return json(resumenPanel(actividades, dias, estado));
	}

	return json({ error: "not_found" }, 404);
}

const FRESCO_HORAS = 6;

/**
 * Descarga diaria. Recorre los usuarios conectados y sincroniza a cada uno;
 * un fallo en uno no puede dejar sin datos a los demas.
 *
 * Los dos Workers (garmin y garmin-2) comparten KV y D1, asi que los dos ven
 * a todos los usuarios: sin este filtro, cada uno pediria a Garmin lo mismo
 * que el otro acaba de pedir, que es justo como se provocan los 429. Saltarse
 * lo que ya esta fresco convierte al segundo cron en lo que deberia ser: una
 * red por si el primero ha fallado.
 */
async function sincronizarTodos(env) {
	if (!(await prepararEsquema(env))) return;
	const limite = Date.now() - FRESCO_HORAS * 3600 * 1000;
	let cursor;
	do {
		const pagina = await env.GARMIN.list({ prefix: "user:", cursor });
		for (const clave of pagina.keys) {
			const userId = clave.name.slice("user:".length);
			try {
				const estado = await leerEstado(env, userId);
				if (estado.done && estado.last_sync && Date.parse(estado.last_sync) > limite) continue;
				await sincronizar(env, userId, estado.done ? { paginas: 1, dias: 10 } : { paginas: 6, dias: 20 });
				// El semaforo de la manana, listo para la web (y para avisos), solo
				// para quien usa myCoach: son tres llamadas mas a Garmin.
				if (await env.GARMIN.get(appKey(userId, "estado/app")))
					await guardarDoc(env, userId, "coach/hoy", await calcularHoy(env, userId));
			} catch {
				// Un usuario con la sesion caducada no puede parar al resto.
			}
		}
		cursor = pagina.list_complete ? null : pagina.cursor;
	} while (cursor);
}

// ─────────────────── Panel: pantallas de acceso ───────────────────

const panelLogin = (error) =>
	page(
		"Tu progreso",
		`<h1>Tu progreso</h1>
<p>Entra con tu cuenta de Garmin para ver tu panel de entrenamiento.</p>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/panel/entrar">
  <label for="email">Email de Garmin</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Contrasena</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
</form>
<p class="note">Para dibujar tu historico, el panel guarda en este servidor tus
actividades y tus datos diarios de Garmin. Ni tu contrasena ni tu email se
almacenan. Si solo quieres usar el conector de Claude, no hace falta que entres aqui.</p>`,
	);

const panelMfa = (pendingId, method) =>
	page(
		"Verificacion",
		`<h1>Verificacion en dos pasos</h1>
<p>Garmin te ha enviado un codigo por ${escapeHtml(method)}.</p>
<form method="post" action="/panel/entrar">
  <input type="hidden" name="mfa_pending" value="${escapeHtml(pendingId)}">
  <label for="code">Codigo</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus>
  <button type="submit">Verificar</button>
</form>`,
	);

const PANEL_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tu progreso</title>
<style>
:root{
  color-scheme: light dark;
  --plano:#f9f9f7; --superficie:#fcfcfb; --tinta:#0b0b0b; --tinta2:#52514e; --apagado:#898781;
  --rejilla:#e1e0d9; --eje:#c3c2b7; --borde:rgba(11,11,11,.10);
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --neutro:#b9b7ae;
  --bien:#0ca30c; --aviso:#fab219; --serio:#ec835a; --critico:#d03b3b;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --plano:#0d0d0d; --superficie:#1a1a19; --tinta:#fff; --tinta2:#c3c2b7; --apagado:#898781;
  --rejilla:#2c2c2a; --eje:#383835; --borde:rgba(255,255,255,.10);
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --neutro:#6b6a63;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--plano);color:var(--tinta);
     font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.5}
.envoltorio{max-width:940px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:24px;flex-wrap:wrap}
h1{font-size:20px;margin:0;font-weight:650}
h2{font-size:15px;margin:0 0 2px;font-weight:600}
a{color:var(--s1)}
.sub{color:var(--tinta2);font-size:13px;margin:0}
.apagado{color:var(--apagado);font-size:12px}
.tarjeta{background:var(--superficie);border:1px solid var(--borde);border-radius:14px;
         padding:18px;margin-bottom:16px}
.heroe{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end}
.cifra{font-size:56px;font-weight:650;line-height:1;letter-spacing:-.02em}
.mini{font-size:24px;font-weight:600;line-height:1.1}
.pastillas{display:flex;gap:20px;flex-wrap:wrap;margin-top:4px}
.delta{font-size:13px;font-weight:600}
.arriba{color:var(--bien)} .abajo{color:var(--critico)}
.leyenda{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--tinta2);margin:6px 0 2px}
.llave{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.rangos{display:flex;gap:6px;margin-left:auto}
.rangos button{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;cursor:pointer;
  border:1px solid var(--borde);background:transparent;color:var(--tinta2)}
.rangos button[aria-pressed="true"]{background:var(--tinta);color:var(--superficie);border-color:transparent}
svg{display:block;width:100%;overflow:visible}
.pista{position:fixed;pointer-events:none;background:var(--superficie);border:1px solid var(--borde);
  border-radius:10px;padding:8px 10px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.14);
  opacity:0;transition:opacity .1s;z-index:9;max-width:230px}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:5px 8px;border-bottom:1px solid var(--rejilla)}
th:first-child,td:first-child{text-align:left}
details{margin-top:10px} summary{cursor:pointer;font-size:13px;color:var(--tinta2)}
.ajustes{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:10px}
.ajustes label{font-size:12px;color:var(--tinta2);display:block}
.ajustes input{width:92px;font:inherit;padding:8px;border-radius:9px;border:1px solid var(--borde);
  background:var(--plano);color:inherit}
.ajustes button{font:inherit;padding:9px 16px;border:0;border-radius:9px;background:var(--tinta);
  color:var(--superficie);font-weight:600;cursor:pointer}
.aviso{background:color-mix(in srgb,var(--aviso) 14%,var(--superficie));border-radius:10px;
  padding:10px 12px;font-size:13px;color:var(--tinta2)}
.cargando{text-align:center;padding:48px 0;color:var(--tinta2)}
</style></head><body>
<div class="envoltorio">
<header>
  <div><h1>Tu progreso</h1><p class="sub" id="periodo">Cargando...</p></div>
  <p class="apagado"><span id="sincro"></span> · <a href="/panel/salir">Salir</a></p>
</header>
<div id="cuerpo"><p class="cargando">Trayendo tus datos de Garmin. La primera vez tarda un poco.</p></div>
</div>
<div class="pista" id="pista"></div>
<script>
var NS = 'http://www.w3.org/2000/svg';
var pista = document.getElementById('pista');
var D = null, rango = 0;

function E(t, a, p) {
  var e = document.createElementNS(NS, t);
  for (var k in a) e.setAttribute(k, a[k]);
  if (p) p.appendChild(e);
  return e;
}
function H(t, a, p) {
  var e = document.createElement(t);
  for (var k in a) {
    if (k === 'html') e.innerHTML = a[k];
    else if (k === 'text') e.textContent = a[k];
    else e.setAttribute(k, a[k]);
  }
  if (p) p.appendChild(e);
  return e;
}
function color(n) { return getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim(); }
function mostrarPista(ev, html) {
  pista.innerHTML = html;
  pista.style.opacity = 1;
  pista.style.left = Math.min(ev.clientX + 14, innerWidth - 240) + 'px';
  pista.style.top = Math.max(8, ev.clientY - 12) + 'px';
}
function ocultarPista() { pista.style.opacity = 0; }

var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(d) { return Number(d.slice(8, 10)) + ' ' + MESES[Number(d.slice(5, 7)) - 1]; }
function fechaMes(d) { return MESES[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(2, 4); }
function num(v, dec) { return v == null ? '-' : Number(v).toFixed(dec == null ? 0 : dec); }

// ─── Dibujo ───

function lienzo(host, alto) {
  host.innerHTML = '';
  var w = Math.max(280, host.clientWidth);
  var s = E('svg', { viewBox: '0 0 ' + w + ' ' + alto, height: alto }, host);
  return { s: s, w: w, h: alto, iz: 42, de: 14, ar: 14, ab: 26 };
}
function ejeY(g, min, max, fmt) {
  for (var i = 0; i <= 4; i++) {
    var v = min + ((max - min) * i) / 4;
    var y = g.h - g.ab - ((v - min) / (max - min || 1)) * (g.h - g.ab - g.ar);
    E('line', { x1: g.iz, x2: g.w - g.de, y1: y, y2: y, stroke: color('rejilla'), 'stroke-width': 1 }, g.s);
    var t = E('text', { x: g.iz - 8, y: y + 4, 'text-anchor': 'end', fill: color('apagado'),
      'font-size': 11, 'font-variant-numeric': 'tabular-nums' }, g.s);
    t.textContent = fmt ? fmt(v) : Math.round(v);
  }
}
function ejeX(g, etiquetas, px) {
  var caben = Math.max(2, Math.floor((g.w - g.iz - g.de) / 86));
  var paso = Math.max(1, Math.ceil(etiquetas.length / caben));
  for (var i = 0; i < etiquetas.length; i += paso) {
    var t = E('text', { x: px(i), y: g.h - 6, 'text-anchor': 'middle', fill: color('apagado'), 'font-size': 11 }, g.s);
    t.textContent = etiquetas[i];
  }
}

function grafLineas(host, puntos, series, opc) {
  opc = opc || {};
  if (!puntos.length) return;
  var g = lienzo(host, opc.alto || 240);
  var vals = [];
  series.forEach(function (se) { puntos.forEach(function (p) { if (p[se.k] != null) vals.push(p[se.k]); }); });
  var max = Math.max.apply(null, vals), min = opc.cero !== false ? 0 : Math.min.apply(null, vals);
  if (max === min) max = min + 1;
  var px = function (i) { return g.iz + (i / Math.max(1, puntos.length - 1)) * (g.w - g.iz - g.de); };
  var py = function (v) { return g.h - g.ab - ((v - min) / (max - min)) * (g.h - g.ab - g.ar); };

  ejeY(g, min, max);
  ejeX(g, puntos.map(function (p) { return opc.mes ? fechaMes(p.d) : fechaCorta(p.d); }), px);

  // Se dibuja de la ultima a la primera para que la serie principal quede
  // encima: la fatiga pica mucho mas alto y si se pinta la ultima tapa justo
  // lo que se viene a mirar.
  series.slice().reverse().forEach(function (se) {
    var d = puntos.map(function (p, i) { return (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(p[se.k] || 0).toFixed(1); }).join(' ');
    if (se.relleno)
      E('path', { d: d + ' L' + px(puntos.length - 1) + ' ' + py(min) + ' L' + px(0) + ' ' + py(min) + ' Z',
        fill: color(se.c), 'fill-opacity': .1, stroke: 'none' }, g.s);
    E('path', { d: d, fill: 'none', stroke: color(se.c), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g.s);
    var ult = puntos[puntos.length - 1][se.k];
    if (ult != null) {
      E('circle', { cx: px(puntos.length - 1), cy: py(ult), r: 4.5, fill: color(se.c),
        stroke: color('superficie'), 'stroke-width': 2 }, g.s);
    }
  });

  var cruz = E('line', { y1: g.ar, y2: g.h - g.ab, stroke: color('eje'), 'stroke-width': 1, opacity: 0 }, g.s);
  var capa = E('rect', { x: g.iz, y: g.ar, width: g.w - g.iz - g.de, height: g.h - g.ab - g.ar, fill: 'transparent' }, g.s);
  capa.addEventListener('mousemove', function (ev) {
    var caja = g.s.getBoundingClientRect();
    var rel = ((ev.clientX - caja.left) / caja.width) * g.w;
    var i = Math.round(((rel - g.iz) / (g.w - g.iz - g.de)) * (puntos.length - 1));
    i = Math.max(0, Math.min(puntos.length - 1, i));
    cruz.setAttribute('x1', px(i)); cruz.setAttribute('x2', px(i)); cruz.setAttribute('opacity', 1);
    var html = '<strong>' + fechaCorta(puntos[i].d) + ' ' + puntos[i].d.slice(0, 4) + '</strong>';
    series.forEach(function (se) {
      html += '<br><span class="llave" style="background:' + color(se.c) + '"></span>' +
        se.n + ': ' + num(puntos[i][se.k], se.dec == null ? 0 : se.dec);
    });
    if (opc.extra) html += opc.extra(puntos[i]);
    mostrarPista(ev, html);
  });
  capa.addEventListener('mouseleave', function () { cruz.setAttribute('opacity', 0); ocultarPista(); });
}

function grafDivergente(host, puntos, clave) {
  if (!puntos.length) return;
  var g = lienzo(host, 150);
  var vals = puntos.map(function (p) { return p[clave] || 0; });
  var tope = Math.max(10, Math.max.apply(null, vals.map(Math.abs)));
  var px = function (i) { return g.iz + (i / Math.max(1, puntos.length - 1)) * (g.w - g.iz - g.de); };
  var py = function (v) { return g.ar + ((tope - v) / (2 * tope)) * (g.h - g.ab - g.ar); };

  ejeY(g, -tope, tope);
  ejeX(g, puntos.map(function (p) { return fechaMes(p.d); }), px);

  var linea = puntos.map(function (p, i) { return (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(p[clave] || 0).toFixed(1); }).join(' ');
  var area = linea + ' L' + px(puntos.length - 1) + ' ' + py(0) + ' L' + px(0) + ' ' + py(0) + ' Z';
  var id = 'c' + Math.random().toString(36).slice(2);
  var defs = E('defs', {}, g.s);
  var c1 = E('clipPath', { id: id + 'a' }, defs);
  E('rect', { x: 0, y: 0, width: g.w, height: py(0) }, c1);
  var c2 = E('clipPath', { id: id + 'b' }, defs);
  E('rect', { x: 0, y: py(0), width: g.w, height: g.h - py(0) }, c2);
  E('path', { d: area, fill: color('s1'), 'fill-opacity': .22, 'clip-path': 'url(#' + id + 'a)' }, g.s);
  E('path', { d: area, fill: color('critico'), 'fill-opacity': .22, 'clip-path': 'url(#' + id + 'b)' }, g.s);
  E('line', { x1: g.iz, x2: g.w - g.de, y1: py(0), y2: py(0), stroke: color('eje'), 'stroke-width': 1 }, g.s);
  E('path', { d: linea, fill: 'none', stroke: color('apagado'), 'stroke-width': 1.2 }, g.s);

  var capa = E('rect', { x: g.iz, y: g.ar, width: g.w - g.iz - g.de, height: g.h - g.ab - g.ar, fill: 'transparent' }, g.s);
  capa.addEventListener('mousemove', function (ev) {
    var caja = g.s.getBoundingClientRect();
    var rel = ((ev.clientX - caja.left) / caja.width) * g.w;
    var i = Math.max(0, Math.min(puntos.length - 1, Math.round(((rel - g.iz) / (g.w - g.iz - g.de)) * (puntos.length - 1))));
    mostrarPista(ev, '<strong>' + fechaCorta(puntos[i].d) + ' ' + puntos[i].d.slice(0, 4) + '</strong><br>Frescura: ' +
      num(puntos[i][clave], 1) + '<br>' + lecturaFrescura(puntos[i][clave]));
  });
  capa.addEventListener('mouseleave', ocultarPista);
}

function grafApilado(host, filas, claves, nombres, colores) {
  if (!filas.length) return;
  var g = lienzo(host, 200);
  var totales = filas.map(function (f) {
    return claves.reduce(function (s, k) { return s + (f.horas[k] || 0); }, 0);
  });
  var max = Math.max(1, Math.max.apply(null, totales));
  var hueco = (g.w - g.iz - g.de) / filas.length;
  var ancho = Math.min(24, Math.max(2, hueco - 2));
  ejeY(g, 0, max, function (v) { return v.toFixed(0) + 'h'; });
  ejeX(g, filas.map(function (f) { return fechaMes(f.semana); }), function (i) { return g.iz + hueco * (i + .5); });

  filas.forEach(function (f, i) {
    var y = g.h - g.ab;
    claves.forEach(function (k, j) {
      var v = f.horas[k] || 0;
      if (!v) return;
      var alto = (v / max) * (g.h - g.ab - g.ar);
      y -= alto;
      var r = E('rect', { x: g.iz + hueco * i + (hueco - ancho) / 2, y: y, width: ancho,
        height: Math.max(1, alto - 2), fill: colores[j], rx: 2 }, g.s);
      r.addEventListener('mousemove', function (ev) {
        var html = '<strong>Semana del ' + fechaCorta(f.semana) + '</strong>';
        claves.forEach(function (k2, j2) {
          if (f.horas[k2]) html += '<br><span class="llave" style="background:' + colores[j2] + '"></span>' +
            nombres[j2] + ': ' + f.horas[k2].toFixed(1) + ' h';
        });
        html += '<br><span class="apagado">En bici: ' + f.km + ' km · ' + f.desnivel +
          ' m</span><br><span class="apagado">Carga total: ' + f.carga + '</span>';
        mostrarPista(ev, html);
      });
      r.addEventListener('mouseleave', ocultarPista);
    });
  });
}

function grafDispersion(host, puntos, unidad) {
  if (!puntos.length) return;
  var g = lienzo(host, 220);
  var vals = puntos.map(function (p) { return p.valor; });
  var min = Math.min.apply(null, vals) * .95, max = Math.max.apply(null, vals) * 1.05;
  var t0 = Date.parse(puntos[0].d), t1 = Date.parse(puntos[puntos.length - 1].d) || t0 + 1;
  var px = function (d) { return g.iz + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (g.w - g.iz - g.de); };
  var py = function (v) { return g.h - g.ab - ((v - min) / (max - min || 1)) * (g.h - g.ab - g.ar); };
  ejeY(g, min, max, function (v) { return v.toFixed(1); });
  ejeX(g, puntos.map(function (p) { return fechaMes(p.d); }), function (i) { return px(puntos[i].d); });

  // Mediana movil: una salida suelta depende del viento y del desnivel; lo
  // que se lee es la tendencia.
  if (puntos.length >= 9) {
    var suave = puntos.map(function (_, i) {
      var trozo = puntos.slice(Math.max(0, i - 4), i + 5).map(function (q) { return q.valor; }).sort(function (a, b) { return a - b; });
      return trozo[Math.floor(trozo.length / 2)];
    });
    E('path', { d: puntos.map(function (p, i) { return (i ? 'L' : 'M') + px(p.d).toFixed(1) + ' ' + py(suave[i]).toFixed(1); }).join(' '),
      fill: 'none', stroke: color('s3'), 'stroke-width': 2, 'stroke-linejoin': 'round' }, g.s);
  }
  puntos.forEach(function (p) {
    var c = E('circle', { cx: px(p.d), cy: py(p.valor), r: 4.5, fill: color('s1'),
      stroke: color('superficie'), 'stroke-width': 2 }, g.s);
    c.addEventListener('mousemove', function (ev) {
      mostrarPista(ev, '<strong>' + fechaCorta(p.d) + ' ' + p.d.slice(0, 4) + '</strong><br>' +
        p.valor.toFixed(2) + ' ' + unidad + '<br>' + p.km + ' km · ' + p.desnivel + ' m · ' + p.fc + ' ppm');
    });
    c.addEventListener('mouseleave', ocultarPista);
  });
}

// ─── Lectura en palabras ───

function lecturaFrescura(v) {
  if (v == null) return '';
  if (v > 15) return 'Muy fresco: descansado, y si dura, desentrenando.';
  if (v > 5) return 'Fresco: buen dia para apretar.';
  if (v > -10) return 'En equilibrio: carga sostenible.';
  if (v > -25) return 'Cargado: normal en una semana fuerte.';
  return 'Muy cargado: toca aflojar.';
}
function delta(actual, antes, etiqueta) {
  if (!antes) return '';
  var dif = actual - antes;
  var clase = dif >= 0 ? 'arriba' : 'abajo';
  return '<span style="white-space:nowrap"><span class="delta ' + clase + '">' +
    (dif >= 0 ? '+' : '') + dif.toFixed(1) + '</span> <span class="apagado">vs ' +
    etiqueta + '</span></span>';
}

var NOMBRES = { bici: 'Bici', correr: 'Correr', fuerza: 'Fuerza', otros: 'Otros' };
function nombreDeporte(k) { return NOMBRES[k] || k; }

// ─── Montaje ───

function recorta(curva) {
  return rango ? curva.slice(Math.max(0, curva.length - rango)) : curva;
}

function pintar() {
  var c = document.getElementById('cuerpo');
  c.innerHTML = '';
  var t = D.total, hoy = D.hoy;

  document.getElementById('periodo').textContent =
    (t.desde ? 'Desde ' + fechaCorta(t.desde) + ' de ' + t.desde.slice(0, 4) + ' · ' : '') +
    t.actividades + ' actividades · ' + t.horas + ' h · ' + t.km.toLocaleString('es') + ' km · ' +
    t.desnivel.toLocaleString('es') + ' m de desnivel';
  document.getElementById('sincro').textContent = D.estado.ultima
    ? 'Actualizado ' + new Date(D.estado.ultima).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  // Heroe: la forma fisica de hoy y con que se compara.
  var heroe = H('div', { class: 'tarjeta' }, c);
  H('h2', { text: 'Forma fisica' }, heroe);
  H('p', { class: 'sub', text: 'Cuanto entrenamiento llevas acumulado. Sube cuando entrenas mas de lo que venias haciendo.' }, heroe);
  var fila = H('div', { class: 'heroe' }, heroe);
  var izq = H('div', {}, fila);
  H('div', { class: 'cifra', text: num(hoy.ctl, 1) }, izq);
  H('div', { class: 'pastillas', html:
    delta(hoy.ctl, D.hace30, '30 dias') + delta(hoy.ctl, D.hace90, '90 dias') +
    (D.hace365 ? delta(hoy.ctl, D.hace365, 'un año') : '') }, izq);
  if (D.mejor && D.mejor.ctl)
    H('div', { class: 'apagado', text: 'El ' + Math.round((hoy.ctl / D.mejor.ctl) * 100) +
      '% de tu maximo historico.' }, izq);
  var der = H('div', {}, fila);
  H('div', { class: 'mini', text: num(hoy.tsb, 1) }, der);
  H('div', { class: 'apagado', text: 'Frescura hoy. ' + lecturaFrescura(hoy.tsb) }, der);
  if (D.mejor)
    H('div', { class: 'apagado', text: 'Tu maximo fue ' + num(D.mejor.ctl, 1) +
      ' el ' + fechaCorta(D.mejor.d) + ' de ' + D.mejor.d.slice(0, 4) + '.' }, der);

  // Curva principal
  var tf = H('div', { class: 'tarjeta' }, c);
  var cab = H('div', { style: 'display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap' }, tf);
  var tit = H('div', {}, cab);
  H('h2', { text: 'Condicion fisica desde que empezaste' }, tit);
  H('p', { class: 'sub', text: 'Azul, lo acumulado. Naranja, el cansancio reciente. Cuando el azul sube sostenidamente, estas mejorando.' }, tit);
  var rangos = H('div', { class: 'rangos' }, cab);
  [['Todo', 0], ['1 año', 365], ['6 meses', 183], ['3 meses', 92]].forEach(function (op) {
    var b = H('button', { text: op[0], type: 'button' }, rangos);
    b.setAttribute('aria-pressed', rango === op[1] ? 'true' : 'false');
    b.onclick = function () { rango = op[1]; pintar(); };
  });
  H('div', { class: 'leyenda', html:
    '<span><span class="llave" style="background:var(--s1)"></span>Forma fisica</span>' +
    '<span><span class="llave" style="background:var(--s2)"></span>Fatiga</span>' }, tf);
  var lienzoForma = H('div', {}, tf);
  grafLineas(lienzoForma, recorta(D.curva),
    [{ k: 'ctl', c: 's1', n: 'Forma fisica', relleno: true, dec: 1 }, { k: 'atl', c: 's2', n: 'Fatiga', dec: 1 }],
    { alto: 260, mes: true, extra: function (p) { return p.carga ? '<br><span class="apagado">Carga del dia: ' + p.carga + '</span>' : ''; } });

  var tabla = H('details', {}, tf);
  H('summary', { text: 'Ver los numeros' }, tabla);
  var meses = {};
  D.curva.forEach(function (p) { meses[p.d.slice(0, 7)] = p; });
  var filas = Object.keys(meses).sort().slice(-14).map(function (m) { return meses[m]; });
  H('table', { html: '<tr><th>Mes</th><th>Forma</th><th>Fatiga</th><th>Frescura</th></tr>' +
    filas.map(function (p) {
      return '<tr><td>' + fechaMes(p.d) + '</td><td>' + num(p.ctl, 1) + '</td><td>' +
        num(p.atl, 1) + '</td><td>' + num(p.tsb, 1) + '</td></tr>';
    }).join('') }, tabla);

  // Frescura
  var tfr = H('div', { class: 'tarjeta' }, c);
  H('h2', { text: 'Frescura' }, tfr);
  H('p', { class: 'sub', text: 'Por encima de cero llegas descansado; por debajo, con fatiga acumulada. Las mejores marcas suelen salir volviendo a cero desde abajo.' }, tfr);
  grafDivergente(H('div', {}, tfr), recorta(D.curva), 'tsb');

  // Semanas
  var ts = H('div', { class: 'tarjeta' }, c);
  H('h2', { text: 'Horas por semana' }, ts);
  H('p', { class: 'sub', text: 'Todo lo que haces suma fatiga, no solo la bici.' }, ts);
  var claves = D.semanas.deportes, nombres = claves.map(nombreDeporte);
  var cols = [color('s1'), color('s2'), color('s3'), color('neutro'), color('neutro')];
  H('div', { class: 'leyenda', html: claves.map(function (k, j) {
    return '<span><span class="llave" style="background:' + cols[j] + '"></span>' + nombres[j] + '</span>';
  }).join('') }, ts);
  var semanas = D.semanas.filas;
  grafApilado(H('div', {}, ts), rango ? semanas.slice(-Math.ceil(rango / 7)) : semanas, claves, nombres, cols);

  // Eficiencia
  if (D.eficiencia.length >= 3) {
    var te = H('div', { class: 'tarjeta' }, c);
    H('h2', { text: 'Eficiencia: metros por pulsacion' }, te);
    H('p', { class: 'sub', text: 'Cuanto avanzas por cada latido, en salidas de bici de mas de 45 minutos. Sin potenciometro, es la mejor señal de que estas mejorando: mas metros con el mismo pulso. El viento y el desnivel mueven cada punto, asi que mira la linea, no el dia suelto.' }, te);
    grafDispersion(H('div', {}, te), D.eficiencia, 'm/latido');
  }

  // Potencia y cadencia: el sitio ya esta hecho.
  var tp = H('div', { class: 'tarjeta' }, c);
  H('h2', { text: 'Potencia y cadencia' }, tp);
  if (D.tiene_potencia || D.tiene_cadencia) {
    if (D.tiene_potencia) {
      H('p', { class: 'sub', text: 'Vatios por pulsacion en cada salida: sube cuando mejoras.' }, tp);
      grafDispersion(H('div', {}, tp), D.eficiencia.filter(function (p) { return p.vatios_por_pulso; })
        .map(function (p) { return { d: p.d, valor: p.vatios_por_pulso, km: p.km, desnivel: p.desnivel, fc: p.fc }; }), 'W/latido');
    }
    if (D.tiene_cadencia) H('p', { class: 'sub', text: 'Cadencia registrada: ya entra en la base de datos.' }, tp);
  } else {
    H('p', { class: 'aviso', text: 'Todavia no hay potencia ni cadencia en tus salidas. El panel ya las guarda y las calcula: el dia que conectes un potenciometro, la carga pasa a medirse con vatios en vez de con el pulso y estos graficos aparecen solos, sin tocar nada.' }, tp);
  }

  // Ajustes
  var ta = H('div', { class: 'tarjeta' }, c);
  H('h2', { text: 'Ajustes' }, ta);
  H('p', { class: 'sub', html: 'La carga se calcula ' +
    (D.ajustes.ftp && D.fuentes.indexOf('potencia') >= 0 ? 'con potencia' : 'con tu frecuencia cardiaca') +
    '. Estos valores salen de tus propios datos' + (D.ajustes.hr_auto ? ' automaticamente' : '') +
    '; corrigelos si no cuadran y la curva se recalcula entera.' }, ta);
  var f = H('div', { class: 'ajustes' }, ta);
  [['hr_rest', 'FC en reposo'], ['hr_max', 'FC maxima'], ['ftp', 'FTP (vatios)']].forEach(function (campo) {
    var caja = H('div', {}, f);
    H('label', { text: campo[1], for: campo[0] }, caja);
    var inp = H('input', { id: campo[0], type: 'number', inputmode: 'numeric' }, caja);
    inp.value = D.ajustes[campo[0]] || '';
  });
  var boton = H('button', { text: 'Guardar', type: 'button' }, f);
  boton.onclick = function () {
    boton.textContent = 'Guardando...';
    fetch('/panel/ajustes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hr_rest: document.getElementById('hr_rest').value,
        hr_max: document.getElementById('hr_max').value, ftp: document.getElementById('ftp').value }) })
      .then(cargar);
  };
  if (D.ajustes.ftp_estimado)
    H('p', { class: 'apagado', text: 'El FTP de ' + D.ajustes.ftp + ' W es una estimacion a partir de tus salidas largas. Ponlo a mano si lo conoces.' }, ta);

  // Veredicto en una frase. La forma fisica mide volumen; lo que dice si uno
  // va mejorando de verdad es avanzar mas por latido que el año pasado.
  if (D.progreso) {
    var mejora = D.progreso.variacion;
    var veredicto = H('p', { class: 'aviso', style: 'margin-top:14px' }, heroe);
    veredicto.innerHTML = mejora >= 1
      ? 'Vas mejor que hace un año: rindes un <strong>' + mejora.toFixed(1) +
        '% mas por latido</strong> (' + D.progreso.ahora.toFixed(2) + ' frente a ' +
        D.progreso.antes.toFixed(2) + ' metros). Misma velocidad, menos pulsaciones.'
      : mejora <= -1
        ? 'Ahora mismo rindes un <strong>' + Math.abs(mejora).toFixed(1) +
          '% menos por latido</strong> que hace un año (' + D.progreso.ahora.toFixed(2) +
          ' frente a ' + D.progreso.antes.toFixed(2) + ' metros).'
        : 'Rindes practicamente igual que hace un año: ' + D.progreso.ahora.toFixed(2) +
          ' metros por latido frente a ' + D.progreso.antes.toFixed(2) + '.';
  }

  var pie = H('p', { class: 'apagado', style: 'margin-top:24px' }, c);
  pie.innerHTML = 'Tus datos de Garmin se guardan en este servidor para poder dibujar el historico. ' +
    (D.estado.completo ? '' : 'Todavia se esta trayendo tu historico completo. ') +
    '<a href="#" id="forzar">Actualizar ahora</a>';
  document.getElementById('forzar').onclick = function (ev) {
    ev.preventDefault();
    this.textContent = 'Actualizando...';
    fetch('/panel/sync', { method: 'POST' }).then(cargar);
  };
}

var intentos = 0;
function cargar() {
  return fetch('/panel/datos').then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    if (!d.total || !d.total.actividades) {
      intentos++;
      if (intentos < 40) return setTimeout(cargar, 4000);
      document.getElementById('cuerpo').innerHTML =
        '<p class="cargando">No se han podido traer tus datos. Puede que Garmin este limitando las peticiones; vuelve en unos minutos.</p>';
      return;
    }
    pintar();
    if (!d.estado.completo) { intentos = 0; setTimeout(function () { fetch('/panel/sync', { method: 'POST' }).then(cargar); }, 1500); }
  });
}

var temporizador;
addEventListener('resize', function () { clearTimeout(temporizador); temporizador = setTimeout(function () { if (D) pintar(); }, 200); });
cargar();
</script></body></html>
`;

// ───────────────────── Fuerza: entrenos con nombre, registro, reloj ─────────────────────
//
// Claude propone la sesion (ejercicio, series x reps, peso, material, descanso) y la
// guarda como un entreno con nombre para repetirla. Lo hecho va al registro, por
// ejercicio, para ver el historico. El entreno se puede mandar al reloj como entreno de
// fuerza guiado; al acabar, las series que cuenta el reloj cierran la sesion solas.
//
//   app:<id>:fuerza/entrenos   { entrenos: { <id>: entreno } }
//   app:<id>:fuerza/registro   { sesiones: [sesion] }   (la mas nueva al final)
//
// La plantilla (lo que toca) y el registro (lo hecho) van separados: registrar no
// cambia la plantilla salvo que se pida (actualizar_entreno), asi el historico no se pisa.

const FUERZA_ENTRENOS = "fuerza/entrenos";
const FUERZA_REGISTRO = "fuerza/registro";
const MAX_SESIONES = 500;

const MUSCULOS = {
	ab: "abdominales", ob: "oblicuos", lb: "lumbares", ca: "gemelos", bd: "abductores", bi: "bíceps",
	hi: "cadera", gl: "glúteos", hm: "isquiotibiales", sh: "hombros", tr: "trapecio", ch: "pecho",
	qu: "cuádriceps", la: "dorsales", ad: "aductores", tc: "tríceps", fo: "antebrazo",
};

/** El catalogo de Garmin como mapa "CATEGORIA/EJERCICIO" → { categoria, ejercicio, principales, secundarios }. */
const CATALOGO = (() => {
	const mapa = new Map();
	const codigos = (s) => (s ? s.match(/../g).map((c) => MUSCULOS[c]).filter(Boolean) : []);
	for (const linea of CATALOGO_GARMIN.split("\n")) {
		const [categoria, lista] = linea.split(":");
		for (const item of lista.split(",")) {
			const [ejercicio, musc = ""] = item.split("=");
			const [p, s] = musc.split("/");
			mapa.set(`${categoria}/${ejercicio}`, { categoria, ejercicio, principales: codigos(p), secundarios: codigos(s) });
		}
	}
	return mapa;
})();

// Lo justo para buscar en castellano: cada palabra se traduce a los terminos de Garmin.
const ES_A_GARMIN = [
	[/sentadilla/, "SQUAT"], [/zancada|lunge/, "LUNGE"], [/b[uú]lgara/, "BULGARIAN SPLIT"], [/peso muerto|muerto/, "DEADLIFT"],
	[/rumano/, "ROMANIAN"], [/remo/, "ROW"], [/dominada/, "PULL UP"], [/flexi[oó]n|flexiones/, "PUSH UP"], [/plancha/, "PLANK"],
	[/press banca|banca/, "BENCH PRESS"], [/press militar|militar/, "SHOULDER PRESS"], [/press/, "PRESS"], [/gemelo/, "CALF RAISE"],
	[/puente|hip thrust|empuje de cadera/, "HIP RAISE HIP THRUST BRIDGE"], [/goblet/, "GOBLET"], [/mancuerna/, "DUMBBELL"],
	[/barra/, "BARBELL"], [/kettlebell|pesa rusa/, "KETTLEBELL"], [/banda|goma/, "BAND"], [/hombro/, "SHOULDER"],
	[/curl/, "CURL"], [/abdominal|crunch/, "CRUNCH"], [/core/, "CORE"], [/elevaci[oó]n lateral|laterales/, "LATERAL RAISE"],
	[/aperturas?/, "FLYE"], [/fondos?/, "DIP"], [/tr[ií]ceps/, "TRICEPS"], [/b[ií]ceps/, "CURL"], [/escal[oó]n|step ?up/, "STEP UP"],
	[/isquio|femoral/, "LEG CURL HAMSTRING"], [/nordic|n[oó]rdico/, "NORDIC"], [/pal[oó]f/, "PALLOF"], [/lumbar|hiperextensi[oó]n/, "HYPEREXTENSION BACK EXTENSION"],
	[/swing/, "SWING"], [/prensa/, "LEG PRESS"], [/extensi[oó]n de (cuadr[ií]ceps|piernas?)/, "LEG EXTENSION"], [/jal[oó]n/, "LAT PULLDOWN"],
	[/cable|polea/, "CABLE"], [/lateral/, "LATERAL"], [/una pierna|unilateral/, "SINGLE LEG"], [/copenhague/, "COPENHAGEN"],
	[/tibial/, "TOE RAISE TIBIALIS"], [/farmer|granjero/, "FARMERS"], [/bird ?dog|perro de caza/, "BIRD DOG"], [/dead ?bug|bicho muerto/, "DEAD BUG"],
];

const humanizar = (clave) => clave.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function buscarEjercicioGarmin(consulta, limite = 8) {
	const texto = String(consulta || "").toLowerCase().normalize("NFC");
	const traducido = ES_A_GARMIN.filter(([re]) => re.test(texto)).map(([, en]) => en).join(" ");
	const palabras = `${texto.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} ${traducido}`
		.split(/[^A-Z0-9]+/).filter((p) => p.length > 1);
	if (!palabras.length) return [];
	const puntos = [];
	for (const [clave, e] of CATALOGO) {
		const nombre = e.ejercicio.split("_");
		let p = 0;
		for (const w of new Set(palabras)) {
			if (nombre.includes(w)) p += 3;
			else if (e.ejercicio.includes(w)) p += 1;
			if (e.categoria.split("_").includes(w)) p += 2;
		}
		// Los nombres cortos son el ejercicio basico: "GOBLET_SQUAT" antes que sus mil variantes.
		if (p > 0) puntos.push([p - nombre.length * 0.1, clave]);
	}
	return puntos.sort((a, b) => b[0] - a[0]).slice(0, limite).map(([, clave]) => {
		const e = CATALOGO.get(clave);
		return { categoria: e.categoria, ejercicio: e.ejercicio, nombre: humanizar(e.ejercicio), musculos: e.principales, secundarios: e.secundarios };
	});
}

const slugFuerza = (s) =>
	String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Clave de un ejercicio para el historico: la de Garmin si la tiene; si no, su nombre. */
const claveEjercicio = (e) => (e.garmin ? `${e.garmin.categoria}/${e.garmin.ejercicio}` : `n:${slugFuerza(e.nombre)}`);

const numeroEn = (v, min, max, defecto) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defecto;
};

function normalizarEjercicioFuerza(e, i) {
	if (!e || typeof e !== "object" || typeof e.nombre !== "string" || !e.nombre.trim())
		throw new HttpError(400, `El ejercicio ${i + 1} necesita un nombre.`);
	const salida = { nombre: e.nombre.trim().slice(0, 60) };
	// "8-10" o "8 a 10" → reps 8 y reps_max 10 (doble progresion); un numero, tal cual.
	const rango = String(e.reps ?? "").match(/^\s*(\d+)\s*(?:-|a|–)\s*(\d+)\s*$/);
	salida.series = Math.round(numeroEn(e.series, 1, 10, 3));
	salida.reps = Math.round(rango ? Number(rango[1]) : numeroEn(e.reps, 1, 100, 10));
	const max = rango ? Number(rango[2]) : e.reps_max;
	if (Number.isFinite(Number(max)) && Number(max) > salida.reps) salida.reps_max = Math.round(Number(max));
	// Los de tiempo (plancha, isometricos): segundos por serie en vez de reps.
	if (Number.isFinite(Number(e.segundos)) && Number(e.segundos) > 0) salida.segundos = Math.round(numeroEn(e.segundos, 5, 900, 30));
	if (e.peso_kg !== undefined && e.peso_kg !== null && e.peso_kg !== "") salida.peso_kg = Math.round(numeroEn(e.peso_kg, 0, 500, 0) * 4) / 4;
	if (typeof e.material === "string" && e.material.trim()) salida.material = e.material.trim().slice(0, 40);
	salida.descanso_s = Math.round(numeroEn(e.descanso_s, 0, 600, 90));
	if (typeof e.nota === "string" && e.nota.trim()) salida.nota = e.nota.trim().slice(0, 140);
	if (e.garmin) {
		const clave = `${e.garmin.categoria}/${e.garmin.ejercicio}`;
		if (!CATALOGO.has(clave)) {
			const parecidos = buscarEjercicioGarmin(`${e.nombre} ${String(e.garmin.ejercicio || "").replace(/_/g, " ")}`, 3);
			throw new HttpError(400, `"${clave}" no esta en el catalogo de Garmin (ejercicio "${salida.nombre}"). ` +
				`Parecidos: ${parecidos.map((p) => `${p.categoria}/${p.ejercicio}`).join(", ") || "ninguno"}. Use fuerza_ejercicios_garmin.`);
		}
		salida.garmin = { categoria: e.garmin.categoria, ejercicio: e.garmin.ejercicio };
	}
	return salida;
}

const textoSeries = (series) => {
	if (!series?.length) return "no hecho";
	const cuanto = (x) => (x.segundos ? `${x.segundos} s` : x.reps);
	const iguales = series.every((s) => cuanto(s) === cuanto(series[0]) && s.peso_kg === series[0].peso_kg);
	const peso = (kg) => (kg ? ` · ${kg} kg` : "");
	return iguales
		? `${series.length} × ${cuanto(series[0])}${peso(series[0].peso_kg)}`
		: series.map((s) => `${cuanto(s)}${s.peso_kg ? `×${s.peso_kg}kg` : ""}`).join(", ");
};

const seriesDelPlan = (e) => Array.from({ length: e.series }, () => ({
	reps: e.segundos ? 0 : e.reps, ...(e.segundos ? { segundos: e.segundos } : {}), ...(e.peso_kg !== undefined ? { peso_kg: e.peso_kg } : {}),
}));

/** Minutos aproximados: cada serie (4 s por rep o sus segundos) mas su descanso, y medio minuto entre ejercicios. */
const minutosEntreno = (e) => {
	const s = e.ejercicios.reduce((t, x) => t + x.series * ((x.segundos || x.reps * 4) + (x.descanso_s ?? 90)) + 30, 0);
	return Math.max(5, Math.round(s / 60 / 5) * 5);
};

async function leerFuerza(env, userId) {
	const [entrenos, registro] = await Promise.all([leerDoc(env, userId, FUERZA_ENTRENOS), leerDoc(env, userId, FUERZA_REGISTRO)]);
	return { entrenos: entrenos?.entrenos || {}, sesiones: Array.isArray(registro?.sesiones) ? registro.sesiones : [] };
}

/** La ultima vez que se hizo cada ejercicio (por clave), de lo mas nuevo a lo mas viejo. */
function ultimasVeces(sesiones) {
	const ultima = new Map();
	for (const s of [...sesiones].sort((a, b) => b.fecha.localeCompare(a.fecha)))
		for (const e of s.ejercicios) if (e.series?.length && !ultima.has(e.clave)) ultima.set(e.clave, { fecha: s.fecha, series: e.series, texto: textoSeries(e.series) });
	return ultima;
}

function entrenoConUltima(entreno, sesiones) {
	const ultima = ultimasVeces(sesiones);
	const suyas = sesiones.filter((s) => s.entreno === entreno.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
	return {
		...entreno,
		ejercicios: entreno.ejercicios.map((e) => ({ ...e, plan: textoSeries(seriesDelPlan(e)), ultima: ultima.get(claveEjercicio(e)) || null })),
		ultima_sesion: suyas[0] ? { fecha: suyas[0].fecha, fuente: suyas[0].fuente } : null,
		veces: suyas.length,
		min_estimados: minutosEntreno(entreno),
	};
}

/** Lo que cambio respecto al plan, en frases cortas. */
function cambiosFrenteAlPlan(entreno, hechos) {
	if (!entreno) return [];
	const porClave = new Map(hechos.map((e) => [e.clave, e]));
	const cambios = [];
	for (const p of entreno.ejercicios) {
		const h = porClave.get(claveEjercicio(p));
		if (!h || !h.series.length) { cambios.push({ ejercicio: p.nombre, estado: "no_hecho", texto: `${p.nombre}: no hecho` }); continue; }
		const pesoMax = Math.max(0, ...h.series.map((s) => s.peso_kg || 0));
		const repsMin = Math.min(...h.series.map((s) => s.reps));
		const partes = [];
		if (h.series.length !== p.series) partes.push(`${h.series.length} series (plan ${p.series})`);
		if (p.segundos) {
			const segMin = Math.min(...h.series.map((s) => s.segundos ?? p.segundos));
			if (segMin < p.segundos) partes.push(`${segMin} s (plan ${p.segundos})`);
		} else if (repsMin < p.reps) partes.push(`${repsMin} reps (plan ${p.reps})`);
		if (p.peso_kg !== undefined && pesoMax !== p.peso_kg) partes.push(`${pesoMax} kg (plan ${p.peso_kg})`);
		cambios.push(partes.length
			? { ejercicio: p.nombre, estado: pesoMax > (p.peso_kg ?? 0) ? "mas" : "cambiado", texto: `${p.nombre}: ${partes.join(", ")}` }
			: { ejercicio: p.nombre, estado: "hecho", texto: `${p.nombre}: como estaba` });
	}
	for (const h of hechos) if (!entreno.ejercicios.some((p) => claveEjercicio(p) === h.clave))
		cambios.push({ ejercicio: h.nombre, estado: "extra", texto: `${h.nombre}: fuera del plan (${textoSeries(h.series)})` });
	return cambios;
}

async function guardarSesionFuerza(env, userId, sesion) {
	const { sesiones } = await leerFuerza(env, userId);
	const resto = sesiones.filter((s) => s.id !== sesion.id);
	await guardarDoc(env, userId, FUERZA_REGISTRO, { sesiones: [...resto, sesion].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-MAX_SESIONES) });
	return sesion;
}

/**
 * Une el dia de fuerza del plan a su entreno, si aun no lo esta. Asi la app lo enseña
 * aunque al planificar no se dijera que entreno era. No toca un dia que ya apunta a otro.
 */
async function enlazarEnPlan(env, userId, fecha, entrenoId) {
	if (!entrenoId) return false;
	const estado = await leerDoc(env, userId, "estado/app");
	const clave = estado?.plan?.[fecha] ? "plan" : estado?.next?.[fecha] ? "next" : null;
	const dia = clave && estado[clave][fecha];
	if (!dia || dia.dep !== "fuerza" || dia.entreno) return false;
	estado[clave][fecha] = { ...dia, entreno: entrenoId };
	await guardarDoc(env, userId, "estado/app", estado);
	return true;
}

/** Cierra la sesion con las series que conto el reloj. null si ese dia no hay actividad de fuerza. */
async function sesionDesdeGarmin(env, userId, { fecha, activity_id, entreno: entrenoId }) {
	let actividad = activity_id ? { activityId: activity_id } : null;
	if (!actividad) {
		const lista = await apiGet(env, userId, "/activitylist-service/activities/search/activities", { start: "0", limit: "30" });
		actividad = (lista || []).find((a) => familiaDe(a.activityType?.typeKey) === "fuerza" && (a.startTimeLocal || "").slice(0, 10) === fecha);
		if (!actividad) return null;
	}
	const datos = await apiGet(env, userId, `/activity-service/activity/${actividad.activityId}/exerciseSets`);
	const dia = fecha || (actividad.startTimeLocal || "").slice(0, 10) || fechaLocal();
	const { entrenos, sesiones } = await leerFuerza(env, userId);
	const ya = sesiones.find((s) => String(s.actividad_id) === String(actividad.activityId));
	if (ya) return { sesion: ya, entreno: entrenos[ya.entreno] || null, nueva: false };

	// Las series activas, agrupadas por ejercicio en el orden en que se hicieron.
	const hechos = [];
	for (const s of datos?.exerciseSets || []) {
		if (s.setType !== "ACTIVE") continue;
		const ej = [...(s.exercises || [])].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0] || {};
		const garmin = ej.category && ej.name && CATALOGO.has(`${ej.category}/${ej.name}`) ? { categoria: ej.category, ejercicio: ej.name } : null;
		const clave = garmin ? `${garmin.categoria}/${garmin.ejercicio}` : `n:${slugFuerza(ej.name || ej.category || "sin-identificar")}`;
		// Garmin da el peso en gramos.
		const peso = Number(s.weight);
		const reps = Math.round(Number(s.repetitionCount) || 0);
		// Sin repeticiones y con duracion: un ejercicio de tiempo (plancha).
		const segundos = !reps && Number(s.duration) > 0 ? Math.round(Number(s.duration)) : null;
		const serie = { reps, ...(segundos ? { segundos } : {}), ...(peso > 0 ? { peso_kg: Math.round((peso >= 1000 ? peso / 1000 : peso) * 4) / 4 } : {}) };
		const previo = hechos[hechos.length - 1];
		if (previo && previo.clave === clave) previo.series.push(serie);
		else hechos.push({ clave, garmin, nombre: garmin ? humanizar(garmin.ejercicio) : (ej.name ? humanizar(ej.name) : "Ejercicio sin identificar"), series: [serie] });
	}
	if (!hechos.length) return null;

	// ¿Que entreno era? El indicado, el del plan de ese dia, el que se mando al reloj ese dia o el que mas se parece.
	const plan = await leerDoc(env, userId, "estado/app");
	const delPlan = plan?.plan?.[dia]?.entreno || plan?.next?.[dia]?.entreno;
	const claves = new Set(hechos.map((h) => h.clave));
	const parecido = Object.values(entrenos)
		.map((e) => [e.ejercicios.filter((x) => claves.has(claveEjercicio(x))).length, e])
		.sort((a, b) => b[0] - a[0])[0];
	const entreno = entrenos[entrenoId] || entrenos[delPlan] ||
		Object.values(entrenos).find((e) => e.garmin?.fecha === dia) || (parecido && parecido[0] > 0 ? parecido[1] : null);
	// Con el entreno, los nombres de Garmin se cambian por los del usuario.
	for (const h of hechos) {
		const suyo = entreno?.ejercicios.find((x) => claveEjercicio(x) === h.clave);
		if (suyo) { h.nombre = suyo.nombre; h.garmin = suyo.garmin || h.garmin; }
	}
	if (entreno) await enlazarEnPlan(env, userId, dia, entreno.id);
	const sesion = await guardarSesionFuerza(env, userId, {
		id: `${dia}-${entreno?.id || `garmin-${actividad.activityId}`}`,
		fecha: dia, entreno: entreno?.id || null, nombre: entreno?.nombre || "Fuerza",
		fuente: "garmin", actividad_id: String(actividad.activityId), ejercicios: hechos,
	});
	return { sesion, entreno, nueva: true };
}

/** Un entreno como entreno de fuerza de Garmin: cada ejercicio es una repeticion de (ejercicio + descanso). */
function entrenoParaGarmin(entreno) {
	const deporte = { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 };
	const sinObjetivo = { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 };
	let orden = 0;
	const pasos = entreno.ejercicios.map((e, i) => {
		const grupo = ++orden;
		const ejercicio = {
			type: "ExecutableStepDTO", stepOrder: ++orden, childStepId: i + 1,
			stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
			...(e.segundos
				? { endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true }, endConditionValue: e.segundos }
				: { endCondition: { conditionTypeId: 10, conditionTypeKey: "reps", displayOrder: 10, displayable: true }, endConditionValue: e.reps }),
			targetType: sinObjetivo,
			category: e.garmin.categoria, exerciseName: e.garmin.ejercicio,
			description: [e.nombre, e.material, e.nota].filter(Boolean).join(" · ").slice(0, 512),
			// Garmin guarda el peso con factor 1000 (como python-garminconnect).
			...(e.peso_kg ? { weightValue: e.peso_kg * 1000, weightUnit: { unitId: 8, unitKey: "kilogram", factor: 1000.0 } } : {}),
		};
		const descanso = {
			type: "ExecutableStepDTO", stepOrder: ++orden, childStepId: i + 1,
			stepType: { stepTypeId: 5, stepTypeKey: "rest", displayOrder: 5 },
			endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
			endConditionValue: e.descanso_s || 60, targetType: sinObjetivo,
		};
		return {
			type: "RepeatGroupDTO", stepOrder: grupo, childStepId: i + 1, numberOfIterations: e.series, smartRepeat: false,
			stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
			endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
			endConditionValue: e.series,
			workoutSteps: e.descanso_s === 0 ? [ejercicio] : [ejercicio, descanso],
		};
	});
	return {
		workoutName: `myCoach · ${entreno.nombre}`.slice(0, 80),
		description: "Creado por myCoach",
		sportType: deporte,
		workoutSegments: [{ segmentOrder: 1, sportType: deporte, workoutSteps: pasos }],
	};
}

async function borrarEntrenoGarmin(env, userId, workoutId) {
	const user = await env.GARMIN.get(userKey(userId), "json");
	if (!user?.di_token) return;
	await fetch(`${API}/workout-service/workout/${workoutId}`, {
		method: "DELETE",
		headers: { ...NATIVE_HEADERS, Authorization: `Bearer ${user.di_token}`, Accept: "application/json" },
	}).catch(() => {});
}

const esquemaEjercicio = {
	type: "object",
	properties: {
		nombre: { type: "string", description: "Nombre en castellano, p. ej. 'Sentadilla goblet'. Reutilice los nombres que ya usa el usuario." },
		series: { type: "integer" },
		reps: { description: "Numero (8) o rango ('8-10')." },
		segundos: { type: "integer", description: "Para los de tiempo (plancha): segundos por serie, en lugar de reps." },
		peso_kg: { type: "number", description: "Kg por mano o total, como lo diga el usuario. Omitir si es peso corporal." },
		material: { type: "string", description: "Mancuernas, barra, banda, kettlebell, peso corporal, maquina..." },
		descanso_s: { type: "integer", description: "Descanso entre series, en segundos." },
		nota: { type: "string", description: "Tecnica o variante, corta." },
		garmin: {
			type: "object",
			description: "Ejercicio del catalogo de Garmin (de fuerza_ejercicios_garmin). Necesario para mandarlo al reloj y para el historico desde el reloj.",
			properties: { categoria: { type: "string" }, ejercicio: { type: "string" } },
		},
	},
	required: ["nombre"],
};

Object.assign(TOOLS, {
	fuerza_entrenos: {
		title: "Entrenos de fuerza",
		description:
			"Sin id: la lista de entrenos de fuerza guardados (nombre, lugar, ejercicios, ultima vez) y los nombres de ejercicio que ya usa el usuario. " +
			"Con id: el entreno completo, cada ejercicio con su plan y lo que hizo la ultima vez. Uselo antes de proponer o repetir una sesion de fuerza.",
		schema: { type: "object", properties: { id: { type: "string", description: "Id del entreno (p. ej. 'pierna-a')." } } },
		run: async (env, userId, { id }) => {
			const { entrenos, sesiones } = await leerFuerza(env, userId);
			if (id) {
				const e = entrenos[slugFuerza(id)] || Object.values(entrenos).find((x) => slugFuerza(x.nombre) === slugFuerza(id));
				if (!e) throw new HttpError(404, `No hay ningun entreno "${id}". Entrenos: ${Object.values(entrenos).map((x) => x.nombre).join(", ") || "ninguno"}.`);
				return entrenoConUltima(e, sesiones);
			}
			const nombres = new Set();
			for (const e of Object.values(entrenos)) for (const x of e.ejercicios) nombres.add(x.nombre);
			for (const s of sesiones) for (const x of s.ejercicios) nombres.add(x.nombre);
			return {
				entrenos: Object.values(entrenos).map((e) => {
					const c = entrenoConUltima(e, sesiones);
					return { id: e.id, nombre: e.nombre, lugar: e.lugar || null, ejercicios: e.ejercicios.map((x) => x.nombre), ultima_sesion: c.ultima_sesion, veces: c.veces, min_estimados: c.min_estimados };
				}),
				nombres_de_ejercicio: [...nombres],
			};
		},
	},

	fuerza_entreno_guardar: {
		title: "Guardar un entreno de fuerza",
		description:
			"Crea o cambia un entreno de fuerza con nombre para poder repetirlo: cada ejercicio con series, reps, peso, material y descanso. " +
			"Si un ejercicio ya existe con otro nombre, reutilice ese nombre (fuerza_entrenos los lista) para que el historico sume. " +
			"Ponga el campo garmin de cada ejercicio (fuerza_ejercicios_garmin) si se va a mandar al reloj. Con borrar=true lo elimina.",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Para cambiar uno existente. Si falta, se saca del nombre." },
				nombre: { type: "string", description: "P. ej. 'Pierna A'." },
				lugar: { type: "string", enum: ["casa", "gym"] },
				nota: { type: "string" },
				ejercicios: { type: "array", items: esquemaEjercicio },
				borrar: { type: "boolean" },
				nuevo: { type: "boolean", description: "true para crear uno nuevo (p. ej. al duplicar): falla si ya hay uno con ese nombre en vez de sustituirlo." },
			},
			required: ["nombre"],
		},
		run: async (env, userId, args) => {
			const id = slugFuerza(args.id || args.nombre);
			if (!id) throw new HttpError(400, "El entreno necesita un nombre.");
			const doc = (await leerDoc(env, userId, FUERZA_ENTRENOS)) || { entrenos: {} };
			const entrenos = doc.entrenos || {};
			if (args.borrar) {
				delete entrenos[id];
				await guardarDoc(env, userId, FUERZA_ENTRENOS, { entrenos });
				return { borrado: id };
			}
			if (!Array.isArray(args.ejercicios) || !args.ejercicios.length) throw new HttpError(400, "El entreno necesita al menos un ejercicio.");
			if (args.nuevo && entrenos[id]) throw new HttpError(409, `Ya tienes un entreno que se llama "${entrenos[id].nombre}". Ponle otro nombre.`);
			const previo = entrenos[id];
			const entreno = {
				id, nombre: String(args.nombre).trim().slice(0, 60),
				...(args.lugar === "casa" || args.lugar === "gym" ? { lugar: args.lugar } : previo?.lugar ? { lugar: previo.lugar } : {}),
				...(typeof args.nota === "string" && args.nota.trim() ? { nota: args.nota.trim().slice(0, 200) } : {}),
				ejercicios: args.ejercicios.slice(0, 20).map(normalizarEjercicioFuerza),
				// Si cambia, la copia del reloj queda vieja hasta que se vuelva a mandar.
				...(previo?.garmin ? { garmin: { ...previo.garmin, desactualizado: true } } : {}),
				creado: previo?.creado || fechaLocal(),
				actualizado: fechaLocal(),
			};
			entrenos[id] = entreno;
			await guardarDoc(env, userId, FUERZA_ENTRENOS, { entrenos });
			const sinGarminEj = entreno.ejercicios.filter((e) => !e.garmin).map((e) => e.nombre);
			return {
				guardado: entreno,
				...(sinGarminEj.length ? { aviso: `Sin ejercicio de Garmin (no se pueden mandar al reloj): ${sinGarminEj.join(", ")}. Buscalos con fuerza_ejercicios_garmin.` } : {}),
			};
		},
	},

	fuerza_registrar: {
		title: "Registrar una sesion de fuerza hecha",
		description:
			"Guarda lo que hizo el usuario. Con entreno: lo que no se diga se registra como estaba en el plan; pase solo lo que cambio " +
			"(peso, reps, series) o omitido=true si no lo hizo. Sin entreno: pase todos los ejercicios. Devuelve lo que cambio frente al plan. " +
			"Si subio peso o reps, pregunte si quiere dejarlo asi para la proxima y, si dice que si, llame de nuevo con actualizar_entreno=true. " +
			"Si hizo la sesion con el reloj, mejor fuerza_desde_garmin.",
		schema: {
			type: "object",
			properties: {
				entreno: { type: "string", description: "Id o nombre del entreno." },
				fecha: { type: "string", description: "AAAA-MM-DD; por defecto hoy." },
				ejercicios: {
					type: "array",
					items: {
						type: "object",
						properties: {
							nombre: { type: "string" }, series: { type: "integer" }, reps: { type: "integer" }, segundos: { type: "integer" }, peso_kg: { type: "number" },
							series_hechas: { type: "array", items: { type: "object", properties: { reps: { type: "integer" }, peso_kg: { type: "number" } } }, description: "Serie a serie, si fueron distintas." },
							omitido: { type: "boolean" },
							garmin: { type: "object", properties: { categoria: { type: "string" }, ejercicio: { type: "string" } } },
						},
						required: ["nombre"],
					},
				},
				notas: { type: "string" },
				actualizar_entreno: { type: "boolean", description: "Deja el peso y las reps hechos como plan para la proxima vez." },
			},
		},
		run: async (env, userId, args) => {
			const fecha = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || "") ? args.fecha : fechaLocal();
			const { entrenos } = await leerFuerza(env, userId);
			const entreno = args.entreno ? entrenos[slugFuerza(args.entreno)] || Object.values(entrenos).find((x) => slugFuerza(x.nombre) === slugFuerza(args.entreno)) : null;
			if (args.entreno && !entreno) throw new HttpError(404, `No hay ningun entreno "${args.entreno}".`);
			const dados = Array.isArray(args.ejercicios) ? args.ejercicios : [];
			if (!entreno && !dados.length) throw new HttpError(400, "Sin entreno, pase los ejercicios hechos.");

			const buscarDado = (p) => dados.find((d) => slugFuerza(d.nombre) === slugFuerza(p.nombre) ||
				(d.garmin && p.garmin && d.garmin.ejercicio === p.garmin.ejercicio && d.garmin.categoria === p.garmin.categoria));
			const aSeries = (d, base) => {
				if (d?.omitido) return [];
				if (Array.isArray(d?.series_hechas) && d.series_hechas.length)
					return d.series_hechas.map((s) => ({ reps: Math.round(numeroEn(s.reps, 0, 100, base?.reps ?? 0)), ...(s.peso_kg != null ? { peso_kg: Number(s.peso_kg) } : base?.peso_kg !== undefined ? { peso_kg: base.peso_kg } : {}) }));
				const series = Math.round(numeroEn(d?.series, 0, 10, base?.series ?? 1));
				const reps = Math.round(numeroEn(d?.reps, 0, 100, base?.segundos ? 0 : base?.reps ?? 0));
				const segundos = d?.segundos != null ? Math.round(Number(d.segundos)) : base?.segundos;
				const peso = d?.peso_kg != null ? Number(d.peso_kg) : base?.peso_kg;
				return Array.from({ length: series }, () => ({ reps, ...(segundos ? { segundos } : {}), ...(peso !== undefined ? { peso_kg: peso } : {}) }));
			};
			const hechos = [];
			for (const p of entreno?.ejercicios || []) {
				const d = buscarDado(p);
				hechos.push({ clave: claveEjercicio(p), nombre: p.nombre, ...(p.garmin ? { garmin: p.garmin } : {}), series: aSeries(d, p) });
			}
			for (const d of dados) {
				if (entreno?.ejercicios.some((p) => buscarDado(p) === d)) continue;
				const e = { nombre: String(d.nombre).trim().slice(0, 60), ...(d.garmin && CATALOGO.has(`${d.garmin.categoria}/${d.garmin.ejercicio}`) ? { garmin: { categoria: d.garmin.categoria, ejercicio: d.garmin.ejercicio } } : {}) };
				hechos.push({ clave: claveEjercicio(e), ...e, series: aSeries(d, null) });
			}
			if (entreno) await enlazarEnPlan(env, userId, fecha, entreno.id);
			const sesion = await guardarSesionFuerza(env, userId, {
				id: `${fecha}-${entreno?.id || "libre"}`, fecha, entreno: entreno?.id || null, nombre: entreno?.nombre || "Fuerza",
				fuente: "claude", ejercicios: hechos, ...(typeof args.notas === "string" && args.notas.trim() ? { notas: args.notas.trim().slice(0, 300) } : {}),
			});

			let actualizado = null;
			if (args.actualizar_entreno && entreno) {
				const doc = (await leerDoc(env, userId, FUERZA_ENTRENOS)) || { entrenos: {} };
				const e = doc.entrenos[entreno.id];
				for (const x of e.ejercicios) {
					const h = hechos.find((y) => y.clave === claveEjercicio(x));
					if (!h?.series.length) continue;
					const pesoMax = Math.max(...h.series.map((s) => s.peso_kg ?? -1));
					if (pesoMax >= 0) x.peso_kg = pesoMax;
					x.reps = Math.min(...h.series.map((s) => s.reps));
					x.series = h.series.length;
				}
				if (e.garmin) e.garmin.desactualizado = true;
				e.actualizado = fechaLocal();
				await guardarDoc(env, userId, FUERZA_ENTRENOS, doc);
				actualizado = e;
			}
			return { guardado: sesion, cambios_frente_al_plan: cambiosFrenteAlPlan(entreno, hechos), ...(actualizado ? { entreno_actualizado: actualizado } : {}) };
		},
	},

	fuerza_historial: {
		title: "Historico de fuerza",
		description:
			"Con ejercicio: sus sesiones por fecha (series, reps, peso) y como ha evolucionado. Con entreno: sus sesiones. " +
			"Sin nada: cada ejercicio con su ultima vez y cuantas veces se ha hecho.",
		schema: {
			type: "object",
			properties: {
				ejercicio: { type: "string", description: "Nombre (o parte) del ejercicio." },
				entreno: { type: "string" },
				limite: { type: "integer", description: "Maximo de sesiones (20 por defecto)." },
			},
		},
		run: async (env, userId, { ejercicio, entreno, limite }) => {
			const { sesiones } = await leerFuerza(env, userId);
			const max = Math.round(numeroEn(limite, 1, 100, 20));
			const nuevas = [...sesiones].sort((a, b) => b.fecha.localeCompare(a.fecha));
			if (ejercicio) {
				const q = slugFuerza(ejercicio);
				const claves = new Set();
				for (const s of sesiones) for (const e of s.ejercicios) if (slugFuerza(e.nombre).includes(q) || e.clave.toLowerCase().includes(q.replace(/-/g, "_"))) claves.add(e.clave);
				if (!claves.size) throw new HttpError(404, `No hay registros de "${ejercicio}".`);
				const filas = [];
				for (const s of nuevas) for (const e of s.ejercicios) if (claves.has(e.clave) && e.series.length)
					filas.push({ fecha: s.fecha, entreno: s.nombre, ejercicio: e.nombre, series: e.series, texto: textoSeries(e.series),
						peso_max: Math.max(0, ...e.series.map((x) => x.peso_kg || 0)), volumen_kg: e.series.reduce((t, x) => t + x.reps * (x.peso_kg || 0), 0) });
				const lista = filas.slice(0, max);
				const primera = filas[filas.length - 1], ultima = filas[0];
				return { ejercicio: ultima?.ejercicio, sesiones: lista, evolucion: primera && ultima && primera !== ultima ? `${primera.texto} (${primera.fecha}) → ${ultima.texto} (${ultima.fecha})` : null };
			}
			if (entreno) {
				const id = slugFuerza(entreno);
				return { sesiones: nuevas.filter((s) => s.entreno === id || slugFuerza(s.nombre) === id).slice(0, max)
					.map((s) => ({ fecha: s.fecha, fuente: s.fuente, ejercicios: s.ejercicios.map((e) => `${e.nombre}: ${textoSeries(e.series)}`) })) };
			}
			const porClave = new Map();
			for (const s of nuevas) for (const e of s.ejercicios) {
				if (!e.series.length) continue;
				const x = porClave.get(e.clave) || { ejercicio: e.nombre, ultima: { fecha: s.fecha, texto: textoSeries(e.series) }, veces: 0 };
				x.veces++;
				porClave.set(e.clave, x);
			}
			return { ejercicios: [...porClave.values()] };
		},
	},

	fuerza_ejercicios_garmin: {
		title: "Buscar ejercicios en el catalogo de Garmin",
		description:
			"Busca en el catalogo de ejercicios de fuerza de Garmin (en castellano o en ingles: 'sentadilla goblet', 'romanian deadlift'). " +
			"Devuelve categoria y ejercicio para el campo garmin de fuerza_entreno_guardar, y los musculos que trabaja. Elija el mas parecido al que propone.",
		schema: { type: "object", properties: { buscar: { type: "string" }, limite: { type: "integer" } }, required: ["buscar"] },
		run: async (env, userId, { buscar, limite }) => {
			const encontrados = buscarEjercicioGarmin(buscar, Math.round(numeroEn(limite, 1, 20, 8)));
			return encontrados.length ? { ejercicios: encontrados } : { ejercicios: [], aviso: "Nada parecido: pruebe con el nombre en ingles (squat, lunge, row, press...)." };
		},
	},

	fuerza_enviar_garmin: {
		title: "Mandar un entreno de fuerza al reloj",
		write: true,
		description:
			"Crea el entreno en Garmin Connect como entreno de fuerza guiado (ejercicio, reps, peso y descanso por serie) y lo programa para la fecha, " +
			"para que el reloj lo tenga al sincronizar. Todos los ejercicios necesitan el campo garmin. Si ya se mando antes, sustituye la copia vieja. " +
			"ESCRIBE en la cuenta de Garmin del usuario: pida su confirmacion y pase confirm=true solo cuando la de.",
		schema: {
			type: "object",
			properties: {
				entreno: { type: "string", description: "Id o nombre del entreno." },
				fecha: { type: "string", description: "AAAA-MM-DD en que lo hara; por defecto hoy." },
				confirm: { type: "boolean" },
			},
			required: ["entreno", "confirm"],
		},
		run: async (env, userId, args) => {
			if (args.confirm !== true) throw new HttpError(400, "Falta la confirmacion explicita del usuario.");
			const fecha = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || "") ? args.fecha : fechaLocal();
			const doc = (await leerDoc(env, userId, FUERZA_ENTRENOS)) || { entrenos: {} };
			const entreno = doc.entrenos?.[slugFuerza(args.entreno)] || Object.values(doc.entrenos || {}).find((x) => slugFuerza(x.nombre) === slugFuerza(args.entreno));
			if (!entreno) throw new HttpError(404, `No hay ningun entreno "${args.entreno}".`);
			const sin = entreno.ejercicios.filter((e) => !e.garmin).map((e) => e.nombre);
			if (sin.length) throw new HttpError(400, `Para mandarlo al reloj falta el ejercicio de Garmin de: ${sin.join(", ")}. Buscalos con fuerza_ejercicios_garmin y guarde el entreno.`);

			const creado = await apiPost(env, userId, "/workout-service/workout", entrenoParaGarmin(entreno));
			const workoutId = creado?.workoutId;
			if (!workoutId) throw new HttpError(502, "Garmin no devolvio el id del entreno.");
			let programado = true;
			try { await apiPost(env, userId, `/workout-service/schedule/${workoutId}`, { date: fecha }); } catch { programado = false; }
			if (entreno.garmin?.workout_id && String(entreno.garmin.workout_id) !== String(workoutId)) await borrarEntrenoGarmin(env, userId, entreno.garmin.workout_id);
			entreno.garmin = { workout_id: String(workoutId), fecha, enviado: fechaLocal() };
			await guardarDoc(env, userId, FUERZA_ENTRENOS, doc);
			await enlazarEnPlan(env, userId, fecha, entreno.id);
			return {
				enviado: true, workout_id: String(workoutId), fecha, programado,
				mensaje: programado
					? `"${entreno.nombre}" esta en tu calendario de Garmin para el ${fecha}. Sincroniza el reloj y lo tendras en Entrenamientos.`
					: `"${entreno.nombre}" esta en tus entrenos de Garmin, pero no he podido ponerlo en el calendario: buscalo en Entrenamientos del reloj.`,
			};
		},
	},

	fuerza_desde_garmin: {
		title: "Cerrar la sesion de fuerza con lo que conto el reloj",
		description:
			"Lee las series de la actividad de fuerza del reloj (ejercicio, reps y peso) y la registra como sesion hecha, unida a su entreno. " +
			"Devuelve lo que cambio frente al plan. Uselo cuando el usuario diga que ha acabado la sesion de fuerza con el reloj.",
		schema: {
			type: "object",
			properties: {
				fecha: { type: "string", description: "AAAA-MM-DD; por defecto hoy." },
				activity_id: { type: "string", description: "Si se sabe, la actividad concreta." },
				entreno: { type: "string", description: "Si se sabe, el entreno que era." },
			},
		},
		run: async (env, userId, args) => {
			const fecha = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || "") ? args.fecha : fechaLocal();
			const r = await sesionDesdeGarmin(env, userId, { fecha, activity_id: args.activity_id, entreno: args.entreno && slugFuerza(args.entreno) });
			if (!r) return { registrado: false, motivo: `No hay ninguna actividad de fuerza con series el ${fecha}. ¿La hiciste con el reloj en modo fuerza?` };
			return { registrado: true, nueva: r.nueva, sesion: r.sesion, cambios_frente_al_plan: cambiosFrenteAlPlan(r.entreno, r.sesion.ejercicios) };
		},
	},

	fuerza_dia: {
		title: "La fuerza de un dia (para la app)",
		description:
			"El entreno de fuerza de un dia del plan con su ultima vez, y la sesion hecha si la hay (si no esta registrada y el reloj tiene una actividad de fuerza ese dia, la cierra). " +
			"Lo usa la app; Claude puede usar fuerza_entrenos y fuerza_historial.",
		schema: { type: "object", properties: { fecha: { type: "string" } } },
		run: async (env, userId, args) => {
			const fecha = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || "") ? args.fecha : fechaLocal();
			const plan = await leerDoc(env, userId, "estado/app");
			const sesionPlan = plan?.plan?.[fecha] || plan?.next?.[fecha] || null;
			let { entrenos, sesiones } = await leerFuerza(env, userId);
			// El entreno del dia: el del plan; si el plan no lo dice, el que se hizo o se mando al reloj ese dia.
			const delDia = sesionPlan?.entreno || sesiones.find((s) => s.fecha === fecha && s.entreno)?.entreno ||
				Object.values(entrenos).find((e) => e.garmin?.fecha === fecha)?.id || null;
			let hecha = sesiones.find((s) => s.fecha === fecha && (!delDia || s.entreno === delDia)) || null;
			if (!hecha && fecha <= fechaLocal()) {
				const r = await sesionDesdeGarmin(env, userId, { fecha, entreno: delDia }).catch(() => null);
				if (r) { hecha = r.sesion; ({ entrenos, sesiones } = await leerFuerza(env, userId)); }
			}
			const entreno = entrenos[delDia] || (hecha?.entreno && entrenos[hecha.entreno]) || null;
			if (entreno && sesionPlan?.dep === "fuerza" && !sesionPlan.entreno) await enlazarEnPlan(env, userId, fecha, entreno.id);
			return {
				fecha,
				entreno: entreno ? entrenoConUltima(entreno, sesiones.filter((s) => s.id !== hecha?.id)) : null,
				hecha,
				cambios_frente_al_plan: hecha ? cambiosFrenteAlPlan(entreno, hecha.ejercicios) : [],
			};
		},
	},
});

// ───────────────────── Entrenos de bici y correr para el reloj ─────────────────────
//
// Claude escribe el entreno por pasos (calentamiento, series, recuperacion, vuelta a la
// calma, repeticiones) con su objetivo: pulso (zona del reloj o rango), potencia, ritmo,
// velocidad o cadencia. Sin confirm devuelve la vista previa y no escribe nada; con
// confirm=true lo crea en Garmin Connect como entreno guiado y lo programa para el dia.
// Se guarda con nombre para repetirlo y el dia del plan queda enlazado.
//
//   app:<id>:cardio/entrenos   { entrenos: { <id>: entreno } }

const CARDIO_ENTRENOS = "cardio/entrenos";
const DEPORTES_CARDIO = {
	bici: { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 },
	correr: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
};
const TIPOS_PASO = {
	calentamiento: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
	vuelta_calma: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
	intervalo: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
	recuperacion: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
	descanso: { stepTypeId: 5, stepTypeKey: "rest", displayOrder: 5 },
};
const NOMBRE_PASO = { calentamiento: "Calentamiento", vuelta_calma: "Vuelta a la calma", intervalo: "Serie", recuperacion: "Recuperación", descanso: "Descanso" };
const OBJETIVOS = {
	ninguno: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
	potencia: { workoutTargetTypeId: 2, workoutTargetTypeKey: "power.zone", displayOrder: 2 },
	cadencia: { workoutTargetTypeId: 3, workoutTargetTypeKey: "cadence", displayOrder: 3 },
	fc: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone", displayOrder: 4 },
	velocidad: { workoutTargetTypeId: 5, workoutTargetTypeKey: "speed.zone", displayOrder: 5 },
	ritmo: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone", displayOrder: 6 },
};

/** "4:30" (min/km) → segundos por km. */
const segPorKm = (v) => {
	const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
	if (m) return Number(m[1]) * 60 + Number(m[2]);
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n * 60 : null; // 4.5 → 4:30
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Valida un paso y lo deja en forma canonica; lanza con un mensaje que diga que falta. */
function normalizarPasoCardio(p, ruta) {
	if (p && Array.isArray(p.pasos)) {
		const veces = Math.round(Number(p.repetir));
		if (!(veces >= 2 && veces <= 50)) throw new HttpError(400, `${ruta}: un bloque con pasos necesita repetir entre 2 y 50 veces.`);
		if (!p.pasos.length) throw new HttpError(400, `${ruta}: el bloque que se repite no tiene pasos.`);
		return { repetir: veces, pasos: p.pasos.map((x, i) => normalizarPasoCardio(x, `${ruta}.${i + 1}`)) };
	}
	if (!p || !TIPOS_PASO[p.tipo]) throw new HttpError(400, `${ruta}: tipo de paso no valido (${p?.tipo}). Use ${Object.keys(TIPOS_PASO).join(", ")}, o { repetir, pasos }.`);
	const salida = { tipo: p.tipo };
	if (Number(p.duracion_s) > 0) salida.duracion_s = Math.round(numeroEn(p.duracion_s, 5, 6 * 3600, 60));
	else if (Number(p.distancia_m) > 0) salida.distancia_m = Math.round(numeroEn(p.distancia_m, 50, 300000, 1000));
	else salida.hasta_boton = true;
	const o = p.objetivo;
	if (o && o.tipo && o.tipo !== "ninguno") {
		if (!OBJETIVOS[o.tipo]) throw new HttpError(400, `${ruta}: objetivo no valido (${o.tipo}). Use fc, potencia, ritmo, velocidad o cadencia.`);
		const obj = { tipo: o.tipo };
		if (o.zona != null && (o.tipo === "fc" || o.tipo === "potencia")) {
			obj.zona = Math.round(numeroEn(o.zona, 1, o.tipo === "fc" ? 5 : 7, 2));
		} else if (o.tipo === "ritmo") {
			const a = segPorKm(o.min), b = segPorKm(o.max);
			if (!a || !b) throw new HttpError(400, `${ruta}: el ritmo va en min/km, p. ej. { min: "4:40", max: "4:20" }.`);
			obj.min = mmss(Math.max(a, b)); obj.max = mmss(Math.min(a, b)); // min = el mas lento
		} else {
			const a = Number(o.min), b = Number(o.max);
			if (!Number.isFinite(a) || !Number.isFinite(b)) throw new HttpError(400, `${ruta}: el objetivo ${o.tipo} necesita min y max (o zona).`);
			obj.min = Math.min(a, b); obj.max = Math.max(a, b);
		}
		salida.objetivo = obj;
	}
	if (typeof p.nota === "string" && p.nota.trim()) salida.nota = p.nota.trim().slice(0, 120);
	return salida;
}

const textoObjetivo = (o) => {
	if (!o) return "";
	const u = { fc: "ppm", potencia: "W", velocidad: "km/h", cadencia: "rpm", ritmo: "/km" }[o.tipo];
	if (o.zona) return o.tipo === "fc" ? `zona ${o.zona} de pulso` : `zona ${o.zona} de potencia`;
	return o.tipo === "ritmo" ? `${o.min}-${o.max} /km` : `${o.min}-${o.max} ${u}`;
};
const textoDuracion = (p) => (p.duracion_s ? (p.duracion_s % 60 ? `${Math.floor(p.duracion_s / 60)}:${String(p.duracion_s % 60).padStart(2, "0")} min` : `${p.duracion_s / 60} min`)
	: p.distancia_m ? (p.distancia_m >= 1000 ? `${String(p.distancia_m / 1000).replace(".", ",")} km` : `${p.distancia_m} m`) : "hasta pulsar vuelta");

/** El entreno en frases, para enseñarlo antes de mandarlo. */
function resumenCardio(pasos, sangria = "") {
	return pasos.flatMap((p) => p.repetir
		? [`${sangria}${p.repetir} ×`, ...resumenCardio(p.pasos, `${sangria}   `)]
		: [`${sangria}${NOMBRE_PASO[p.tipo]}: ${textoDuracion(p)}${p.objetivo ? ` · ${textoObjetivo(p.objetivo)}` : ""}${p.nota ? ` · ${p.nota}` : ""}`]);
}

/** Duracion aproximada en minutos (los pasos por distancia o boton no suman). */
const minutosCardio = (pasos) => pasos.reduce((t, p) => t + (p.repetir ? p.repetir * minutosCardio(p.pasos) : (p.duracion_s || 0) / 60), 0);

function pasoGarmin(p, orden, grupo) {
	const fin = p.duracion_s
		? { endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true }, endConditionValue: p.duracion_s }
		: p.distancia_m
			? { endCondition: { conditionTypeId: 3, conditionTypeKey: "distance", displayOrder: 3, displayable: true }, endConditionValue: p.distancia_m }
			: { endCondition: { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 1, displayable: true } };
	const o = p.objetivo;
	let objetivo = { targetType: OBJETIVOS.ninguno };
	if (o) {
		objetivo = { targetType: OBJETIVOS[o.tipo] };
		if (o.zona) objetivo.zoneNumber = o.zona;
		else if (o.tipo === "ritmo") {
			// Garmin guarda el ritmo como velocidad en m/s: el valor bajo es el ritmo lento.
			objetivo.targetValueOne = Math.round((1000 / segPorKm(o.min)) * 1000) / 1000;
			objetivo.targetValueTwo = Math.round((1000 / segPorKm(o.max)) * 1000) / 1000;
		} else if (o.tipo === "velocidad") {
			objetivo.targetValueOne = Math.round((o.min / 3.6) * 1000) / 1000;
			objetivo.targetValueTwo = Math.round((o.max / 3.6) * 1000) / 1000;
		} else { objetivo.targetValueOne = o.min; objetivo.targetValueTwo = o.max; }
	}
	return {
		type: "ExecutableStepDTO", stepOrder: orden, ...(grupo ? { childStepId: grupo } : {}),
		stepType: TIPOS_PASO[p.tipo], ...fin, ...objetivo,
		...(p.nota ? { description: p.nota } : {}),
	};
}

function cardioParaGarmin(entreno) {
	let orden = 0, grupos = 0;
	const convertir = (pasos, grupo) => pasos.map((p) => {
		if (!p.repetir) return pasoGarmin(p, ++orden, grupo);
		const id = ++grupos, suOrden = ++orden;
		return {
			type: "RepeatGroupDTO", stepOrder: suOrden, childStepId: id, numberOfIterations: p.repetir, smartRepeat: false,
			stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
			endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
			endConditionValue: p.repetir,
			workoutSteps: convertir(p.pasos, id),
		};
	});
	const deporte = DEPORTES_CARDIO[entreno.deporte];
	return {
		workoutName: `myCoach · ${entreno.nombre}`.slice(0, 80),
		description: (entreno.nota || "Creado por myCoach").slice(0, 512),
		sportType: deporte,
		workoutSegments: [{ segmentOrder: 1, sportType: deporte, workoutSteps: convertir(entreno.pasos, null) }],
	};
}

/** El dia de bici o correr del plan apunta a su entreno para el reloj. */
async function enlazarCardioEnPlan(env, userId, fecha, entreno) {
	const estado = await leerDoc(env, userId, "estado/app");
	const clave = estado?.plan?.[fecha] ? "plan" : estado?.next?.[fecha] ? "next" : null;
	const dia = clave && estado[clave][fecha];
	if (!dia || dia.dep !== entreno.deporte) return false;
	estado[clave][fecha] = { ...dia, entreno_cardio: entreno.id };
	await guardarDoc(env, userId, "estado/app", estado);
	return true;
}

const esquemaPasoCardio = {
	type: "object",
	description: "Un paso, o un bloque { repetir: n, pasos: [...] } para las series.",
	properties: {
		tipo: { type: "string", enum: Object.keys(TIPOS_PASO) },
		duracion_s: { type: "integer", description: "Duracion en segundos." },
		distancia_m: { type: "integer", description: "O distancia en metros. Sin duracion ni distancia: hasta pulsar vuelta." },
		objetivo: {
			type: "object",
			description: "fc (zona 1-5 del reloj, o min/max en ppm), potencia (zona o min/max en W), ritmo (min/max en min/km, '4:30'), velocidad (min/max en km/h), cadencia (min/max en rpm o pasos/min).",
			properties: { tipo: { type: "string", enum: ["ninguno", "fc", "potencia", "ritmo", "velocidad", "cadencia"] }, zona: { type: "integer" }, min: {}, max: {} },
		},
		nota: { type: "string" },
		repetir: { type: "integer" },
		pasos: { type: "array", items: { type: "object" } },
	},
};

Object.assign(TOOLS, {
	cardio_enviar_garmin: {
		title: "Crear un entreno de bici o correr para el reloj",
		write: true,
		description:
			"Crea un entreno guiado de bici o correr por pasos: calentamiento, series (bloques con repetir), recuperacion, vuelta a la calma; " +
			"cada paso por tiempo, distancia o hasta pulsar vuelta, con objetivo de pulso (zona del reloj o rango), potencia, ritmo, velocidad o cadencia. " +
			"Sin confirm (o confirm=false) devuelve la vista previa y NO escribe nada: enseñela al usuario. Con confirm=true, tras su si, lo crea en Garmin Connect, " +
			"lo programa para la fecha y lo guarda con su nombre para repetirlo (cardio_entrenos). Si ese dia del plan es de ese deporte, queda enlazado. " +
			"Use las zonas y umbrales del usuario (coach_perfil, garmin_training_readiness) para los rangos; si no los sabe, mejor zona de pulso del reloj.",
		schema: {
			type: "object",
			properties: {
				nombre: { type: "string", description: "P. ej. '5 × 4 min a umbral'." },
				deporte: { type: "string", enum: ["bici", "correr"] },
				fecha: { type: "string", description: "AAAA-MM-DD en que lo hara; por defecto hoy." },
				pasos: { type: "array", items: esquemaPasoCardio },
				nota: { type: "string", description: "Para que sirve, en una frase." },
				id: { type: "string", description: "Para volver a mandar uno guardado (sin pasos)." },
				confirm: { type: "boolean" },
			},
		},
		run: async (env, userId, args) => {
			const fecha = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || "") ? args.fecha : fechaLocal();
			const doc = (await leerDoc(env, userId, CARDIO_ENTRENOS)) || { entrenos: {} };
			doc.entrenos = doc.entrenos || {};
			let entreno;
			if (args.id && !args.pasos) {
				entreno = doc.entrenos[slugFuerza(args.id)];
				if (!entreno) throw new HttpError(404, `No hay ningun entreno de bici o correr "${args.id}".`);
			} else {
				if (!DEPORTES_CARDIO[args.deporte]) throw new HttpError(400, "deporte tiene que ser bici o correr.");
				if (!Array.isArray(args.pasos) || !args.pasos.length) throw new HttpError(400, "El entreno necesita pasos.");
				const nombre = String(args.nombre || "").trim().slice(0, 60);
				if (!nombre) throw new HttpError(400, "El entreno necesita un nombre.");
				entreno = {
					id: slugFuerza(args.id || nombre), nombre, deporte: args.deporte,
					pasos: args.pasos.slice(0, 30).map((p, i) => normalizarPasoCardio(p, `Paso ${i + 1}`)),
					...(typeof args.nota === "string" && args.nota.trim() ? { nota: args.nota.trim().slice(0, 200) } : {}),
				};
			}
			const vista = { nombre: entreno.nombre, deporte: entreno.deporte, fecha, min_estimados: Math.round(minutosCardio(entreno.pasos)), pasos: resumenCardio(entreno.pasos) };
			if (args.confirm !== true)
				return { vista_previa: vista, escrito: false, siguiente: "Enseñeselo al usuario y, si dice que si, llame otra vez con confirm=true." };

			const creado = await apiPost(env, userId, "/workout-service/workout", cardioParaGarmin(entreno));
			const workoutId = creado?.workoutId;
			if (!workoutId) throw new HttpError(502, "Garmin no devolvio el id del entreno.");
			let programado = true;
			try { await apiPost(env, userId, `/workout-service/schedule/${workoutId}`, { date: fecha }); } catch { programado = false; }
			const previo = doc.entrenos[entreno.id];
			if (previo?.garmin?.workout_id && String(previo.garmin.workout_id) !== String(workoutId)) await borrarEntrenoGarmin(env, userId, previo.garmin.workout_id);
			doc.entrenos[entreno.id] = { ...entreno, creado: previo?.creado || fechaLocal(), garmin: { workout_id: String(workoutId), fecha, enviado: fechaLocal() } };
			await guardarDoc(env, userId, CARDIO_ENTRENOS, doc);
			const enlazado = await enlazarCardioEnPlan(env, userId, fecha, entreno);
			return {
				enviado: true, ...vista, workout_id: String(workoutId), programado, enlazado_al_plan: enlazado,
				mensaje: programado
					? `"${entreno.nombre}" esta en tu calendario de Garmin para el ${fecha}. Sincroniza el reloj y lo tendras en Entrenamientos.`
					: `"${entreno.nombre}" esta en tus entrenos de Garmin, pero no he podido ponerlo en el calendario: buscalo en Entrenamientos del reloj.`,
			};
		},
	},

	cardio_entrenos: {
		title: "Entrenos de bici y correr guardados",
		description: "Sin id: la lista de entrenos de bici y correr ya creados para el reloj. Con id: sus pasos. Para repetir uno, cardio_enviar_garmin con id y la fecha.",
		schema: { type: "object", properties: { id: { type: "string" } } },
		run: async (env, userId, { id }) => {
			const entrenos = (await leerDoc(env, userId, CARDIO_ENTRENOS))?.entrenos || {};
			if (id) {
				const e = entrenos[slugFuerza(id)];
				if (!e) throw new HttpError(404, `No hay ningun entreno de bici o correr "${id}".`);
				return { ...e, min_estimados: Math.round(minutosCardio(e.pasos)), resumen: resumenCardio(e.pasos) };
			}
			return { entrenos: Object.values(entrenos).map((e) => ({ id: e.id, nombre: e.nombre, deporte: e.deporte, min_estimados: Math.round(minutosCardio(e.pasos)), ultimo_envio: e.garmin?.fecha || null })) };
		},
	},
});

// ──────────────────────────────── Router ────────────────────────────────

/**
 * Registro de diagnostico en D1.
 *
 * Existe porque los logs del dashboard no son consultables desde fuera y
 * hacia falta ver que pasaba en la conexion de otra persona. Solo guarda
 * ruta, metodo, estado y un motivo corto: nunca tokens, credenciales ni
 * datos de Garmin. Si no hay binding D1, no hace nada.
 */
async function record(env, request, status, note) {
	if (!env.LOGS) return;
	try {
		await env.LOGS.prepare(
			"INSERT INTO events (at, path, method, status, note, ua) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(
				new Date().toISOString(),
				new URL(request.url).pathname,
				request.method,
				status,
				String(note ?? "").slice(0, 300),
				(request.headers.get("User-Agent") || "").slice(0, 120),
			)
			.run();
	} catch {
		// Un fallo registrando jamas debe tumbar la peticion real.
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const { pathname } = url;

		if (!env.GARMIN) return json({ error: "Falta el binding KV 'GARMIN'." }, 500);
		if (!env.SIGNING_KEY) return json({ error: "Falta el secreto 'SIGNING_KEY'." }, 500);

		// Las herramientas necesitan saber bajo que dominio se sirve para
		// componer el enlace de descarga del GPX.
		env = { ...env, PUBLIC_ORIGIN: url.origin };

		if (request.method === "OPTIONS")
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
				},
			});

		// Un fallo de herramienta viaja como 200 con isError, asi que no lo
		// pilla el registro por codigo de estado. Y es justo el que interesa.
		let toolError = "";
		// Que ha pedido Claude (metodo y herramienta o recurso), para el registro.
		let llamada = "";

		const response = await (async () => {
		try {
			if (pathname === "/.well-known/oauth-authorization-server") return json(metadata(url.origin));

			if (pathname === "/.well-known/oauth-protected-resource")
				return json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] });

			if (pathname === "/oauth/register" && request.method === "POST") return handleRegister(request, env);

			if (pathname === "/oauth/authorize") return handleAuthorize(request, env);

			if (pathname === "/oauth/token" && request.method === "POST") return handleToken(request, env);

			if (pathname === "/cuenta" || pathname.startsWith("/cuenta/")) return handleCuenta(request, env, pathname);

			// Descarga del GPX. El id es un token aleatorio, asi que hace de
			// credencial: permite importar la ruta a mano sin exponer nada mas.
			if (pathname.startsWith("/route/") && pathname.endsWith(".gpx")) {
				const id = pathname.slice("/route/".length, -".gpx".length);
				const route = await env.GARMIN.get(routeKey(id), "json");
				if (!route) return json({ error: "not_found" }, 404);

				return new Response(gpxFrom(route.name, route.coords), {
					headers: {
						"Content-Type": "application/gpx+xml; charset=utf-8",
						"Content-Disposition": `attachment; filename="${id}.gpx"`,
					},
				});
			}

			if (pathname === "/panel" || pathname.startsWith("/panel/")) return handlePanel(request, env, ctx);

			if (pathname === "/mcp") {
				const userId = await userForRequest(request, env);
				if (!userId)
					// El WWW-Authenticate es lo que le dice a Claude donde autenticarse.
					return new Response(JSON.stringify({ error: "unauthorized" }), {
						status: 401,
						headers: {
							"Content-Type": "application/json",
							"WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
						},
					});

				if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

				const message = await request.json();
				if (message.id === undefined) return new Response(null, { status: 202 });

				const rpc = await handleRpc(message, env, userId);
				llamada = [message.method, message.params?.name || message.params?.uri].filter(Boolean).join(" ");
				if (rpc.result?.isError)
					toolError = `${message.params?.name}: ${rpc.result.content?.[0]?.text ?? ""}`;
				return json(rpc);
			}

			if (pathname === "/")
				return new Response(
					page(
						"Garmin para Claude",
						`<h1>Garmin para Claude</h1>
<p>Este servidor expone tus datos de Garmin a Claude por MCP. Para usarlo, anade
esta URL como conector personalizado en Claude:</p>
<p><code>${escapeHtml(url.origin)}/mcp</code></p>
<p>Claude te traera aqui para iniciar sesion con tu cuenta de Garmin.</p>`,
					),
					{ headers: HTML },
				);

			return json({ error: "not_found" }, 404);
		} catch (err) {
			if (err instanceof HttpError) return json({ error: err.message }, err.status);
			return json({ error: String(err) }, 500);
		}
		})();

		// El motivo se saca del propio cuerpo de error, que es donde ya esta
		// escrito; clonar evita consumir la respuesta que se devuelve.
		let note = toolError;
		if (!note && response.status >= 400) note = await response.clone().text().catch(() => "");
		else if (!note && response.status === 302) note = "redirect";
		else if (!note && llamada) note = llamada;

		if (env.LOGS) ctx?.waitUntil?.(record(env, request, response.status, note));
		return response;
	},

	// Descarga diaria. Es lo que hace que el panel tenga historico sin que
	// nadie tenga que abrirlo.
	async scheduled(event, env, ctx) {
		ctx.waitUntil(sincronizarTodos(env).catch(() => {}));
	},
};
