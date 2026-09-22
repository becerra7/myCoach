import worker from "./worker.js";

const ORIGIN = "https://garmin.example.workers.dev";

// La espera anti-WAF del flujo portal es de ~10s reales: aqui no aporta nada
// y haria los tests eternos, asi que los temporizadores disparan al momento.
globalThis.setTimeout = (fn) => { fn(); return 0; };

/**
 * `isolated: true` imita el KV real cuando la escritura todavia no ha
 * propagado: se escribe, pero las lecturas no lo ven. Es el escenario que
 * rompia la conexion de otra persona desde otro pais.
 */
function makeEnv(seed = {}, { isolated = false } = {}) {
	const store = new Map(Object.entries(seed));
	const visible = isolated ? new Map(Object.entries(seed)) : store;
	return {
		SIGNING_KEY: "clave-de-firma-para-los-tests",
		GARMIN: {
			async get(k, type) {
				const v = visible.get(k);
				if (v === undefined) return null;
				return type === "json" ? JSON.parse(v) : v;
			},
			async put(k, v) { store.set(k, v); },
			async delete(k) { store.delete(k); visible.delete(k); },
		},
		_store: store,
	};
}

const get = (env, path, headers = {}) =>
	worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), env);

const postForm = (env, path, fields, headers = {}) =>
	worker.fetch(new Request(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
		body: new URLSearchParams(fields).toString(),
	}), env);

const postJson = (env, path, body, headers = {}) =>
	worker.fetch(new Request(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	}), env);

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
	if (cond) { pass++; console.log(`  ok   ${name}`); }
	else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

// PKCE
const b64url = (bytes) =>
	Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const VERIFIER = "verificador-de-prueba-suficientemente-largo-123456";
const CHALLENGE = b64url(
	new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER))));
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

/**
 * Simula Garmin. `accounts` mapea email -> {password, mfa, data}.
 * Los tokens simulados se construyen sobre el displayName, nunca sobre el
 * email: si no, el email acabaria en el KV por culpa del mock y la prueba de
 * "el email no se almacena" seria falsa.
 */
function mockGarmin(accounts, { mobileLimited = false, portalLimited = false } = {}) {
	const tickets = new Map();
	const handleOf = (email) => accounts[email].data.displayName;
	const byHandle = (handle) =>
		Object.values(accounts).find((a) => a.data.displayName === handle);
	const calls = (mockGarmin.calls = []);
	const rateLimited = () =>
		new Response(JSON.stringify({ error: { "status-code": "429", "request-id": "abc" } }), { status: 429 });

	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		calls.push({ path: u.pathname, service: new URLSearchParams(init?.body || "").get("service_url") });

		if (u.pathname === "/portal/sso/en-US/sign-in")
			return new Response("<html>login</html>", {
				status: portalLimited ? 429 : 200,
				headers: { "Set-Cookie": "PORTAL=1; Path=/" },
			});

		if (u.pathname === "/portal/api/login") {
			if (portalLimited) return rateLimited();
			const { username, password } = JSON.parse(init.body);
			const acc = accounts[username];
			if (!acc || acc.password !== password)
				return new Response(JSON.stringify({ responseStatus: { type: "INVALID_USERNAME_PASSWORD" } }));
			const t = `ST-${handleOf(username)}`;
			tickets.set(t, handleOf(username));
			return new Response(JSON.stringify({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: t }));
		}

		if (u.pathname === "/mobile/api/login") {
			if (mobileLimited) return rateLimited();
			const { username, password } = JSON.parse(init.body);
			const acc = accounts[username];
			if (!acc || acc.password !== password)
				return new Response(JSON.stringify({ responseStatus: { type: "INVALID_USERNAME_PASSWORD" } }));
			if (acc.mfa)
				return new Response(
					JSON.stringify({ responseStatus: { type: "MFA_REQUIRED" }, customerMfaInfo: { mfaLastMethodUsed: "email" } }),
					{ headers: { "Set-Cookie": `SESSION=${handleOf(username)}; Path=/` } });
			const t = `ST-${handleOf(username)}`;
			tickets.set(t, handleOf(username));
			return new Response(JSON.stringify({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: t }));
		}

		if (u.pathname === "/mobile/api/mfa/verifyCode") {
			const who = (init.headers.Cookie || "").replace("SESSION=", "");
			if (JSON.parse(init.body).mfaVerificationCode !== "123456")
				return new Response(JSON.stringify({}), { status: 200 });
			const t = `ST-${who}`;
			tickets.set(t, who);
			return new Response(JSON.stringify({ serviceTicketId: t }));
		}

		if (u.hostname === "diauth.garmin.com") {
			const body = new URLSearchParams(init.body);
			const who = tickets.get(body.get("service_ticket")) ?? "desconocido";
			return new Response(JSON.stringify({ access_token: `TOK-${who}`, refresh_token: `REF-${who}` }));
		}

		// connectapi: devuelve datos segun el Bearer, para probar aislamiento.
		const acc = byHandle((init.headers.Authorization || "").replace("Bearer TOK-", ""));
		if (!acc) return new Response("unauthorized", { status: 401 });
		if (u.pathname === "/userprofile-service/socialProfile")
			return new Response(JSON.stringify({ displayName: acc.data.displayName }));
		if (u.pathname.startsWith("/hrv-service/hrv/"))
			return new Response(JSON.stringify({ hrvSummary: { lastNightAvg: acc.data.hrv, status: "BALANCED" } }));
		return new Response(JSON.stringify({}), { status: 404 });
	};
}

/** Recorre el flujo OAuth completo y devuelve el access token. */
async function connect(env, email, password, mfaCode) {
	const reg = await (await postJson(env, "/oauth/register", {
		redirect_uris: [REDIRECT], client_name: "Claude",
	})).json();

	const params = {
		client_id: reg.client_id, redirect_uri: REDIRECT, state: "xyz",
		code_challenge: CHALLENGE, code_challenge_method: "S256",
	};

	let res = await postForm(env, "/oauth/authorize", { ...params, email, password });

	if (res.status === 200 && mfaCode) {
		const html = await res.text();
		const pendingId = html.match(/name="mfa_pending" value="([^"]+)"/)?.[1];
		res = await postForm(env, "/oauth/authorize", { ...params, mfa_pending: pendingId, code: mfaCode });
	}

	if (res.status !== 302) throw new Error(`esperaba redirect, llego ${res.status}`);
	const code = new URL(res.headers.get("Location")).searchParams.get("code");

	const tokens = await (await postForm(env, "/oauth/token", {
		grant_type: "authorization_code", code, client_id: reg.client_id,
		redirect_uri: REDIRECT, code_verifier: VERIFIER,
	})).json();

	return { tokens, clientId: reg.client_id, params };
}

const rpc = async (env, token, message) => {
	const r = await postJson(env, "/mcp", message, { Authorization: `Bearer ${token}` });
	return { status: r.status, body: await r.json().catch(() => null) };
};

// ── 1. Descubrimiento ──
{
	const env = makeEnv();
	const meta = await (await get(env, "/.well-known/oauth-authorization-server")).json();
	check("metadata: endpoints correctos",
		meta.authorization_endpoint === `${ORIGIN}/oauth/authorize` && meta.token_endpoint === `${ORIGIN}/oauth/token`);
	check("metadata: PKCE S256 obligatorio",
		meta.code_challenge_methods_supported.length === 1 && meta.code_challenge_methods_supported[0] === "S256");

	const prm = await (await get(env, "/.well-known/oauth-protected-resource")).json();
	check("protected-resource apunta a /mcp", prm.resource === `${ORIGIN}/mcp`);
}

// ── 2. Registro dinamico ──
{
	const env = makeEnv();
	const ok = await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] });
	check("registro devuelve 201", ok.status === 201);
	const body = await ok.json();
	check("registro devuelve client_id", body.client_id?.startsWith("client_"));

	const noUris = await postJson(env, "/oauth/register", {});
	check("registro sin redirect_uris -> 400", noUris.status === 400);

	const insecure = await postJson(env, "/oauth/register", { redirect_uris: ["http://evil.com/cb"] });
	check("redirect http externo rechazado", insecure.status === 400);

	const loopback = await postJson(env, "/oauth/register", { redirect_uris: ["http://127.0.0.1:6274/cb"] });
	check("loopback permitido (inspector MCP)", loopback.status === 201);
}

// ── 3. Authorize: validaciones ──
{
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();

	const noPkce = await get(env, `/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}`);
	check("authorize sin PKCE -> 400", noPkce.status === 400);

	const plain = await get(env, `/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=x&code_challenge_method=plain`);
	check("PKCE 'plain' rechazado", plain.status === 400);

	const unknownClient = await get(env, `/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${CHALLENGE}`);
	check("cliente desconocido -> 400", unknownClient.status === 400);

	const otherRedirect = await get(env, `/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://evil.com/cb")}&code_challenge=${CHALLENGE}`);
	check("redirect_uri no registrado -> 400", otherRedirect.status === 400);

	const good = await get(env, `/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${CHALLENGE}`);
	check("authorize valido muestra el login", good.status === 200 && (await good.text()).includes("Conectar Garmin"));
}

// ── 4. Login fallido ──
{
	mockGarmin({ "ana@x.com": { password: "buena", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();
	const res = await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "mala",
	});
	check("contrasena incorrecta -> 401 con el formulario", res.status === 401);
	check("el error se muestra al usuario", (await res.text()).includes("incorrectos"));
}

// ── 4b. Bloqueo total: el diagnostico sobrevive al fallback ──
{
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();

	// Todo bloqueado, como lo devolveria el WAF: asi se comprueba que el
	// detalle del ultimo intento llega al usuario y no lo tapa el mensaje
	// generico de "ambos limitados".
	globalThis.fetch = async () =>
		new Response("<html>Sorry, you have been blocked</html>", {
			status: 429,
			headers: { "Retry-After": "600", "cf-ray": "9abc123" },
		});

	const res = await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "x",
	});
	const html = await res.text();
	check("bloqueo total -> 429", res.status === 429);
	check("conserva el Retry-After del ultimo intento", html.includes("reintentar en 600s"));
	check("conserva el cuerpo de la respuesta", html.includes("been blocked"));
}

// ── 4c. Fallback al portal cuando el movil esta limitado ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } }, { mobileLimited: true });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");

	check("con el movil limitado, el portal salva el login", Boolean(tokens.access_token));

	const paths = mockGarmin.calls.map((c) => c.path);
	check("intenta primero el movil", paths[0] === "/mobile/api/login");
	check("calienta la pagina del portal antes del POST",
		paths.indexOf("/portal/sso/en-US/sign-in") < paths.indexOf("/portal/api/login"));
	check("el canje usa el service_url del portal",
		mockGarmin.calls.find((c) => c.service)?.service === "https://connect.garmin.com/app");
}

// ── 4d. Los dos flujos limitados ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } },
		{ mobileLimited: true, portalLimited: true });
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();

	const res = await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "a",
	});
	check("ambos limitados -> 429", res.status === 429);
	check("el mensaje desaconseja reintentar en bucle",
		(await res.text()).includes("no reintentes en bucle"));
}

// ── 4e. Una contrasena mala no reintenta por el otro flujo ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();

	await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "mala",
	});
	check("credencial invalida no toca el portal",
		!mockGarmin.calls.some((c) => c.path.startsWith("/portal")));
}

// ── 5. Flujo completo + PKCE ──
{
	mockGarmin({ "ana@x.com": { password: "buena", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens, clientId, params } = await connect(env, "ana@x.com", "buena");

	check("emite access token firmado", tokens.access_token?.split(".").length === 2);
	check("emite refresh token", tokens.refresh_token?.startsWith("gmn_r_"));
	check("token_type Bearer", tokens.token_type === "Bearer");

	// El email no debe aparecer en ninguna clave ni valor del KV.
	const dump = [...env._store.entries()].map(([k, v]) => k + v).join("");
	check("el email no se almacena", !dump.includes("ana@x.com"));
	check("la contrasena no se almacena", !dump.includes("buena"));

	// Verifier incorrecto
	const reg2 = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();
	const r2 = await postForm(env, "/oauth/authorize", {
		client_id: reg2.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "buena",
	});
	const code2 = new URL(r2.headers.get("Location")).searchParams.get("code");
	const badVerifier = await (await postForm(env, "/oauth/token", {
		grant_type: "authorization_code", code: code2, client_id: reg2.client_id,
		redirect_uri: REDIRECT, code_verifier: "otro-verificador-distinto",
	})).json();
	check("PKCE con verifier erroneo -> invalid_grant", badVerifier.error === "invalid_grant");

	// Y el codigo ya se ha quemado, aunque el intento fallara
	const retry = await (await postForm(env, "/oauth/token", {
		grant_type: "authorization_code", code: code2, client_id: reg2.client_id,
		redirect_uri: REDIRECT, code_verifier: VERIFIER,
	})).json();
	check("el codigo se quema tras un intento fallido", retry.error === "invalid_grant");
}

// ── 6. Rotacion de refresh ──
{
	mockGarmin({ "ana@x.com": { password: "buena", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens, clientId } = await connect(env, "ana@x.com", "buena");

	const refreshed = await (await postForm(env, "/oauth/token", {
		grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId,
	})).json();
	// Dos emisiones seguidas caen en el mismo milisegundo: sin entropia propia
	// el token seria identico. Esta comprobacion cazo justo eso.
	check("refresh devuelve tokens nuevos",
		refreshed.access_token && refreshed.access_token !== tokens.access_token);

	const another = await (await postForm(env, "/oauth/token", {
		grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: clientId,
	})).json();
	check("cada emision es un token distinto", another.access_token !== refreshed.access_token);

	const reuse = await (await postForm(env, "/oauth/token", {
		grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId,
	})).json();
	check("un refresh no se puede reutilizar", reuse.error === "invalid_grant");
}

// ── 7. MCP: autenticacion ──
{
	mockGarmin({ "ana@x.com": { password: "buena", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();

	const anon = await postJson(env, "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" });
	check("/mcp sin token -> 401", anon.status === 401);
	check("401 indica donde autenticarse",
		(anon.headers.get("WWW-Authenticate") || "").includes("oauth-protected-resource"));

	const bogus = await rpc(env, "gmn_inventado", { jsonrpc: "2.0", id: 1, method: "initialize" });
	check("token inventado -> 401", bogus.status === 401);

	const { tokens } = await connect(env, "ana@x.com", "buena");
	const init = await rpc(env, tokens.access_token, {
		jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" },
	});
	check("initialize con token valido", init.body.result?.serverInfo?.name === "garmin");

	const list = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	check("tools/list devuelve 11 herramientas", list.body.result.tools.length === 11);
}

// ── 8. AISLAMIENTO: cada usuario ve solo lo suyo ──
{
	mockGarmin({
		"ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } },
		"bob@x.com": { password: "b", mfa: true, data: { displayName: "bob", hrv: 99 } },
	});
	const env = makeEnv();

	const ana = await connect(env, "ana@x.com", "a");
	const bob = await connect(env, "bob@x.com", "b", "123456");

	check("bob entra con MFA", Boolean(bob.tokens.access_token));

	const read = async (token) => {
		const r = await rpc(env, token, {
			jsonrpc: "2.0", id: 3, method: "tools/call",
			params: { name: "garmin_hrv", arguments: { date: "2026-09-20" } },
		});
		return JSON.parse(r.body.result.content[0].text);
	};

	check("ana ve su HRV", (await read(ana.tokens.access_token)).last_night_avg === 50);
	check("bob ve su HRV", (await read(bob.tokens.access_token)).last_night_avg === 99);

	const anaStatus = await rpc(env, ana.tokens.access_token, {
		jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "garmin_status" },
	});
	check("status muestra el displayName propio",
		JSON.parse(anaStatus.body.result.content[0].text).display_name === "ana");

	check("hay dos usuarios distintos en KV",
		[...env._store.keys()].filter((k) => k.startsWith("user:")).length === 2);
}

// ── 8b. Planificacion de rutas ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");

	// Ruta sintetica: 3 puntos, con semaforos y tipos de via en los mensajes.
	const coords = Array.from({ length: 2500 }, (_, i) => [2.14 + i * 0.0001, 41.49 + i * 0.00005, 100 + i * 0.01]);
	const brouterCalls = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		if (String(url).startsWith("https://brouter.de/")) {
			brouterCalls.push(String(url));
			return new Response(JSON.stringify({
				features: [{
					geometry: { coordinates: coords },
					properties: {
						"track-length": "70400",
						"filtered ascend": "412",
						messages: [
							["Longitude", "Latitude", "Elevation", "WayTags", "NodeTags"],
							["1", "2", "3", "highway=tertiary", ""],
							["1", "2", "3", "highway=tertiary", "highway=traffic_signals"],
							["1", "2", "3", "highway=secondary", "highway=traffic_signals"],
							["1", "2", "3", "highway=residential", ""],
						],
					},
				}],
			}));
		}
		return realFetch(url, init);
	};

	const call = async (name, args) => {
		const r = await rpc(env, tokens.access_token, {
			jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args },
		});
		if (r.body.result?.isError) throw new Error(r.body.result.content[0].text);
		return JSON.parse(r.body.result.content[0].text);
	};

	const plan = await call("garmin_plan_route", {
		waypoints: ["41.4914,2.1408", "41.56,2.21", "41.4914,2.1408"],
		name: "Vallès llano",
	});

	check("mide la distancia real del router", plan.distance_km === 70.4);
	check("mide el desnivel real", plan.elevation_gain_m === 412);
	check("cuenta los semaforos", plan.traffic_signals === 2);
	check("resume los tipos de via", plan.road_types?.tertiary === 2);
	check("devuelve enlace de descarga", plan.gpx_url?.endsWith(".gpx"));

	// Lo que NO debe devolver: el trazado.
	const payload = JSON.stringify(plan);
	check("no vuelca el trazado en la respuesta", payload.length < 800, `(${payload.length} chars)`);
	check("informa cuantos puntos tiene", plan.points === 2500);

	check("envia lon,lat al router (no al reves)", brouterCalls[0].includes("lonlats=2.1408,41.4914"));
	check("usa el perfil de carretera por defecto", brouterCalls[0].includes("profile=fastbike"));

	// El GPX se sirve por su id
	const gpx = await get(env, `/route/${plan.route_id}.gpx`);
	const xml = await gpx.text();
	check("el GPX se descarga", gpx.status === 200 && xml.startsWith("<?xml"));
	check("el GPX lleva todos los puntos", (xml.match(/<trkpt/g) || []).length === 2500);
	check("el GPX conserva el nombre", xml.includes("Vallès llano"));

	// Validaciones de entrada
	try {
		await call("garmin_plan_route", { waypoints: ["41.49,2.14"] });
		check("un solo punto deberia fallar", false);
	} catch (e) {
		check("exige al menos dos puntos", e.message.includes("dos puntos"));
	}
	try {
		await call("garmin_plan_route", { waypoints: ["999,999", "41.49,2.14"] });
		check("coordenadas invalidas deberian fallar", false);
	} catch (e) {
		check("rechaza coordenadas fuera de rango", e.message.includes("fuera de rango"));
	}

	// Guardado en Garmin: exige confirmacion
	try {
		await call("garmin_save_course", { route_id: plan.route_id, confirm: false });
		check("sin confirmacion deberia fallar", false);
	} catch (e) {
		check("no escribe sin confirmacion explicita", e.message.includes("confirmacion"));
	}

	// Con confirmacion, submuestrea y postea
	let posted = null;
	globalThis.fetch = async (url, init) => {
		if (String(url).includes("/course-service/course")) {
			posted = JSON.parse(init.body);
			return new Response(JSON.stringify({ courseId: 987 }));
		}
		return new Response(JSON.stringify({}), { status: 404 });
	};
	const saved = await call("garmin_save_course", { route_id: plan.route_id, confirm: true });
	check("guarda y devuelve el course_id", saved.course_id === 987);
	check("submuestrea los puntos para Garmin", posted.geoPoints.length <= 1001, `(${posted.geoPoints.length})`);
	check("conserva el punto final", posted.geoPoints.at(-1).longitude === coords.at(-1)[0]);

	// Sin distancia acumulada por punto, Garmin mostraba el recorrido con
	// 0 km y 0 m de desnivel aunque el trazado fuese correcto.
	check("el primer punto arranca en cero", posted.geoPoints[0].distance === 0);
	check("la distancia acumulada crece",
		posted.geoPoints.every((p, i) => i === 0 || p.distance > posted.geoPoints[i - 1].distance));
	check("el total coincide con el ultimo punto",
		posted.distance === posted.geoPoints.at(-1).distance);
	check("declara desnivel positivo y negativo",
		posted.elevationGain > 0 && typeof posted.elevationLoss === "number");
	check("el punto de inicio es el primero", posted.startPoint.latitude === posted.geoPoints[0].latitude);

	// Aislamiento: la ruta de ana no la puede guardar bob
	const bobEnv = env;
	const bob = await (async () => {
		mockGarmin({ "bob@x.com": { password: "b", data: { displayName: "bob", hrv: 9 } } });
		return connect(bobEnv, "bob@x.com", "b");
	})();
	const r = await rpc(bobEnv, bob.tokens.access_token, {
		jsonrpc: "2.0", id: 8, method: "tools/call",
		params: { name: "garmin_save_course", arguments: { route_id: plan.route_id, confirm: true } },
	});
	check("no se puede guardar la ruta de otro",
		r.body.result.content[0].text.includes("otro usuario"));
}

// ── 8c. El caso de Paula: el KV no ha propagado ──
{
	mockGarmin({ "paula@x.com": { password: "p", data: { displayName: "paula", hrv: 61 } } });

	// Nada de lo que se escriba durante el handshake sera visible al leerlo:
	// exactamente lo que pasa cuando el usuario autoriza desde un pais y
	// Claude canjea el codigo desde otro.
	const env = makeEnv({}, { isolated: true });

	const { tokens } = await connect(env, "paula@x.com", "p");
	check("el handshake completo funciona sin leer del KV", Boolean(tokens.access_token));

	const init = await rpc(env, tokens.access_token, {
		jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" },
	});
	check("el token de acceso vale sin leer del KV", init.body.result?.serverInfo?.name === "garmin");

	const list = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	check("las herramientas se listan igualmente", list.body.result.tools.length === 11);

	// Y el dato que si vive en KV avisa en vez de mentir
	const call = await rpc(env, tokens.access_token, {
		jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "garmin_hrv", arguments: {} },
	});
	check("si el registro aun no propago, lo explica",
		call.body.result.content[0].text.includes("espera un minuto"));
}

// ── 8d. Las credenciales firmadas no se aceptan de cualquiera ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");

	// Se altera el contenido, no el ultimo caracter: en base64url el ultimo
	// puede cambiar sin alterar los bytes que representa.
	const [body, sig] = tokens.access_token.split(".");
	const tampered = `${body.slice(0, -2)}${body.slice(-2, -1) === "A" ? "B" : "A"}${body.slice(-1)}.${sig}`;
	const bad = await rpc(env, tampered, { jsonrpc: "2.0", id: 1, method: "initialize" });
	check("una firma manipulada se rechaza", bad.status === 401);

	// Firmado con otra clave: mismo formato, servidor distinto.
	const otherEnv = { ...env, SIGNING_KEY: "otra-clave-distinta" };
	const foreign = await worker.fetch(new Request(`${ORIGIN}/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.access_token}` },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
	}), otherEnv);
	check("un token de otro servidor se rechaza", foreign.status === 401);
}

// ── 9. Renovacion del token de Garmin al caducar ──
{
	const env = makeEnv();
	const userId = "usuario-de-prueba";
	env._store.set(`user:${userId}`, JSON.stringify({
		di_token: "viejo", di_refresh_token: "ref", di_client_id: "cid", displayName: "ana",
	}));
	const token = await signForTest(env.SIGNING_KEY, { userId, exp: Date.now() + 3600e3 });

	let refreshed = false;
	globalThis.fetch = async (url, init) => {
		if (new URL(url).hostname === "diauth.garmin.com") {
			refreshed = true;
			return new Response(JSON.stringify({ access_token: "nuevo", refresh_token: "ref2" }));
		}
		if (init.headers.Authorization === "Bearer viejo") return new Response("expired", { status: 401 });
		return new Response(JSON.stringify({ hrvSummary: { lastNightAvg: 77 } }));
	};

	const r = await rpc(env, token, {
		jsonrpc: "2.0", id: 5, method: "tools/call",
		params: { name: "garmin_hrv", arguments: { date: "2026-09-20" } },
	});
	check("401 de Garmin dispara renovacion", refreshed);
	check("tras renovar, devuelve datos", JSON.parse(r.body.result.content[0].text).last_night_avg === 77);
	check("el token renovado se persiste",
		JSON.parse(env._store.get(`user:${userId}`)).di_token === "nuevo");
}

/** Firma un token como lo hace el worker, para poder fabricar uno en un test. */
async function signForTest(secret, payload) {
	const b64 = (bytes) =>
		Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const body = b64(new TextEncoder().encode(JSON.stringify(payload)));
	const key = await crypto.subtle.importKey(
		"raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return `${body}.${b64(new Uint8Array(sig))}`;
}

async function sha256Hex(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
