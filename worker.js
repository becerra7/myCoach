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

	throw new HttpError(502, "Garmin devolvio una respuesta inesperada al iniciar sesion.");
}

/**
 * Intenta el flujo movil y, si Garmin lo tiene limitado, cae al del portal.
 * Solo el 429 justifica reintentar: una contrasena incorrecta lo seria en
 * ambos, y repetirla solo acerca el bloqueo.
 */
async function ssoLogin(email, password) {
	try {
		return await loginVia("ios", email, password);
	} catch (err) {
		if (!(err instanceof HttpError) || err.status !== 429) throw err;

		try {
			return await loginVia("portal", email, password);
		} catch (fallbackErr) {
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

/** GET contra connectapi con el Bearer del usuario, renovando si hace falta. */
async function apiGet(env, userId, path, params) {
	let user = await env.GARMIN.get(userKey(userId), "json");
	// Si el usuario acaba de conectar, su registro puede tardar hasta un
	// minuto en propagarse por el KV: conviene decirlo en vez de dar a
	// entender que la conexion ha fallado.
	if (!user?.di_token)
		throw new HttpError(
			401,
			"No hay sesion de Garmin para este usuario. Si acabas de conectar el conector, espera un minuto y reintenta.",
		);

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
	if (!user?.di_token)
		throw new HttpError(
			401,
			"No hay sesion de Garmin para este usuario. Si acabas de conectar el conector, espera un minuto y reintenta.",
		);

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
		const detail = (await res.text().catch(() => "")).slice(0, 400);
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

const TOOLS = {
	garmin_status: {
		title: "Estado de la conexion con Garmin",
		description:
			"Comprueba si hay una sesion valida de Garmin para quien pregunta y cuando se obtuvo. Uselo si cualquier otra herramienta falla con un error de autenticacion.",
		schema: { type: "object", properties: {} },
		run: async (env, userId) => {
			const user = await env.GARMIN.get(userKey(userId), "json");
			if (!user) return { connected: false, reason: "Este usuario todavia no ha conectado su cuenta de Garmin." };

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
			properties: { limit: { type: "integer", description: "Cuantas actividades devolver (1-50). Por defecto 10." } },
		},
		run: async (env, userId, { limit }) => {
			const n = Math.min(Math.max(limit || 10, 1), 50);
			const list = await apiGet(env, userId, "/activitylist-service/activities/search/activities", {
				start: "0",
				limit: String(n),
			});
			return (list || []).map((a) => ({
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
			}));
		},
	},

	garmin_activity_detail: {
		title: "Detalle de una actividad",
		description:
			"Metricas completas de UNA actividad concreta, identificada por su activity_id (obtenido con garmin_activities). Incluye ritmo, elevacion, zonas de frecuencia cardiaca y potencia cuando existan.",
		schema: {
			type: "object",
			properties: { activity_id: { type: "string", description: "El activity_id devuelto por garmin_activities." } },
			required: ["activity_id"],
		},
		run: async (env, userId, { activity_id }) => {
			const a = await apiGet(env, userId, `/activity-service/activity/${encodeURIComponent(activity_id)}`);
			const s = a?.summaryDTO || {};
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

	garmin_plan_route: {
		title: "Trazar y medir una ruta de bici",
		description:
			"Traza una ruta de bici entre los puntos de paso indicados siguiendo carreteras reales, y devuelve sus metricas: distancia, desnivel acumulado, numero de semaforos y tipos de carretera. NO devuelve el trazado: guarda el GPX y devuelve un route_id y un enlace de descarga. Uselo de forma iterativa — proponga puntos, lea las metricas, ajuste los puntos y vuelva a llamar hasta que la distancia y el desnivel cuadren con lo pedido. Para una ruta circular, repita el punto de salida al final.",
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
				gpx_url: `${env.PUBLIC_ORIGIN || ""}/route/${id}.gpx`,
				next_step:
					"Si la distancia o el desnivel no cuadran, ajuste los puntos de paso y vuelva a llamar. " +
					"Cuando convenga, use garmin_save_course para subirla a Garmin.",
			};
		},
	},

	garmin_save_course: {
		title: "Guardar una ruta en Garmin Connect",
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
			const step = Math.ceil(route.coords.length / 1000);
			const points = route.coords.filter((_, i) => i % step === 0 || i === route.coords.length - 1);

			const body = {
				courseName: route.name,
				description: `Trazada con perfil ${route.profile}.`,
				distance: route.distance_km * 1000,
				elevationGain: route.elevation_gain_m,
				activityTypePk: 2, // ciclismo
				coordinateSystem: "WGS84",
				geoPoints: points.map(([lon, lat, ele]) => ({
					longitude: lon,
					latitude: lat,
					...(ele != null ? { elevation: ele } : {}),
				})),
			};

			const res = await apiPost(env, userId, "/course-service/course", body);

			return {
				saved: true,
				course_id: res?.courseId ?? null,
				name: route.name,
				hint: "Abre Garmin Connect y usa 'Enviar al dispositivo' para tenerla en el ciclocomputador.",
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
			const data = await apiGet(env, userId, `/metrics-service/metrics/trainingreadiness/${d}`);
			const r = Array.isArray(data) ? data[0] : data;
			return {
				date: d,
				score: r?.score ?? null,
				level: r?.level ?? null,
				sleep_score: r?.sleepScore ?? null,
				hrv_factor: r?.hrvFactorPercent ?? null,
				recovery_time_hours: r?.recoveryTime ? round(r.recoveryTime / 60, 1) : null,
				acute_load: r?.acuteLoad ?? null,
			};
		},
	},
};

// ──────────────────────────── MCP (JSON-RPC) ────────────────────────────

const SERVER_INFO = { name: "garmin", title: "Garmin Connect", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(message, env, userId) {
	const { id, method, params } = message;

	if (method === "initialize") {
		const asked = params?.protocolVersion;
		return rpcResult(id, {
			protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : DEFAULT_PROTOCOL,
			capabilities: { tools: { listChanged: false } },
			serverInfo: SERVER_INFO,
			instructions:
				"Datos de Garmin Connect del usuario que ha autorizado este conector. Las fechas van en " +
				"YYYY-MM-DD y por defecto es hoy. Para preguntas sobre descanso use garmin_sleep y garmin_hrv; " +
				"para carga y rendimiento, garmin_activities y garmin_training_readiness. Si una herramienta " +
				"falla con error de autenticacion, llame a garmin_status para diagnosticar.\n\n" +
				"Para planificar rutas de bici: proponga usted los puntos de paso a partir de su conocimiento " +
				"geografico y llame a garmin_plan_route, que los une por carreteras reales y devuelve las " +
				"metricas. No invente el trazado ni suponga la distancia: la que cuenta es la que mide la " +
				"herramienta. Si no cuadra con lo pedido, mueva los puntos y repita. Para saber de donde sale " +
				"el usuario habitualmente, mire garmin_activities. Guardar la ruta en Garmin (garmin_save_course) " +
				"escribe en su cuenta: pida permiso antes.",
		});
	}

	if (method === "tools/list")
		return rpcResult(id, {
			tools: Object.entries(TOOLS).map(([name, t]) => ({
				name,
				title: t.title,
				description: t.description,
				inputSchema: t.schema,
				annotations: { readOnlyHint: true },
			})),
		});

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

async function handleAuthorize(request, env) {
	if (request.method === "GET") {
		const params = readAuthorizeParams(new URL(request.url).searchParams);
		if (!params) return new Response(errorPage("Faltan parametros de OAuth o PKCE."), { status: 400, headers: HTML });
		if (!(await clientAllows(env, params.clientId, params.redirectUri)))
			return new Response(errorPage("Cliente o redirect_uri no reconocido."), { status: 400, headers: HTML });
		return new Response(loginPage(params), { headers: HTML });
	}

	const form = new URLSearchParams(await request.text());
	const params = readAuthorizeParams(form);
	if (!params) return new Response(errorPage("Faltan parametros de OAuth o PKCE."), { status: 400, headers: HTML });
	if (!(await clientAllows(env, params.clientId, params.redirectUri)))
		return new Response(errorPage("Cliente o redirect_uri no reconocido."), { status: 400, headers: HTML });

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
		if (!email || !password)
			return new Response(loginPage(params, "Rellena email y contrasena."), { status: 400, headers: HTML });

		const userId = await userIdFor(email);
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
			return new Response(mfaPage(params, id, result.mfaMethod), { headers: HTML });
		}

		const tokens = await exchangeTicket(result.ticket, result.flowName);
		await env.GARMIN.put(userKey(userId), JSON.stringify(tokens));
		return issueCodeAndRedirect(env, params, userId);
	} catch (err) {
		const message = err instanceof HttpError ? err.message : "No se pudo completar la conexion.";
		const status = err instanceof HttpError ? err.status : 500;
		return new Response(loginPage(params, message), { status, headers: HTML });
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

const loginPage = (params, error) =>
	page(
		"Conectar Garmin",
		`<h1>Conectar Garmin</h1>
<p>Inicia sesion con tu cuenta de Garmin para que Claude pueda leer tus datos.
Solo se guarda el token resultante: ni tu contrasena ni tu email se almacenan.</p>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/oauth/authorize">
  ${hiddenFields(params)}
  <label for="email">Email de Garmin</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Contrasena</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Autorizar</button>
</form>
<p class="note">Puedes revocar el acceso borrando el conector en Claude o
cambiando tu contrasena de Garmin.</p>`,
	);

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

		const response = await (async () => {
		try {
			if (pathname === "/.well-known/oauth-authorization-server") return json(metadata(url.origin));

			if (pathname === "/.well-known/oauth-protected-resource")
				return json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] });

			if (pathname === "/oauth/register" && request.method === "POST") return handleRegister(request, env);

			if (pathname === "/oauth/authorize") return handleAuthorize(request, env);

			if (pathname === "/oauth/token" && request.method === "POST") return handleToken(request, env);

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
				return json(await handleRpc(message, env, userId));
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
		let note = "";
		if (response.status >= 400) note = await response.clone().text().catch(() => "");
		else if (response.status === 302) note = "redirect";

		if (env.LOGS) ctx?.waitUntil?.(record(env, request, response.status, note));
		return response;
	},
};
