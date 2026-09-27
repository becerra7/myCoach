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
			"Guarda un documento de la app myCoach para este usuario. Con 'fusionar' mezcla los campos de primer nivel con lo que ya hay (p. ej. solo 'plan' o solo 'meals' en estado/app); con 'anadir' agrega 'datos' al final de una lista (p. ej. notas). Escribe en la app del usuario: confirme con el antes los cambios de plan o de comidas.",
		schema: {
			type: "object",
			properties: {
				doc: { type: "string" },
				datos: { description: "Contenido JSON del documento" },
				fusionar: { type: "boolean" },
				anadir: { type: "boolean" },
			},
			required: ["doc", "datos"],
		},
		run: async (env, userId, { doc, datos, fusionar, anadir }) => {
			if (!APP_DOC.test(doc || "")) throw new HttpError(400, "Documento no valido");
			const key = appKey(userId, doc);
			let value = datos;
			if (anadir) value = [...((await env.GARMIN.get(key, "json")) || []), datos].slice(-500);
			else if (fusionar && datos && typeof datos === "object") value = { ...((await env.GARMIN.get(key, "json")) || {}), ...datos };
			// Sello de tiempo: la app sabe asi que hay cambios hechos desde Claude.
			if (value && typeof value === "object" && !Array.isArray(value)) value = { ...value, at: Date.now() };
			const text = JSON.stringify(value);
			if (text.length > 5_000_000) throw new HttpError(413, "Documento demasiado grande");
			await env.GARMIN.put(key, text);
			return { ok: true, doc, bytes: text.length };
		},
	},
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
			"Metricas completas de UNA actividad concreta, identificada por su activity_id (obtenido con garmin_activities). Incluye ritmo, elevacion, zonas de frecuencia cardiaca y potencia cuando existan.",
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
				"Los recorridos ya guardados se leen con garmin_courses y garmin_course_detail: mirelos antes " +
				"de proponer una ruta nueva, para no repetir una que el usuario ya tiene. " +
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
				annotations: { readOnlyHint: t.write !== true, destructiveHint: false },
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
Ni tu contrasena ni tu email se almacenan.</p>
<p>Para poder dibujar tu progreso, este servidor guarda tus actividades y tus
datos diarios de Garmin, y los actualiza una vez al dia.</p>
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

		if (env.LOGS) ctx?.waitUntil?.(record(env, request, response.status, note));
		return response;
	},

	// Descarga diaria. Es lo que hace que el panel tenga historico sin que
	// nadie tenga que abrirlo.
	async scheduled(event, env, ctx) {
		ctx.waitUntil(sincronizarTodos(env).catch(() => {}));
	},
};
