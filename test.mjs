import worker from "./worker.js";
import { readFile } from "node:fs/promises";

const anot0 = (l) => Object.fromEntries(l.body.result.tools.map((t) => [t.name, t.annotations]));
const ORIGIN = "https://garmin.example.workers.dev";

// La espera anti-WAF del flujo portal es de ~10s reales: aqui no aporta nada
// y haria los tests eternos, asi que los temporizadores disparan al momento.
globalThis.setTimeout = (fn) => { fn(); return 0; };

/**
 * `isolated: true` imita el KV real cuando la escritura todavia no ha
 * propagado: se escribe, pero las lecturas no lo ven. Es el escenario que
 * rompia la conexion de otra persona desde otro pais.
 */

/**
 * D1 de mentira. Entiende solo las sentencias que usa el worker, que son
 * pocas a proposito: toda la agregacion se hace en JS para que la base
 * aguante en el plan gratuito y para poder probarla sin un SQLite de verdad.
 */
function makeD1() {
	const tablas = new Map();
	const tabla = (n) => {
		if (!tablas.has(n)) tablas.set(n, new Map());
		return tablas.get(n);
	};
	const clavePrimaria = { activities: ["user_id", "activity_id"], days: ["user_id", "date"], sync_state: ["user_id"] };

	const ejecutar = (sql, args) => {
		const limpio = sql.replace(/\s+/g, " ").trim();
		if (/^CREATE/i.test(limpio)) return { results: [] };

		const ins = limpio.match(/^INSERT(?: OR REPLACE)? INTO (\w+) \(([^)]+)\)/i);
		if (ins) {
			const [, nombre, columnas] = ins;
			const cols = columnas.split(",").map((c) => c.trim());
			const fila = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
			const pk = clavePrimaria[nombre];
			tabla(nombre).set(pk ? pk.map((c) => fila[c]).join("|") : String(tabla(nombre).size), fila);
			return { results: [] };
		}

		const sel = limpio.match(/FROM (\w+)/i);
		const filas = [...tabla(sel[1]).values()].filter((f) => f.user_id === args[0]);

		if (/MIN\(start_date\)/.test(limpio)) {
			const fechas = filas.map((f) => f.start_date).sort();
			return { results: [{ oldest: fechas[0] ?? null, newest: fechas.at(-1) ?? null, n: filas.length }] };
		}
		if (/AND date >= \?/.test(limpio))
			return { results: filas.filter((f) => f.date >= args[1]).map((f) => ({ date: f.date })) };

		const orden = limpio.match(/ORDER BY (\w+)/i)?.[1];
		if (orden) filas.sort((a, b) => String(a[orden]).localeCompare(String(b[orden])));
		return { results: filas };
	};

	const prepare = (sql) => ({
		bind: (...args) => ({
			async run() { return ejecutar(sql, args); },
			async all() { return ejecutar(sql, args); },
			async first() { return ejecutar(sql, args).results[0] ?? null; },
		}),
		async run() { return ejecutar(sql, []); },
		async all() { return ejecutar(sql, []); },
		async first() { return ejecutar(sql, []).results[0] ?? null; },
	});

	return { prepare, async batch(lote) { for (const q of lote) await q.run(); }, _tablas: tablas };
}

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
			async list({ prefix = "" } = {}) {
				return { keys: [...visible.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
			},
		},
		LOGS: makeD1(),
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
	check("tools/list devuelve 15 herramientas", list.body.result.tools.length === 15);
	check("app_guardar se anuncia como escritura", anot0(list).app_guardar.readOnlyHint === false);
	{
		const call = (name, args) => rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
		await call("app_guardar", { doc: "estado/app", datos: { plan: { "2026-09-28": { dep: "bici" } } } });
		await call("app_guardar", { doc: "estado/app", datos: { nombre: "A" }, fusionar: true });
		const leido = JSON.parse((await call("app_leer", { doc: "estado/app" })).body.result.content[0].text);
		check("myCoach: guardar, fusionar y leer", leido.nombre === "A" && leido.plan["2026-09-28"].dep === "bici");
		const malo = await call("app_leer", { doc: "../user:x" });
		check("myCoach: rutas de documento no validas se rechazan", malo.body.result.isError === true);
	}
	// Solo garmin_save_course escribe; anunciarlas todas como de solo
	// lectura invitaba al cliente a llamarla sin preguntar.
	const anot = Object.fromEntries(list.body.result.tools.map((t) => [t.name, t.annotations]));
	check("las lecturas se anuncian como tales", anot.garmin_courses.readOnlyHint === true);
	check("la subida no se anuncia como lectura", anot.garmin_save_course.readOnlyHint === false);
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
	check("no vuelca el trazado en la respuesta", payload.length < 3000, `(${payload.length} chars)`);
	// Un perfil compacto si: el modelo necesita saber donde estan las subidas.
	check("devuelve un perfil de 40 puntos", plan.perfil?.length === 40);
	check("el perfil empieza en el km 0 y acaba en el total",
		plan.perfil[0][0] === 0 && plan.perfil.at(-1)[0] > 0 &&
		plan.perfil.at(-1)[0] === Math.max(...plan.perfil.map((p) => p[0])));
	check("el perfil lleva altitud y coordenadas",
		plan.perfil.every((p) => p.length === 4 && typeof p[1] === "number"));
	check("el perfil se reparte por distancia, no por indice",
		plan.perfil.slice(1).every((p, i) => p[0] >= plan.perfil[i][0]));
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
			if (init?.method === "POST") {
				posted = JSON.parse(init.body);
				return new Response(JSON.stringify({ courseId: 987 }));
			}
			// La relectura: Garmin devuelve sus propios numeros, que no tienen
			// por que coincidir con los enviados (usa otro modelo de elevacion).
			return new Response(JSON.stringify({ distanceMeter: 70400, elevationGainMeter: 540 }));
		}
		return new Response(JSON.stringify({}), { status: 404 });
	};
	const saved = await call("garmin_save_course", { route_id: plan.route_id, confirm: true });
	check("guarda y devuelve el course_id", saved.course_id === 987);

	// Subir sin comprobar fue como se colo una ruta con el desnivel a cero.
	check("relee lo que Garmin ha guardado", saved.segun_garmin?.distancia_km === 70.4);
	check("devuelve el desnivel segun Garmin", saved.segun_garmin?.desnivel_m === 540);
	check("submuestrea los puntos para Garmin", posted.geoPoints.length <= 1001, `(${posted.geoPoints.length})`);
	check("conserva el punto final", posted.geoPoints.at(-1).longitude === coords.at(-1)[0]);

	// Sin distancia acumulada por punto, Garmin mostraba el recorrido con
	// 0 km y 0 m de desnivel aunque el trazado fuese correcto.
	check("el primer punto arranca en cero", posted.geoPoints[0].distance === 0);
	check("la distancia acumulada crece",
		posted.geoPoints.every((p, i) => i === 0 || p.distance > posted.geoPoints[i - 1].distance));
	check("el total coincide con el ultimo punto",
		posted.distanceMeter === posted.geoPoints.at(-1).distance);

	// El submuestreo no debe encoger la ruta: la distancia se mide sobre el
	// trazado completo, no sobre las rectas entre los puntos conservados.
	const sumaAtajos = posted.geoPoints.reduce((total, p, i, todos) =>
		i === 0 ? 0 : total + Math.hypot(
			(p.longitude - todos[i - 1].longitude) * 82000,
			(p.latitude - todos[i - 1].latitude) * 111000), 0);
	check("no pierde longitud al submuestrear", posted.distanceMeter > sumaAtajos,
		`(real ${Math.round(posted.distanceMeter)} vs atajos ${Math.round(sumaAtajos)})`);
	check("declara desnivel positivo y negativo",
		posted.elevationGainMeter > 0 && typeof posted.elevationLossMeter === "number");
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

// ── 8b bis. Lectura de recorridos ya guardados ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");

	const call = async (name, args) => {
		const r = await rpc(env, tokens.access_token, {
			jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args },
		});
		if (r.body.result?.isError) throw new Error(r.body.result.content[0].text);
		return JSON.parse(r.body.result.content[0].text);
	};

	// El servicio de recorridos no esta documentado: la primera ruta
	// conocida puede no existir, y la herramienta debe seguir probando en
	// vez de decirle al usuario que no tiene recorridos.
	const pedidas = [];
	const puntos = Array.from({ length: 900 }, (_, i) => ({
		latitude: 42.37 + i * 0.0001, longitude: 1.76 + i * 0.0002,
	}));
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.pathname === "/userprofile-service/socialProfile")
			return new Response(JSON.stringify({ displayName: "ana" }));
		pedidas.push(u.pathname);
		if (u.pathname === "/course-service/course/owner/ana")
			return new Response("no", { status: 404 });
		if (u.pathname === "/course-service/course/owner")
			return new Response(JSON.stringify({
				coursesForUser: [
					{ courseId: 517620552, courseName: "Cerdanya: bucle solana",
					  distanceMeter: 42880, elevationGainMeter: 718, elevationLossMeter: 715,
					  createDate: "2026-09-22" },
					{ id: 1, name: "Vieja", distance: 70400, elevationGain: 412 },
					// Nombres que Garmin usa de verdad en el listado.
					{ courseId: 2, courseName: "Otra", totalDistanceInMeters: 55500,
					  totalAscentInMeters: 640, totalDescentInMeters: 640, createDate: 1790380800000 },
					{ courseId: 3, courseName: "Con ruido", distanceFromStart: 999999,
					  totalDistanceInMeters: 12000 },
					{ courseId: 4, courseName: "En km", distance: 30.5 },
				],
			}));
		if (u.pathname === "/course-service/course/517620552")
			return new Response(JSON.stringify({
				courseId: 517620552, courseName: "Cerdanya: bucle solana",
				distanceMeter: 42880, elevationGainMeter: 718, geoPoints: puntos,
			}));
		return new Response(JSON.stringify({}), { status: 404 });
	};

	const lista = await call("garmin_courses", {});
	check("prueba otra ruta si la primera no existe", lista.endpoint === "/course-service/course/owner");
	check("insiste antes de rendirse", pedidas.includes("/course-service/course/owner/ana"));
	check("lista los recorridos guardados", lista.courses.length === 5);
	check("traduce los metros a km", lista.courses[0].distance_km === 42.88);
	check("devuelve el desnivel guardado", lista.courses[0].elevation_gain_m === 718);
	check("devuelve el course_id", lista.courses[0].course_id === 517620552);
	// Garmin no usa los mismos nombres en la lista y en el detalle.
	check("acepta los nombres alternativos", lista.courses[1].distance_km === 70.4
		&& lista.courses[1].name === "Vieja" && lista.courses[1].course_id === 1);
	// El listado real de Garmin no usa ninguno de los dos nombres que se
	// suponian, y la ruta salia sin distancia ni desnivel. Ahora el campo se
	// busca por lo que significa.
	check("encuentra la distancia con otro nombre", lista.courses[2].distance_km === 55.5);
	check("encuentra el desnivel con otro nombre", lista.courses[2].elevation_gain_m === 640);
	check("no confunde la distancia al inicio", lista.courses[3].distance_km === 12.0);
	check("acepta kilometros ya convertidos", lista.courses[4].distance_km === 30.5);
	check("traduce la fecha en milisegundos", lista.courses[2].created === "2026-09-26");

	const detalle = await call("garmin_course_detail", { course_id: "517620552", puntos: 12 });
	check("lee un recorrido concreto", detalle.name === "Cerdanya: bucle solana");
	check("reduce el trazado a los puntos pedidos", detalle.waypoints.length === 12);
	check("el primer punto es el inicio", detalle.waypoints[0] === "42.3700,1.7600");
	check("el ultimo punto es el final", detalle.waypoints.at(-1) ===
		`${puntos.at(-1).latitude.toFixed(4)},${puntos.at(-1).longitude.toFixed(4)}`);
	check("los puntos van como lat,lon", detalle.waypoints.every((p) => /^4\d\.\d{4},\d\.\d{4}$/.test(p)));

	// Un recorrido sin trazado no debe reventar: se dice y ya.
	globalThis.fetch = async () => new Response(JSON.stringify({ courseId: 5, courseName: "Sin linea" }));
	const vacio = await call("garmin_course_detail", { course_id: "5" });
	check("un recorrido sin trazado no rompe", vacio.waypoints.length === 0 && vacio.name === "Sin linea");

	// Si ninguna ruta contesta, el error dice que se intento.
	globalThis.fetch = async (url) =>
		new URL(url).pathname === "/userprofile-service/socialProfile"
			? new Response(JSON.stringify({ displayName: "ana" }))
			: new Response("no", { status: 404 });
	try {
		await call("garmin_courses", {});
		check("deberia fallar si ninguna ruta contesta", false);
	} catch (e) {
		check("el error enumera lo que se intento", e.message.includes("/course-service/course/owner"));
	}
}

// ── 8b ter. Análisis de una actividad: subidas, zonas, desacople ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	const call = async (name, args) => {
		const r = await rpc(env, tokens.access_token, {
			jsonrpc: "2.0", id: 11, method: "tools/call", params: { name, arguments: args },
		});
		if (r.body.result?.isError) throw new Error(r.body.result.content[0].text);
		return JSON.parse(r.body.result.content[0].text);
	};

	// Salida sintética, una muestra cada 50 m: 5 km llanos a 30 km/h, 3 km
	// al 6 % a 15 km/h (180 m de desnivel), bajada y 10 km llanos. El pulso
	// sube 10 ppm en la segunda mitad a la misma velocidad: eso es desacople.
	const filas = [];
	let d = 0, t = 0, e = 500;
	const tramo = (metros, kmh, pend, fc) => {
		for (let x = 0; x < metros; x += 50) {
			d += 50; t += 50 / (kmh / 3.6); e += 50 * pend;
			filas.push({ metrics: [fc(t), e, d, t] });
		}
	};
	tramo(5000, 30, 0, () => 130);
	tramo(3000, 15, 0.06, () => 160);
	tramo(3000, 40, -0.06, () => 120);
	tramo(40000, 30, 0, (tt) => (tt > 3600 ? 145 : 135));
	const details = {
		metricDescriptors: [
			{ key: "directHeartRate", metricsIndex: 0 }, { key: "directElevation", metricsIndex: 1 },
			{ key: "sumDistance", metricsIndex: 2 }, { key: "sumDuration", metricsIndex: 3 },
		],
		activityDetailMetrics: filas,
	};
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		if (u.pathname.endsWith("/details")) return new Response(JSON.stringify(details));
		if (u.pathname.endsWith("/hrTimeInZones"))
			return new Response(JSON.stringify([{ zoneNumber: 1, secsInZone: 600, zoneLowBoundary: 100 }, { zoneNumber: 2, secsInZone: 3000, zoneLowBoundary: 130 }]));
		if (u.pathname.startsWith("/activity-service/activity/"))
			return new Response(JSON.stringify({ activityName: "Sintética", activityTypeDTO: { typeKey: "road_biking" }, summaryDTO: { distance: d, duration: t, averageHR: 140 } }));
		return new Response("{}", { status: 404 });
	};

	const r = await call("garmin_activity_detail", { activity_id: "1" });
	const sub = r.analisis?.subidas || [];
	check("detecta la subida", sub.length === 1, `(${sub.length})`);
	check("mide su desnivel", Math.abs(sub[0]?.desnivel_m - 180) <= 15, `(${sub[0]?.desnivel_m})`);
	check("mide su pendiente", Math.abs(sub[0]?.pendiente_pct - 6) <= 0.6, `(${sub[0]?.pendiente_pct})`);
	check("calcula la VAM", Math.abs(sub[0]?.vam_m_h - 900) <= 90, `(${sub[0]?.vam_m_h})`);
	check("estima vatios por kilo", Math.abs(sub[0]?.w_kg_estimado - 3.46) <= 0.4, `(${sub[0]?.w_kg_estimado})`);
	check("lleva el pulso de la subida", sub[0]?.fc_media >= 155 && sub[0]?.fc_media <= 160, `(${sub[0]?.fc_media})`);
	check("encuentra tramos llanos", r.analisis?.llano?.km >= 30 && Math.abs(r.analisis.llano.vel_media_kmh - 30) < 1.5,
		`(${JSON.stringify(r.analisis?.llano)})`);
	// El desacople solo tiene sentido en llano: dos horas a 30 km/h con el
	// pulso subiendo de 130 a 143 en la segunda hora dan 1 - 130/143 ≈ 9 %.
	const llanas = [];
	for (let x = 1, tt = 0; x <= 1200; x++) { tt += 50 / (30 / 3.6); llanas.push({ metrics: [tt > 3600 ? 143 : 130, 200, x * 50, tt] }); }
	const planaDetails = { ...details, activityDetailMetrics: llanas };
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		if (u.pathname.endsWith("/details")) return new Response(JSON.stringify(planaDetails));
		if (u.pathname.endsWith("/hrTimeInZones")) return new Response("[]");
		return new Response(JSON.stringify({ activityName: "Llana", summaryDTO: {} }));
	};
	const plana = await call("garmin_activity_detail", { activity_id: "3" });
	check("mide el desacople", Math.abs(plana.analisis?.desacople_pct - 9.1) < 1.5, `(${plana.analisis?.desacople_pct})`);
	check("en llano no ve subidas", plana.analisis?.subidas?.length === 0);
	check("pulso máximo sostenido 5 min", r.analisis?.fc_max_sostenida?.min5 === 160, `(${r.analisis?.fc_max_sostenida?.min5})`);
	check("devuelve las zonas de Garmin", r.zonas_fc?.[1]?.minutos === 50);
	// 5 km a 30 km/h a 130 ppm son 10 minutos en el cubo de 130.
	check("histograma de pulso por cubos de 5 ppm", Math.abs(r.analisis?.histograma_fc_min?.["130"] - 10) < 1,
		`(${JSON.stringify(r.analisis?.histograma_fc_min)})`);

	// Si las series fallan, el detalle básico sale igual.
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		if (u.pathname.endsWith("/details") || u.pathname.endsWith("/hrTimeInZones")) return new Response("x", { status: 500 });
		return new Response(JSON.stringify({ activityName: "Sin series", summaryDTO: { distance: 1000 } }));
	};
	const basico = await call("garmin_activity_detail", { activity_id: "2" });
	check("sin series, el detalle sigue saliendo", basico.name === "Sin series" && basico.analisis === null);
}

// ── 8b quater. Perfil de forma según Garmin ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	// Formas reales de las respuestas de Garmin (recortadas).
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		const r = (x) => new Response(JSON.stringify(x));
		if (u.pathname.includes("trainingreadiness")) return r([{ score: 39, level: "LOW" }]);
		if (u.pathname.includes("maxmet")) return r([]);
		if (u.pathname.endsWith("/endurancescore")) return r({ overallScore: 6319, gaugeLowerLimit: 3570,
			classificationLowerLimitIntermediate: 5100, classificationLowerLimitTrained: 5800, classificationLowerLimitWellTrained: 6600,
			classificationLowerLimitExpert: 7300, classificationLowerLimitSuperior: 8100, classificationLowerLimitElite: 8800, gaugeUpperLimit: 10560 });
		if (u.pathname.endsWith("/hillscore")) return r({ overallScore: null, vo2MaxPreciseValue: 52.6 });
		if (u.pathname.includes("trainingstatus")) return r({ mostRecentVO2Max: { generic: { calendarDate: "2026-09-20", vo2MaxPreciseValue: 52.6 }, cycling: null },
			mostRecentTrainingLoadBalance: { metricsTrainingLoadBalanceDTOMap: { "360": { monthlyLoadAerobicLow: 553.8, monthlyLoadAerobicHigh: 989.4,
				monthlyLoadAnaerobic: 795.5, monthlyLoadAerobicLowTargetMin: 253, monthlyLoadAerobicLowTargetMax: 580, monthlyLoadAerobicHighTargetMin: 347,
				monthlyLoadAerobicHighTargetMax: 674, monthlyLoadAnaerobicTargetMin: 109, monthlyLoadAnaerobicTargetMax: 327, trainingBalanceFeedbackPhrase: "ABOVE_TARGETS" } } } });
		if (u.pathname.includes("user-settings")) return r({ userData: { gender: "MALE", weight: 72000, birthDate: "1990-05-01", lactateThresholdHeartRate: 171 } });
		return new Response("{}", { status: 404 });
	};
	const res = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 12, method: "tools/call",
		params: { name: "garmin_training_readiness", arguments: { date: "2026-09-25" } } });
	const pg = JSON.parse(res.body.result.content[0].text).perfil_garmin;
	check("lee el VO2máx aunque maxmet venga vacío", pg.vo2max === 52.6);
	check("sitúa el Endurance Score en su nivel", pg.endurance?.nivel === "Entrenado", `(${pg.endurance?.nivel})`);
	check("dice cuánto falta para el siguiente nivel", pg.endurance?.siguiente?.nivel === "Muy entrenado" && pg.endurance.siguiente.desde === 6600);
	check("interpreta el balance de carga del mes", pg.balance_carga_mes?.anaerobica?.carga === 796 &&
		pg.balance_carga_mes.anaerobica.objetivo[1] === 327 && pg.balance_carga_mes.veredicto_garmin === "ABOVE_TARGETS");
	check("calcula la edad y lee el umbral de lactato", pg.persona.edad === 36 && pg.persona.umbral_lactato_ppm === 171 && pg.persona.peso_kg === 72);
}

// ── 8b quinquies. Polilínea del recorrido ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	// Ejemplo de la documentación de Google: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
	globalThis.fetch = async () => new Response(JSON.stringify({ geoPolylineDTO: { polyline: [
		{ lat: 38.5, lon: -120.2 }, { lat: 40.7, lon: -120.95 }, { lat: 43.252, lon: -126.453 }] } }));
	const res = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 13, method: "tools/call",
		params: { name: "garmin_activity_route", arguments: { activity_id: "9", puntos: 5 } } });
	const out = JSON.parse(res.body.result.content[0].text);
	check("codifica el recorrido como polilínea de Google", out.polilinea === "_p~iF~ps|U_ulLnnqC_mqNvxq`@", `(${out.polilinea})`);
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
	check("las herramientas se listan igualmente", list.body.result.tools.length === 15);

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

// ── 10. Panel de progreso ──
{
	const HOY = new Date();
	const haceDias = (n) => new Date(HOY.getTime() - n * 86400000).toISOString().slice(0, 10);

	// 40 salidas, una cada tres dias, todas iguales: la forma tiene que subir
	// y luego estabilizarse, que es lo que hace una carga constante.
	const actividades = Array.from({ length: 40 }, (_, i) => ({
		activityId: 1000 + i,
		activityName: "Salida " + i,
		activityType: { typeKey: i % 5 === 0 ? "running" : "road_biking" },
		startTimeLocal: haceDias(120 - i * 3) + " 09:00:00",
		duration: 5400,
		movingDuration: 5400,
		distance: 45000,
		elevationGain: 500,
		averageHR: 145,
		maxHR: 178,
		averageSpeed: 8.3,
		calories: 1200,
	}));

	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();

	const realFetch = globalThis.fetch;
	let listados = 0;

	// Envuelve el mock de Garmin que este puesto: responde a lo que pide el
	// panel y deja pasar el resto (login, perfil...).
	const conPanel = (lista) => {
		const abajo = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			const u = new URL(url);
			if (u.pathname.includes("/activitylist-service/")) {
				listados++;
				const desde = Number(u.searchParams.get("start"));
				return new Response(JSON.stringify(lista.slice(desde, desde + 100)));
			}
			if (u.pathname.includes("/usersummary-service/"))
				return new Response(JSON.stringify({ restingHeartRate: 48, totalSteps: 9000, bodyBatteryHighestValue: 90 }));
			if (u.pathname.includes("/wellness-service/") || u.pathname.includes("/hrv-service/"))
				return new Response(JSON.stringify({}), { status: 404 });
			return abajo(url, init);
		};
	};
	conPanel(actividades);

	// Sin cookie no se ve nada
	const anon = await get(env, "/panel");
	check("el panel pide login si no hay sesion", anon.status === 200 && (await anon.text()).includes("Entra con tu cuenta"));
	check("los datos del panel exigen sesion", (await get(env, "/panel/datos")).status === 401);

	// Entrar
	const entrada = await postForm(env, "/panel/entrar", { email: "ana@x.com", password: "a" });
	const galleta = (entrada.headers.get("Set-Cookie") || "").split(";")[0];
	check("entrar deja una sesion", entrada.status === 302 && galleta.startsWith("panel="));
	check("la cookie de sesion no viaja a terceros",
		(entrada.headers.get("Set-Cookie") || "").includes("HttpOnly") &&
		(entrada.headers.get("Set-Cookie") || "").includes("SameSite=Lax"));
	const conSesion = { Cookie: galleta };

	// Una cookie inventada no vale
	check("una cookie falsa no entra",
		(await get(env, "/panel/datos", { Cookie: "panel=falsa.firma" })).status === 401);

	// Sincronizar
	const sync = await worker.fetch(new Request(`${ORIGIN}/panel/sync`, { method: "POST", headers: conSesion }), env);
	const avance = await sync.json();
	check("la sincronizacion trae las actividades", avance.traidas === 40, `(${avance.traidas})`);
	check("sabe que ya lo tiene todo", avance.completo === true);

	const datos = await (await get(env, "/panel/datos", conSesion)).json();
	check("guarda todas las actividades", datos.total.actividades === 40);
	check("cuenta solo los km de bici", datos.total.km === 32 * 45, `(${datos.total.km})`);

	// La curva
	const curva = datos.curva;
	check("la curva cubre desde la primera salida", curva[0].d === haceDias(120));
	check("la forma sube con el entrenamiento", curva.at(-1).ctl > curva[10].ctl,
		`(${curva[10].ctl} -> ${curva.at(-1).ctl})`);
	check("la forma se estabiliza con carga constante",
		Math.abs(curva.at(-1).ctl - curva[Math.floor(curva.length * 0.7)].ctl) < curva.at(-1).ctl * 0.3);
	// La frescura usa los valores de ayer: un entreno duro hoy no puede bajar
	// la forma antes de haberlo asimilado.
	check("la frescura es forma menos fatiga del dia anterior",
		Math.abs(curva[20].tsb - (curva[19].ctl - curva[19].atl)) < 0.05);
	check("hay carga en los dias de entreno", curva.some((p) => p.carga > 0));
	check("la carga sale del pulso", datos.fuentes.includes("pulso"));

	// Referencias sacadas de los propios datos
	check("deduce la FC maxima de las salidas", datos.ajustes.hr_max === 178);
	check("deduce la FC de reposo de los dias", datos.ajustes.hr_rest === 48);

	// Semanas y eficiencia
	check("agrupa por semanas", datos.semanas.filas.length > 5);
	check("agrupa la bici y el correr por familia",
		datos.semanas.deportes.join(",") === "bici,correr", `(${datos.semanas.deportes})`);
	check("calcula metros por pulsacion", datos.eficiencia.length === 32 &&
		Math.abs(datos.eficiencia[0].valor - 45000 / (145 * 90)) < 0.01);
	check("dice que aun no hay potencia", datos.tiene_potencia === false);

	// Garmin manda la misma bici como "cycling" o como "road_biking" segun el
	// aparato. Contandolas aparte, el deporte principal se partia en dos y
	// acababa en "otros", que es lo que se vio en los datos reales.
	{
		const mezcla = [
			...Array.from({ length: 6 }, (_, i) => ({ ...actividades[0], activityId: 7000 + i,
				activityType: { typeKey: "cycling" }, startTimeLocal: haceDias(40 - i) + " 09:00:00" })),
			...Array.from({ length: 6 }, (_, i) => ({ ...actividades[0], activityId: 7100 + i,
				activityType: { typeKey: "road_biking" }, startTimeLocal: haceDias(30 - i) + " 09:00:00" })),
			...Array.from({ length: 9 }, (_, i) => ({ ...actividades[0], activityId: 7200 + i,
				activityType: { typeKey: "hiking" }, duration: 7200,
				startTimeLocal: haceDias(20 - i) + " 09:00:00" })),
		];
		const envMix = makeEnv();
		mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
		conPanel(mezcla);
		const e = await postForm(envMix, "/panel/entrar", { email: "ana@x.com", password: "a" });
		const ses = { Cookie: (e.headers.get("Set-Cookie") || "").split(";")[0] };
		await worker.fetch(new Request(`${ORIGIN}/panel/sync`, { method: "POST", headers: ses }), envMix);
		const mix = await (await get(envMix, "/panel/datos", ses)).json();

		check("cycling y road_biking cuentan como un solo deporte",
			mix.semanas.deportes.filter((d) => d === "bici").length === 1);
		check("la bici no acaba en 'otros' por llamarse de dos maneras",
			mix.semanas.deportes[0] === "bici", `(${mix.semanas.deportes})`);
		const horasBici = mix.semanas.filas.reduce((s, f) => s + (f.horas.bici || 0), 0);
		check("suma las horas de las dos etiquetas de bici", Math.abs(horasBici - 12 * 1.5) < 0.05, `(${horasBici})`);
		// Aunque el senderismo sume mas horas, la bici manda en el orden.
		check("el senderismo va a otros sin desplazar a la bici",
			mix.semanas.deportes.join(",") === "bici,otros", `(${mix.semanas.deportes})`);
		check("los km cuentan las dos etiquetas de bici", mix.total.km === 12 * 45);
		conPanel(actividades); // se devuelve la lista de siempre a los tests de abajo
	}

	// Sincronizar otra vez no duplica ni vuelve a pedir el historico entero
	const antes = listados;
	await worker.fetch(new Request(`${ORIGIN}/panel/sync`, { method: "POST", headers: conSesion }), env);
	const otraVez = await (await get(env, "/panel/datos", conSesion)).json();
	check("no duplica al resincronizar", otraVez.total.actividades === 40);
	check("ya no vuelve a pedir el historico entero", listados - antes === 1, `(${listados - antes} paginas)`);

	// Una salida nueva entra por delante de la lista: si se siguiera usando el
	// desplazamiento guardado, se la saltaria para siempre.
	actividades.unshift({ ...actividades[0], activityId: 9999, activityName: "Recien hecha",
		startTimeLocal: haceDias(0) + " 09:00:00" });
	await worker.fetch(new Request(`${ORIGIN}/panel/sync`, { method: "POST", headers: conSesion }), env);
	const conNueva = await (await get(env, "/panel/datos", conSesion)).json();
	check("recoge una salida nueva sin rehacer el historico", conNueva.total.actividades === 41,
		`(${conNueva.total.actividades})`);

	// Ajustes a mano: cambian la curva entera
	await worker.fetch(new Request(`${ORIGIN}/panel/ajustes`, {
		method: "POST", headers: { ...conSesion, "Content-Type": "application/json" },
		body: JSON.stringify({ hr_rest: 40, hr_max: 200, ftp: "" }),
	}), env);
	const ajustada = await (await get(env, "/panel/datos", conSesion)).json();
	check("los ajustes a mano mandan", ajustada.ajustes.hr_max === 200 && ajustada.ajustes.hr_rest === 40);
	check("cambiar las referencias recalcula la forma", ajustada.hoy.ctl !== datos.hoy.ctl);

	// Potencia: cuando aparezca, manda sobre el pulso
	actividades.forEach((a) => { a.avgPower = 200; a.normPower = 215; a.averageBikingCadenceInRevPerMinute = 88; });
	const env2 = makeEnv();
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	conPanel(actividades);
	const entrada2 = await postForm(env2, "/panel/entrar", { email: "ana@x.com", password: "a" });
	const sesion2 = { Cookie: (entrada2.headers.get("Set-Cookie") || "").split(";")[0] };
	await worker.fetch(new Request(`${ORIGIN}/panel/sync`, { method: "POST", headers: sesion2 }), env2);
	const conPotencia = await (await get(env2, "/panel/datos", sesion2)).json();
	check("detecta la potencia en cuanto llega", conPotencia.tiene_potencia === true);
	check("detecta la cadencia en cuanto llega", conPotencia.tiene_cadencia === true);
	check("con potencia, la carga deja de salir del pulso",
		conPotencia.fuentes.includes("potencia") && !conPotencia.fuentes.includes("pulso"));
	check("estima un FTP si no se le da", conPotencia.ajustes.ftp > 0 && conPotencia.ajustes.ftp_estimado === true);
	check("guarda los vatios por pulsacion", conPotencia.eficiencia[0].vatios_por_pulso > 0);

	// Aislamiento entre usuarios
	mockGarmin({ "bob@x.com": { password: "b", data: { displayName: "bob", hrv: 9 } } });
	conPanel([]);
	const entradaBob = await postForm(env, "/panel/entrar", { email: "bob@x.com", password: "b" });
	const sesionBob = { Cookie: (entradaBob.headers.get("Set-Cookie") || "").split(";")[0] };
	const deBob = await (await get(env, "/panel/datos", sesionBob)).json();
	check("bob no ve las salidas de ana", deBob.total.actividades === 0);

	// El cron recorre a todo el mundo sin que nadie abra el panel
	const env3 = makeEnv();
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	conPanel(actividades.slice(0, 5));
	const e3 = await postForm(env3, "/panel/entrar", { email: "ana@x.com", password: "a" });
	const esperas = [];
	await worker.scheduled({}, env3, { waitUntil: (p) => esperas.push(p) });
	await Promise.all(esperas);
	const trasCron = await (await get(env3, "/panel/datos",
		{ Cookie: (e3.headers.get("Set-Cookie") || "").split(";")[0] })).json();
	check("el cron sincroniza sin que nadie abra el panel", trasCron.total.actividades === 5);

	// Los dos Workers comparten KV y D1: si el segundo cron repitiese lo que
	// acaba de hacer el primero, se le pediria a Garmin todo dos veces.
	let repetidas = 0;
	const contando = globalThis.fetch;
	globalThis.fetch = (url, init) => {
		if (String(url).includes("/activitylist-service/")) repetidas++;
		return contando(url, init);
	};
	const mas = [];
	await worker.scheduled({}, env3, { waitUntil: (p) => mas.push(p) });
	await Promise.all(mas);
	check("el segundo cron no repite lo que ya esta fresco", repetidas === 0, `(${repetidas} llamadas)`);

	globalThis.fetch = realFetch;
}

// ── 11. Ninguna consulta puede olvidarse de a quien pertenece la fila ──
//
// El aislamiento entre usuarios no vive en la base (es una sola), vive en que
// toda consulta filtre por user_id. Un descuido en una sola sentencia lo
// tiraria abajo sin que fallase ningun otro test, asi que se revisa el
// codigo fuente: cualquier SQL que toque datos de personas tiene que
// mencionar user_id.
{
	const fuente = await readFile(new URL("./worker.js", import.meta.url), "utf8");
	const sentencias = [...fuente.matchAll(/prepare\(\s*(["\`'])([\s\S]*?)\1/g)]
		.map((m) => m[2].replace(/\s+/g, " ").trim())
		.filter((q) => /\b(activities|days|sync_state)\b/.test(q) && !/^CREATE/i.test(q));

	check("hay consultas de datos que revisar", sentencias.length >= 3, `(${sentencias.length})`);
	const huerfanas = sentencias.filter((q) => !/user_id/.test(q));
	check("ninguna consulta de datos se olvida del user_id", huerfanas.length === 0, huerfanas.join(" || "));

	// La lectura generica compone el nombre de la tabla, asi que el grep de
	// arriba no la ve: se comprueba aparte porque es por donde pasa el panel.
	check("la lectura generica filtra por usuario",
		/SELECT \* FROM \$\{tabla\} WHERE user_id = \?/.test(fuente));

	// Y las escrituras llevan el user_id en la clave primaria, no solo en el
	// WHERE: dos personas no pueden pisarse una fila.
	check("las claves primarias empiezan por el usuario",
		/PRIMARY KEY \(user_id, activity_id\)/.test(fuente) &&
		/PRIMARY KEY \(user_id, date\)/.test(fuente) &&
		/user_id TEXT PRIMARY KEY/.test(fuente));
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
