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
function mockGarmin(accounts, { mobileLimited = false, portalLimited = false, mobileRaro = false, portalRaro = false } = {}) {
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
			if (portalRaro) return new Response(JSON.stringify({ responseStatus: { type: "CAPTCHA_REQUIRED" } }));
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
			if (mobileRaro) return new Response(JSON.stringify({ responseStatus: { type: "ACCOUNT_LOCKED_X" } }));
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
async function connect(env, email, password, mfaCode, extra = {}) {
	const reg = await (await postJson(env, "/oauth/register", {
		redirect_uris: [REDIRECT], client_name: "Claude",
	})).json();

	const params = {
		client_id: reg.client_id, redirect_uri: REDIRECT, state: "xyz",
		code_challenge: CHALLENGE, code_challenge_method: "S256",
	};

	let res = await postForm(env, "/oauth/authorize", { ...params, email, password, ...extra });

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
	check("authorize valido muestra el login de myCoach", good.status === 200 && (await good.text()).includes("Entra en myCoach"));
	check("la pagina de login no se deja meter en un iframe",
		(good.headers.get("Content-Security-Policy") || "").includes("frame-ancestors 'none'"));
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

// ── 4d-bis. Respuesta desconocida del movil: cae al portal y, si falla, dice que ha contestado Garmin ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } }, { mobileRaro: true });
	const { tokens } = await connect(makeEnv(), "ana@x.com", "a");
	check("respuesta rara del movil -> el portal salva el login", Boolean(tokens.access_token));

	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } },
		{ mobileRaro: true, portalRaro: true });
	const env = makeEnv();
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();
	const res = await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "ana@x.com", password: "a",
	});
	const html = await res.text();
	check("ambos raros -> 502", res.status === 502);
	check("el error dice el tipo que devolvio cada flujo",
		html.includes("ios: ACCOUNT_LOCKED_X") && html.includes("portal: CAPTCHA_REQUIRED"));
}

// ── 4f. Cuentas de myCoach: contrasena propia y Garmin como fuente vinculada ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const auth = (t) => ({ Authorization: `Bearer ${t}` });
	const cuenta = async (t) => (await get(env, "/cuenta", auth(t))).json();
	const entrar = (email, password) => connect(env, email, password, null, { modo: "entrar" });
	const intentar = async (modo, email, password) => {
		const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();
		return postForm(env, "/oauth/authorize", {
			client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
			code_challenge_method: "S256", email, password, modo,
		});
	};

	// Ana ya usaba el conector entrando con Garmin.
	const { tokens: viejo } = await connect(env, "ana@x.com", "a");
	const sinPass = await intentar("entrar", "ana@x.com", "loquesea");
	check("sin contrasena de myCoach, entrar lo explica",
		sinPass.status === 401 && (await sinPass.text()).includes("Aún no tienes contraseña"));
	const antes = await cuenta(viejo.access_token);
	check("la cuenta dice que tiene Garmin y no contrasena", antes.contrasena === false && antes.garmin.vinculado === true);

	const corta = await postJson(env, "/cuenta/contrasena", { nueva: "corta" }, auth(viejo.access_token));
	check("contrasena de menos de 8 -> 400", corta.status === 400);
	const crea = await postJson(env, "/cuenta/contrasena", { nueva: "supersecreta" }, auth(viejo.access_token));
	check("con la sesion abierta se crea la contrasena", crea.status === 200);

	const { tokens: nuevo } = await entrar("Ana@X.com ", "supersecreta");
	const c = await cuenta(nuevo.access_token);
	check("entrar con myCoach da la misma cuenta, con su Garmin", c.contrasena === true && c.garmin.vinculado === true);
	const hrv = await rpc(env, nuevo.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "garmin_dia", arguments: { partes: ["vfc"] } } });
	check("y las herramientas de Garmin siguen funcionando", !hrv.body.result.isError);

	const mala = await intentar("entrar", "ana@x.com", "otracosa1");
	check("contrasena mala -> 401", mala.status === 401 && (await mala.text()).includes("incorrectos"));
	const cambio = await postJson(env, "/cuenta/contrasena", { nueva: "otraclave99" }, auth(nuevo.access_token));
	check("cambiarla sin la actual -> 401", cambio.status === 401);
	const cambioOk = await postJson(env, "/cuenta/contrasena", { nueva: "otraclave99", actual: "supersecreta" }, auth(nuevo.access_token));
	check("cambiarla con la actual -> 200", cambioOk.status === 200);

	const repetida = await intentar("crear", "ana@x.com", "cualquiera1");
	check("crear con un email que ya existe -> 409", repetida.status === 409);

	// Bea empieza en myCoach sin Garmin y lo vincula despues.
	const { tokens: bea } = await connect(env, "bea@x.com", "clavedebea", null, { modo: "crear" });
	check("una cuenta nueva empieza sin Garmin", (await cuenta(bea.access_token)).garmin.vinculado === false);
	const sinG = await rpc(env, bea.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "garmin_dia", arguments: { partes: ["vfc"] } } });
	check("sin Garmin, la herramienta dice donde vincularlo",
		sinG.body.result.isError && sinG.body.result.content[0].text.includes("Ajustes, Conexiones"));
	const malG = await postJson(env, "/cuenta/garmin", { email: "ana@x.com", password: "mal" }, auth(bea.access_token));
	check("vincular Garmin con la contrasena mala -> 401", malG.status === 401);
	const okG = await postJson(env, "/cuenta/garmin", { email: "ana@x.com", password: "a" }, auth(bea.access_token));
	check("vincular Garmin -> ok", okG.status === 200 && (await cuenta(bea.access_token)).garmin.vinculado === true);
	const fuera = await worker.fetch(new Request(`${ORIGIN}/cuenta/garmin`, { method: "DELETE", headers: auth(bea.access_token) }), env);
	check("desvincular Garmin", fuera.status === 200 && (await cuenta(bea.access_token)).garmin.vinculado === false);

	check("sin Bearer, /cuenta -> 401", (await get(env, "/cuenta")).status === 401);
	const reg = await (await postJson(env, "/oauth/register", { redirect_uris: [REDIRECT] })).json();
	const conCodigo = await postForm(env, "/oauth/authorize", {
		client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
		code_challenge_method: "S256", email: "bea@x.com", password: "clavedebea", modo: "entrar",
	});
	const codigo = new URL(conCodigo.headers.get("Location")).searchParams.get("code");
	check("un codigo de autorizacion no vale como Bearer", (await get(env, "/cuenta", auth(codigo))).status === 401);

	for (let i = 0; i < 10; i++) await intentar("entrar", "bea@x.com", "noesesta1");
	const bloqueo = await intentar("entrar", "bea@x.com", "clavedebea");
	check("tras 10 fallos se bloquea un rato, aunque luego acierte", bloqueo.status === 429);
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

	// Conector añadido sin el /mcp (o con la barra final): tambien funciona
	const raizAnon = await postJson(env, "/", { jsonrpc: "2.0", id: 1, method: "initialize" });
	check("en la raiz, sin token -> 401 que dice donde autenticarse",
		raizAnon.status === 401 && (raizAnon.headers.get("WWW-Authenticate") || "").includes("oauth-protected-resource"));
	const raiz = await postJson(env, "/", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { Authorization: `Bearer ${tokens.access_token}` });
	check("en la raiz, con token, contesta como /mcp", (await raiz.json()).result?.serverInfo?.name === "garmin");
	const barra = await postJson(env, "/mcp/", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { Authorization: `Bearer ${tokens.access_token}` });
	check("/mcp/ con barra final tambien", (await barra.json()).result?.tools?.length > 0);
	check("un navegador en la raiz sigue viendo la pagina", (await (await get(env, "/")).text()).includes("<h1>"));

	const list = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	check("tools/list devuelve 47 herramientas", list.body.result.tools.length === 47);
	check("app_guardar se anuncia como escritura", anot0(list).app_guardar.readOnlyHint === false);
	{
		const call = (name, args) => rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
		await call("app_guardar", { doc: "estado/app", datos: { plan: { "2026-09-28": { dep: "bici", t: "fondo", d: "Suave", min: 60 } } } });
		await call("app_guardar", { doc: "estado/app", datos: { nombre: "A" }, fusionar: true });
		const leido = JSON.parse((await call("app_leer", { doc: "estado/app" })).body.result.content[0].text);
		check("myCoach: guardar, fusionar y leer", leido.nombre === "A" && leido.plan["2026-09-28"].dep === "bici");
		const malo = await call("app_leer", { doc: "../user:x" });
		check("myCoach: rutas de documento no validas se rechazan", malo.body.result.isError === true);

		// Lo que paso de verdad: Claude subio el plan con sus propios nombres de campo.
		const txt = (r) => r.body.result.content[0].text;
		const subido = JSON.parse(txt(await call("app_guardar", { doc: "estado/app", fusionar: true, datos: { sports: ["bici"], plan: {
			"2026-09-28": { tipo: "descanso", titulo: "Descanso", detalle: "Hecho" },
			"2026-09-29": { tipo: "fuerza", titulo: "Fuerza cuerpo completo", detalle: "suave", duracion_min: 45 },
			"2026-09-30": { tipo: "Z2", titulo: "Bici Z2", detalle: "60 min en Z2", duracion_min: 60, fc_max: 140 },
			"2026-10-02": { tipo: "Z2", titulo: "Salida larga", detalle: "2 h en zona 2", duracion_min: 120 },
		} } })));
		const plan = JSON.parse(txt(await call("app_leer", { doc: "estado/app" }))).plan;
		check("un plan con otros nombres de campo se traduce al formato de la app", subido.sesiones_normalizadas === 4 &&
			plan["2026-09-28"].t === "descanso" && plan["2026-09-29"].dep === "fuerza" && plan["2026-09-29"].t === "otros" && plan["2026-09-29"].min === 45 &&
			plan["2026-09-30"].dep === "bici" && plan["2026-09-30"].t === "fondo" && plan["2026-09-30"].min === 60 && plan["2026-09-30"].fc_max === 140,
			JSON.stringify(plan));
		check("sin deporte, usa el deporte principal del usuario", plan["2026-10-02"].dep === "bici" && plan["2026-10-02"].t === "fondo" && plan["2026-10-02"].d.includes("2 h"));
		const raro = await call("app_guardar", { doc: "estado/app", datos: { plan: { "2026-10-01": { cosa: 1 } } } });
		check("lo que no se entiende se rechaza explicando el formato", raro.body.result.isError === true && txt(raro).includes("coach_proponer"));

		// La web no puede pisar lo que ha escrito Claude despues de que ella leyera.
		const leida = JSON.parse(txt(await call("app_leer", { doc: "estado/app" })));
		const vieja = leida.at - 1000;
		const pisar = JSON.parse(txt(await call("app_guardar", { doc: "estado/app", version: vieja, datos: { plan: {}, sports: ["bici"] } })));
		check("con una version vieja no se guarda: conflicto", pisar.ok === false && pisar.conflicto === true && pisar.at === leida.at);
		check("y el plan sigue ahi", Object.keys(JSON.parse(txt(await call("app_leer", { doc: "estado/app" }))).plan).length === 4);
		const buena = JSON.parse(txt(await call("app_guardar", { doc: "estado/app", version: leida.at, fusionar: true, datos: { nombre: "B" } })));
		check("con la version al dia se guarda y devuelve la nueva", buena.ok === true && typeof buena.at === "number");
	}
	// Solo garmin_save_course escribe; anunciarlas todas como de solo
	// lectura invitaba al cliente a llamarla sin preguntar.
	const anot = Object.fromEntries(list.body.result.tools.map((t) => [t.name, t.annotations]));
	check("las lecturas se anuncian como tales", anot.garmin_courses.readOnlyHint === true);
	check("la subida no se anuncia como lectura", anot.garmin_save_course.readOnlyHint === false);
}

// ── 8b quater. Todas las metricas: carrera con stamina, cadencia y dinamicas ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	const call = async (name, args) => JSON.parse((await rpc(env, tokens.access_token, {
		jsonrpc: "2.0", id: 12, method: "tools/call", params: { name, arguments: args } })).body.result.content[0].text);

	// 10 km a 12 km/h (3,33 m/s), una muestra cada 100 m. La stamina baja de 100 a 60.
	const filas = [];
	for (let i = 1; i <= 100; i++) {
		filas.push({ metrics: [i * 100, i * 30, 3.333, 150 + (i > 50 ? 8 : 0), 170, 100 - i * 0.4, 88 - i * 0.2, 1234567, 41.4, 2.1] });
	}
	const details = {
		metricDescriptors: [
			{ key: "sumDistance", metricsIndex: 0 }, { key: "sumDuration", metricsIndex: 1 }, { key: "directSpeed", metricsIndex: 2 },
			{ key: "directHeartRate", metricsIndex: 3 }, { key: "directRunCadence", metricsIndex: 4 },
			{ key: "directAvailableStamina", metricsIndex: 5 }, { key: "directPotentialStamina", metricsIndex: 6 },
			{ key: "directTimestamp", metricsIndex: 7 }, { key: "directLatitude", metricsIndex: 8 }, { key: "directMisterio", metricsIndex: 9 },
		],
		activityDetailMetrics: filas,
	};
	const summaryDTO = {
		distance: 10000, duration: 3000, movingDuration: 3000, averageSpeed: 3.333, averageMovingSpeed: 3.333, maxSpeed: 4.2,
		averageHR: 154, maxHR: 171, averageRunCadence: 170, strideLength: 118, groundContactTime: 245, verticalOscillation: 8.4,
		verticalRatio: 7.1, elevationGain: 80, beginPotentialStamina: 100, endPotentialStamina: 70, minAvailableStamina: 60,
		trainingEffect: 3.4, algoNuevoDeGarmin: 12.345, startLatitude: 41.4,
	};
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		if (u.pathname.endsWith("/details")) return new Response(JSON.stringify(details));
		if (u.pathname.endsWith("/hrTimeInZones")) return new Response("[]");
		if (u.pathname.startsWith("/activity-service/activity/"))
			return new Response(JSON.stringify({ activityName: "Rodaje", activityTypeDTO: { typeKey: "running" }, summaryDTO }));
		if (u.pathname === "/userprofile-service/socialProfile") return new Response(JSON.stringify({ displayName: "ana" }));
		return new Response("{}", { status: 404 });
	};
	const r = await call("garmin_activity_detail", { activity_id: "9" });
	const m = r.metricas;
	check("velocidad media y maxima en km/h", m.velocidad_media_kmh === 12 && m.velocidad_max_kmh === 15.1, JSON.stringify(m));
	check("en carrera, ritmo por km", m.ritmo_medio === "5:00 /km" && m.ritmo_max === "3:58 /km", `${m.ritmo_medio} ${m.ritmo_max}`);
	check("cadencia, zancada, contacto y oscilacion", m.cadencia_media_pasos === 170 && m.zancada_cm === 118 && m.contacto_suelo_ms === 245 && m.oscilacion_vertical_cm === 8.4);
	check("stamina del resumen", m.stamina_potencial_inicio_pct === 100 && m.stamina_potencial_final_pct === 70 && m.stamina_disponible_min_pct === 60);
	check("eficiencia: metros por latido", m.metros_por_latido === 1.3, String(m.metros_por_latido));
	check("lo que no se reconoce no se pierde", m.otros_campos_garmin?.algoNuevoDeGarmin === 12.35 && !("startLatitude" in m.otros_campos_garmin));
	const serie = Object.fromEntries(r.series.map((x) => [x.clave, x]));
	check("cada serie con nombre, unidad y min/media/max", serie.directSpeed?.nombre === "Velocidad" && serie.directSpeed.media === 12 && serie.directSpeed.unidad === "km/h");
	check("la stamina como serie: empieza y acaba", serie.directAvailableStamina?.inicio === 99.6 && serie.directAvailableStamina.final === 60);
	check("posicion y tiempo no son series", !serie.directLatitude && !serie.directTimestamp && !serie.sumDistance);
	check("una serie desconocida sale con su clave", serie.directMisterio?.nombre === "directMisterio");
	check("perfil de 24 tramos por km con la stamina", r.perfil?.eje === "km" && r.perfil.puntos.length === 24 &&
		r.perfil.columnas.includes("Stamina disponible (%)") && r.perfil.puntos.at(-1)[0] === 10, JSON.stringify(r.perfil?.columnas));
	const iSt = r.perfil.columnas.indexOf("Stamina disponible (%)") + 1;
	check("la stamina baja a lo largo del perfil", r.perfil.puntos[0][iSt] > r.perfil.puntos.at(-1)[iSt]);
	check("el analisis de siempre sigue", r.analisis?.muestras === 100);
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
			params: { name: "garmin_dia", arguments: { date: "2026-09-20", partes: ["vfc"] } },
		});
		return JSON.parse(r.body.result.content[0].text);
	};

	check("ana ve su HRV", (await read(ana.tokens.access_token)).vfc?.media_noche === 50);
	check("bob ve su HRV", (await read(bob.tokens.access_token)).vfc?.media_noche === 99);

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

	const detalle = await call("garmin_courses", { course_id: "517620552", puntos: 12 });
	check("lee un recorrido concreto", detalle.name === "Cerdanya: bucle solana");
	check("reduce el trazado a los puntos pedidos", detalle.waypoints.length === 12);
	check("el primer punto es el inicio", detalle.waypoints[0] === "42.3700,1.7600");
	check("el ultimo punto es el final", detalle.waypoints.at(-1) ===
		`${puntos.at(-1).latitude.toFixed(4)},${puntos.at(-1).longitude.toFixed(4)}`);
	check("los puntos van como lat,lon", detalle.waypoints.every((p) => /^4\d\.\d{4},\d\.\d{4}$/.test(p)));

	// Un recorrido sin trazado no debe reventar: se dice y ya.
	globalThis.fetch = async () => new Response(JSON.stringify({ courseId: 5, courseName: "Sin linea" }));
	const vacio = await call("garmin_courses", { course_id: "5" });
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
	const baj = r.analisis?.bajadas || [];
	check("detecta la bajada", baj.length === 1 && Math.abs(baj[0].desnivel_m - 180) <= 15, `(${JSON.stringify(baj)})`);
	check("mide la velocidad de bajada", Math.abs(baj[0]?.vel_media_kmh - 40) <= 3, `(${baj[0]?.vel_media_kmh})`);
	const ter = r.analisis?.por_terreno || {};
	check("por terreno: llano a 30 km/h", ter.llano?.km >= 40 && Math.abs(ter.llano.vel_media_kmh - 30) < 1, `(${JSON.stringify(ter.llano)})`);
	check("por terreno: metros por latido en llano", ter.llano?.metros_por_latido > 3.4 && ter.llano.metros_por_latido < 3.9, `(${ter.llano?.metros_por_latido})`);
	check("por terreno: subida a 15 km/h y su VAM", ter.subida && Math.abs(ter.subida.vel_media_kmh - 15) < 1.5 && Math.abs(ter.subida.vam_m_h - 900) <= 120,
		`(${JSON.stringify(ter.subida)})`);
	check("por terreno: el pulso de la subida", ter.subida?.fc_media >= 150 && ter.subida.fc_media <= 160, `(${ter.subida?.fc_media})`);
	const pp = ter.por_pendiente || [];
	const enBin = (x) => pp.find((b) => b.pendiente_pct === x);
	check("por pendiente: 30 km/h en el 0 %, 15 en el 6 % y 40 en el −6 %", Math.abs(enBin(0)?.vel_media_kmh - 30) < 1 && Math.abs(enBin(6)?.vel_media_kmh - 15) < 1.5 && Math.abs(enBin(-6)?.vel_media_kmh - 40) < 3,
		`(${JSON.stringify(pp)})`);
	check("por terreno: bajada a 40 km/h, sin pulso", ter.bajada && Math.abs(ter.bajada.vel_media_kmh - 40) < 3 && ter.bajada.fc_media === undefined,
		`(${JSON.stringify(ter.bajada)})`);
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
	check("en llano no hay subida ni bajada por terreno", plana.analisis?.por_terreno?.subida === null && plana.analisis?.por_terreno?.bajada === null);
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
		params: { name: "garmin_forma", arguments: { date: "2026-09-25" } } });
	const pg = JSON.parse(res.body.result.content[0].text);
	check("sitúa el Endurance Score en su nivel", pg.endurance_score?.nivel === "Entrenado" && pg.endurance_score.actual === 6319, `(${pg.endurance_score?.nivel})`);
	check("dice cuánto falta para el siguiente nivel", pg.endurance_score?.siguiente?.nivel === "Muy entrenado" && pg.endurance_score.siguiente.desde === 6600);
	check("interpreta el enfoque de carga (Load Focus)", pg.enfoque_carga?.anaerobica?.carga === 796 &&
		pg.enfoque_carga.anaerobica.objetivo[1] === 327 && pg.enfoque_carga.veredicto === "Por encima de los objetivos");
	check("calcula la edad y lee el umbral de lactato", pg.persona.edad === 36 && pg.persona.umbral_lactato_ppm === 171 && pg.persona.peso_kg === 72);
}

// ── 8b quater bis. Forma y tendencia (garmin_forma) ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	const base = globalThis.fetch;
	const pedidas = [];
	// Formas reales de las respuestas de Garmin (recortadas).
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.hostname !== "connectapi.garmin.com") return base(url, init);
		pedidas.push(u.pathname + u.search);
		const r = (x) => new Response(JSON.stringify(x));
		if (u.pathname.includes("socialProfile")) return r({ displayName: "ana" });
		if (u.pathname.includes("trainingstatus")) return r({
			mostRecentVO2Max: { generic: { calendarDate: "2026-09-20", vo2MaxPreciseValue: 52.6 },
				heatAltitudeAcclimation: { heatAcclimationPercentage: 40, altitudeAcclimation: 0, currentAltitude: 300 } },
			mostRecentTrainingStatus: { latestTrainingStatusData: {
				"111": { calendarDate: "2026-09-24", trainingStatusFeedbackPhrase: "UNPRODUCTIVE_2", primaryTrainingDevice: false },
				"222": { calendarDate: "2026-09-25", trainingStatusFeedbackPhrase: "PRODUCTIVE_3", primaryTrainingDevice: true, fitnessTrend: 1,
					weeklyTrainingLoad: 640, loadTunnelMin: 420, loadTunnelMax: 780,
					acuteTrainingLoadDTO: { dailyTrainingLoadAcute: 690, dailyTrainingLoadChronic: 560, minTrainingLoadChronic: 450,
						maxTrainingLoadChronic: 840, dailyAcuteChronicWorkloadRatio: 1.2, acwrStatus: "OPTIMAL" } } } },
			mostRecentTrainingLoadBalance: { metricsTrainingLoadBalanceDTOMap: { "222": { monthlyLoadAerobicLow: 553.8, monthlyLoadAerobicHigh: 989.4,
				monthlyLoadAnaerobic: 100, monthlyLoadAerobicLowTargetMin: 253, monthlyLoadAerobicLowTargetMax: 580, monthlyLoadAerobicHighTargetMin: 347,
				monthlyLoadAerobicHighTargetMax: 674, monthlyLoadAnaerobicTargetMin: 109, monthlyLoadAnaerobicTargetMax: 327, trainingBalanceFeedbackPhrase: "ANAEROBIC_SHORTAGE" } } } });
		if (u.pathname.includes("maxmet")) return r([
			{ generic: { calendarDate: "2026-09-02", vo2MaxPreciseValue: 51.8 }, cycling: { calendarDate: "2026-09-02", vo2MaxPreciseValue: 55.0 } },
			{ generic: { calendarDate: "2026-09-04", vo2MaxPreciseValue: 52.0 }, cycling: null },
			{ generic: { calendarDate: "2026-09-20", vo2MaxPreciseValue: 52.6 }, cycling: null },
		]);
		if (u.pathname.endsWith("/endurancescore/stats")) return r({ groupMap: {
			"2026-09-14": { groupAverage: 6250.4, groupMax: 6300 }, "2026-09-21": { groupAverage: 6319, groupMax: 6330 } } });
		if (u.pathname.endsWith("/hillscore/stats")) return r({ hillScoreDTOList: [
			{ calendarDate: "2026-09-15", overallScore: 60, strengthScore: 55, enduranceScore: 65 },
			{ calendarDate: "2026-09-16", overallScore: 61, strengthScore: 55, enduranceScore: 66 },
			{ calendarDate: "2026-09-23", overallScore: 63, strengthScore: 57, enduranceScore: 68 }] });
		if (u.pathname.includes("racepredictions")) return r({ calendarDate: "2026-09-25", time5K: 1230, time10K: 2580, timeHalfMarathon: 5750, timeMarathon: 12300 });
		if (u.pathname.includes("latestLactateThreshold")) return r([
			{ calendarDate: "2026-08-01T10:00:00.0", heartRate: 171, speed: null }, { calendarDate: "2026-08-01T10:00:00.0", heartRate: null, speed: 0.34 }]);
		if (u.pathname.includes("FunctionalThresholdPower")) return new Response("{}", { status: 404 });
		if (u.pathname.includes("fitnessage")) return r({ chronologicalAge: 36, fitnessAge: 29.43, achievableFitnessAge: 27.1 });
		if (u.pathname.includes("user-settings")) return r({ userData: { weight: 72000 } });
		if (u.pathname.includes("search/activities")) return r([
			{ startTimeLocal: "2026-09-16 08:00:00", activityTrainingLoad: 95.4, activityType: { typeKey: "running" } },
			{ startTimeLocal: "2026-09-22 08:00:00", activityTrainingLoad: 150.2, activityType: { typeKey: "cycling" } },
			{ startTimeLocal: "2026-09-24 08:00:00", activityTrainingLoad: 79.8, activityType: { typeKey: "running" } },
			{ startTimeLocal: "2026-09-25 08:00:00", activityTrainingLoad: null, activityType: { typeKey: "yoga" } }]);
		return new Response("{}", { status: 404 });
	};
	const res = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 14, method: "tools/call",
		params: { name: "garmin_forma", arguments: { date: "2026-09-25", semanas: 4 } } });
	const f = JSON.parse(res.body.result.content[0].text);
	check("forma: periodo de 4 semanas hasta el día pedido", f.desde === "2026-08-29" && f.hasta === "2026-09-25", `(${f.desde} → ${f.hasta})`);
	check("forma: VO2máx pedido como rango", pedidas.some((p) => p.includes("/maxmet/daily/2026-08-29/2026-09-25")));
	check("forma: estado del reloj principal, traducido", f.estado?.estado === "Productivo" && f.estado.codigo_garmin === "PRODUCTIVE_3", JSON.stringify(f.estado));
	check("forma: carga aguda y crónica con su franja y ratio", f.carga?.aguda_7d === 690 && f.carga.cronica_28d === 560 &&
		f.carga.franja_optima_cronica[1] === 840 && f.carga.ratio_estado === "Óptima" && f.carga.franja_semana[0] === 420, JSON.stringify(f.carga));
	check("forma: enfoque de carga (Load Focus) traducido", f.enfoque_carga?.veredicto === "Falta anaeróbico" && f.enfoque_carga.anaerobica.carga === 100);
	check("forma: Exercise Load sumada por semana y deporte", f.carga_por_semana?.length === 2 && f.carga_por_semana[1].carga === 230 &&
		f.carga_por_semana[1].por_deporte.cycling === 150 && f.carga_por_semana[0].actividades === 1, JSON.stringify(f.carga_por_semana));
	check("forma: aclimatación al calor", f.aclimatacion?.calor_pct === 40);
	check("forma: VO2máx semana a semana (correr y bici)", f.vo2max?.correr === 52.6 && f.vo2max.bici === 55 &&
		f.vo2max.semanas.length === 2 && f.vo2max.tendencia_correr?.cambio === 0.6, JSON.stringify(f.vo2max));
	check("forma: Endurance Score por semanas", f.endurance_score?.actual === 6319 && f.endurance_score.tendencia.cambio === 69, JSON.stringify(f.endurance_score));
	check("forma: Hill Score, un punto por semana", f.hill_score?.semanas.length === 2 && f.hill_score.actual === 63, JSON.stringify(f.hill_score));
	check("forma: predicciones de carrera en h:mm:ss", f.predicciones_carrera?.["5k"] === "20:30" && f.predicciones_carrera.maraton === "3:25:00", JSON.stringify(f.predicciones_carrera));
	check("forma: umbral de lactato con ritmo", f.umbral_lactato?.ppm === 171 && f.umbral_lactato.ritmo_min_km === "4:54", JSON.stringify(f.umbral_lactato));
	check("forma: edad física", f.edad_fisica?.edad_fisica === 29.4 && f.edad_fisica.edad_real === 36);
	check("forma: sin potenciómetro no hay FTP, y se dice", f.ftp === null && f.sin_datos?.includes("FTP"), JSON.stringify(f.sin_datos));

	// Si Garmin no contesta nada, la herramienta no se cae: dice qué falta.
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.hostname !== "connectapi.garmin.com") return base(url, init);
		return new Response("x", { status: 500 });
	};
	const vacio = JSON.parse((await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 15, method: "tools/call",
		params: { name: "garmin_forma", arguments: {} } })).body.result.content[0].text);
	check("forma: sin datos de Garmin no falla", vacio.vo2max === null && vacio.estado === null && vacio.sin_datos?.length >= 7, JSON.stringify(vacio).slice(0, 200));
	globalThis.fetch = base;
}

// ── 8b quater ter. Garmin a pelo (garmin_api) ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	const base = globalThis.fetch;
	const pedidas = [];
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.hostname !== "connectapi.garmin.com") return base(url, init);
		pedidas.push({ path: u.pathname, search: u.search, method: init?.method || "GET" });
		const r = (x) => new Response(JSON.stringify(x));
		if (u.pathname.includes("socialProfile")) return r({ displayName: "ana", profileId: 777 });
		if (u.pathname.includes("trainingloadbalance")) return r({ metricsTrainingLoadBalanceDTOMap: { "1": { monthlyLoadAnaerobic: 80 } } });
		if (u.pathname.includes("racepredictions/latest/ana")) return r({ time5K: 1230 });
		if (u.pathname.includes("filterGear")) return r([{ userProfilePk: 777, displayName: "Zapas" }]);
		if (u.pathname.includes("fitnessstats-service")) return r([{ activityTrainingLoad: 80 }]);
		if (u.pathname.includes("dailySleepData")) return r({ grande: "x".repeat(70000), dailySleepDTO: { sleepScores: { overall: { value: 81 } } } });
		if (u.pathname.includes("hrv-service")) return new Response(null, { status: 204 });
		return new Response("{}", { status: 404 });
	};
	const llamar = async (args) => {
		const res = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "garmin_api", arguments: args } });
		const c = res.body.result?.content?.[0]?.text;
		return { error: res.body.result?.isError || !!res.body.error, out: c ? (() => { try { return JSON.parse(c); } catch { return c; } })() : res.body.error };
	};
	const lista = await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 17, method: "tools/list" });
	const ann = anot0(lista).garmin_api;
	check("garmin_api: solo lectura", ann?.readOnlyHint === true);

	const cat = (await llamar({})).out;
	check("garmin_api: sin path da el catálogo por grupos", cat.grupos?.forma?.length > 5 && cat.grupos.dia.some((e) => e.path.includes("dailyStress")));
	check("garmin_api: el catálogo filtra por grupo", Object.keys((await llamar({ grupo: "umbrales" })).out.grupos).join() === "umbrales");

	const lb = (await llamar({ path: "/metrics-service/metrics/trainingloadbalance/latest/2026-10-04" })).out;
	check("garmin_api: devuelve el JSON de Garmin tal cual", lb.datos?.metricsTrainingLoadBalanceDTOMap?.["1"]?.monthlyLoadAnaerobic === 80, JSON.stringify(lb));
	check("garmin_api: hace GET", pedidas.at(-1).method === "GET");

	const rp = (await llamar({ path: "/metrics-service/metrics/racepredictions/latest/{usuario}" })).out;
	check("garmin_api: rellena {usuario}", rp.datos?.time5K === 1230 && rp.path.endsWith("/latest/ana"), JSON.stringify(rp));
	const gear = (await llamar({ path: "/gear-service/gear/filterGear", params: { userProfilePk: "{perfil}" } })).out;
	check("garmin_api: rellena {perfil} en los parámetros", gear.datos?.[0]?.displayName === "Zapas" && pedidas.at(-1).search === "?userProfilePk=777", pedidas.at(-1).search);

	await llamar({ path: "/fitnessstats-service/activity/all", params: { startDate: "2026-09-01", metric: ["activityTrainingLoad", "trainingEffectLabel"] } });
	check("garmin_api: una lista en params repite la clave", pedidas.at(-1).search === "?startDate=2026-09-01&metric=activityTrainingLoad&metric=trainingEffectLabel", pedidas.at(-1).search);
	await llamar({ path: "https://connectapi.garmin.com/hrv-service/hrv/2026-10-01?x=1" });
	check("garmin_api: acepta la URL entera con la consulta pegada", pedidas.at(-1).path === "/hrv-service/hrv/2026-10-01" && pedidas.at(-1).search === "?x=1");

	const vacio = (await llamar({ path: "/hrv-service/hrv/2026-10-01" })).out;
	check("garmin_api: 204 sin cuerpo es 'sin datos', no un error", vacio.datos === null && /no tiene datos/.test(vacio.nota), JSON.stringify(vacio));

	const grande = (await llamar({ path: "/wellness-service/wellness/dailySleepData/{usuario}", params: { date: "2026-10-01" } })).out;
	check("garmin_api: una respuesta grande no se corta a ciegas", grande.datos?.dailySleepDTO && !grande.datos.grande && /caracteres/.test(grande.campos_grandes?.grande), JSON.stringify(grande).slice(0, 200));
	const campos = (await llamar({ path: "/wellness-service/wellness/dailySleepData/{usuario}", params: { date: "2026-10-01" }, campos: ["dailySleepDTO.sleepScores.overall.value"] })).out;
	check("garmin_api: campos saca solo lo pedido", campos.datos?.["dailySleepDTO.sleepScores.overall.value"] === 81, JSON.stringify(campos));

	const antes = pedidas.length;
	const malas = await Promise.all([
		llamar({ path: "/di-oauth2-service/oauth/token" }),
		llamar({ path: "/download-service/files/activity/1" }),
		llamar({ path: "/metrics-service/../di-oauth2-service/x" }),
		llamar({ path: "https://otro.example.com/robar" }),
		llamar({ path: "/metrics-service/metrics/trainingstatus/aggregated/{fecha}" }),
	]);
	check("garmin_api: no toca login, descargas, rutas raras ni plantillas sin rellenar", malas.every((m) => m.error) && pedidas.length === antes,
		JSON.stringify(malas.map((m) => m.error)));
	const no = await llamar({ path: "/nada-service/x" });
	check("garmin_api: un 404 remite al catálogo", no.error && /catalogo/.test(JSON.stringify(no.out)), JSON.stringify(no.out));
	globalThis.fetch = base;
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
	check("las herramientas se listan igualmente", list.body.result.tools.length === 47);

	// Y el dato que si vive en KV avisa en vez de mentir
	const call = await rpc(env, tokens.access_token, {
		jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "garmin_dia", arguments: { partes: ["vfc"] } },
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
		params: { name: "garmin_dia", arguments: { date: "2026-09-20", partes: ["vfc"] } },
	});
	check("401 de Garmin dispara renovacion", refreshed);
	check("tras renovar, devuelve datos", JSON.parse(r.body.result.content[0].text).vfc?.media_noche === 77);
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

// ── 12. Entrenador: el motor decide, quien habla solo explica ──
{
	const fechaMadrid = (d = new Date()) =>
		new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
	const HOY_C = fechaMadrid();
	const mas = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
	const lunes = (() => { const d = new Date(`${HOY_C}T12:00:00Z`); return mas(HOY_C, -((d.getUTCDay() + 6) % 7)); })();
	const proxLunes = mas(lunes, 7);

	// Lo que cuenta Garmin esta manana; cada escenario lo cambia.
	const manana = { readiness: 80, sueno_h: 7.5, hrv: 50 };
	const salidas = Array.from({ length: 30 }, (_, i) => ({
		activityId: 9000 + i,
		activityName: `Salida ${i}`,
		activityType: { typeKey: i % 3 ? "cycling" : "running" },
		startTimeLocal: `${mas(HOY_C, -(i * 2 + 1))} 09:00:00`,
		duration: 3600, movingDuration: 3500, distance: 30000, averageHR: 135, maxHR: 170,
		aerobicTrainingEffect: 3, anaerobicTrainingEffect: 0.5,
	}));

	mockGarmin({
		"ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } },
		"bob@x.com": { password: "b", data: { displayName: "bob", hrv: 60 } },
	});
	const abajo = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		const quien = (init?.headers?.Authorization || "").replace("Bearer TOK-", "");
		if (quien && u.pathname.includes("/activitylist-service/")) {
			const desde = Number(u.searchParams.get("start"));
			return new Response(JSON.stringify(quien === "ana" ? salidas.slice(desde, desde + 100) : []));
		}
		if (quien && u.pathname.includes("/usersummary-service/"))
			return new Response(JSON.stringify({ restingHeartRate: 48, sleepingSeconds: 7.4 * 3600 }));
		if (quien && u.pathname.includes("/wellness-service/wellness/dailySleepData/")) {
			const d = u.searchParams.get("date");
			const h = d === HOY_C ? manana.sueno_h : 7.4;
			return new Response(JSON.stringify({ dailySleepDTO: { sleepTimeSeconds: h * 3600, sleepScores: { overall: { value: 80 } } }, restingHeartRate: 48 }));
		}
		if (quien && u.pathname.startsWith("/hrv-service/hrv/")) {
			const d = u.pathname.split("/").at(-1);
			return new Response(JSON.stringify({ hrvSummary: { lastNightAvg: d === HOY_C ? manana.hrv : 50, status: "BALANCED" } }));
		}
		if (quien && u.pathname.includes("/metrics-service/metrics/trainingreadiness/"))
			return new Response(JSON.stringify([{ score: manana.readiness }]));
		return abajo(url, init);
	};

	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const bob = (await connect(env, "bob@x.com", "b")).tokens.access_token;
	const llamar = async (token, name, args = {}) => {
		const r = await rpc(env, token, { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name, arguments: args } });
		const res = r.body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};

	const init = await rpc(env, ana, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	check("las instrucciones del conector traen el metodo del entrenador",
		init.body.result.instructions.includes("Eres myCoach") && init.body.result.instructions.includes("coach_proponer"));
	const lista = await rpc(env, ana, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	const an = anot0(lista);
	check("coach_hoy y coach_semana se anuncian como lectura", an.coach_hoy.readOnlyHint && an.coach_semana.readOnlyHint && an.coach_perfil.readOnlyHint);
	check("cambiar el plan, el perfil o el diario se anuncia como escritura",
		an.coach_proponer.readOnlyHint === false && an.coach_perfil_guardar.readOnlyHint === false && an.coach_anotar.readOnlyHint === false);

	// Plan de la app: hoy toca series.
	const semanaActual = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [mas(lunes, i), { dep: "bici", t: "fondo", d: "Suave", min: 60 }]));
	semanaActual[HOY_C] = { dep: "bici", t: "int", d: "Series 5 x 4 min", min: 60 };
	await llamar(ana, "app_guardar", { doc: "estado/app", datos: { plan: semanaActual, goal: { modo: "forma" }, sports: ["bici", "correr"] } });

	// Verde
	const verde = await llamar(ana, "coach_hoy");
	check("semaforo verde con buenos datos", verde.semaforo?.color === "verde", JSON.stringify(verde.semaforo));
	check("en verde se mantiene la sesion", verde.propuesta === null && verde.sesion_prevista?.t === "int");
	check("el mensaje en verde dice que toca y por que", verde.mensaje.startsWith("🟢") && verde.mensaje.includes("Series"), verde.mensaje);
	check("la linea base sale del historico de D1", verde.linea_base_28d.hrv === 50 && verde.linea_base_28d.dias >= 10, JSON.stringify(verde.linea_base_28d));
	check("hay forma, fatiga y frescura", typeof verde.forma?.forma_ctl === "number" && typeof verde.forma?.frescura_tsb === "number");
	check("coach_hoy deja el semaforo guardado para la web",
		JSON.parse(env._store.get([...env._store.keys()].find((k) => k.endsWith(":coach/hoy")))).semaforo.color === "verde");

	// Ambar: poco sueno y VFC algo baja
	Object.assign(manana, { sueno_h: 5.5, hrv: 43 });
	const ambar = await llamar(ana, "coach_hoy");
	check("semaforo ambar con dos senales leves", ambar.semaforo.color === "ambar", JSON.stringify(ambar.semaforo));
	check("en ambar las series pasan a suave y mas cortas",
		ambar.propuesta?.accion === "cambiar" && ambar.propuesta.sesion.t === "fondo" && ambar.propuesta.sesion.min === 45, JSON.stringify(ambar.propuesta));
	check("si las mueve, es a otro dia de esta semana",
		ambar.propuesta.mover === null || (ambar.propuesta.mover.a > HOY_C && ambar.propuesta.mover.a <= mas(lunes, 6)));
	{
		const d = Object.fromEntries(ambar.semaforo.datos.map((x) => [x.clave, x]));
		check("el semaforo trae cada dato con su valor, lo normal y como lo lee",
			d.sueno?.estado === "leve" && d.vfc?.estado === "leve" && d.vfc.normal === "50 ms" && d.readiness?.estado === "bien" && d.pulso?.estado === "bien" && "frescura" in d,
			JSON.stringify(ambar.semaforo.datos));
	}
	check("el ambar explica las razones", ambar.semaforo.razones.some((r) => r.includes("dormido")) && ambar.mensaje.startsWith("🟠"), ambar.mensaje);

	// Aplicar la propuesta y volver a preguntar: no se recorta lo ya recortado.
	{
		const cambios = { [HOY_C]: ambar.propuesta.sesion };
		if (ambar.propuesta.mover) cambios[ambar.propuesta.mover.a] = ambar.propuesta.mover.sesion;
		const ap = await llamar(ana, "coach_proponer", { cambios, porque: "Semaforo ambar", guardar: true });
		const otraVez = await llamar(ana, "coach_hoy");
		check("aplicar la propuesta de hoy se guarda", ap.guardado === true, JSON.stringify(ap));
		check("una sesion ya ajustada no se vuelve a ajustar", otraVez.semaforo.color === "ambar" && otraVez.propuesta === null, JSON.stringify(otraVez.semaforo));
		await llamar(ana, "app_guardar", { doc: "estado/app", datos: { plan: semanaActual }, fusionar: true });
	}
	// Rojo: readiness muy bajo
	Object.assign(manana, { readiness: 25, sueno_h: 7.5, hrv: 50 });
	const rojo = await llamar(ana, "coach_hoy");
	check("readiness muy bajo pone el dia en rojo", rojo.semaforo.color === "rojo");
	check("en rojo, descanso o muy suave", rojo.propuesta?.sesion?.t === "rec" && rojo.propuesta.sesion.min === 30);
	check("en rojo, la sesion dura no se mueve a manana", rojo.propuesta.mover === null || rojo.propuesta.mover.a >= mas(HOY_C, 2));
	check("al mover se dice que sesion se sustituye", ambar.propuesta.mover === null || "sustituye" in ambar.propuesta.mover);

	// Lo que cuenta el usuario tambien cuenta
	Object.assign(manana, { readiness: 80 });
	await llamar(ana, "coach_anotar", { tipo: "dolor", texto: "Rodilla derecha al subir escaleras" });
	const dolor = await llamar(ana, "coach_hoy");
	check("un dolor anotado pone el dia en rojo", dolor.semaforo.color === "rojo" && dolor.semaforo.razones[0].includes("Rodilla"), JSON.stringify(dolor.semaforo));
	check("con dolor no se reprograma la intensidad", dolor.propuesta?.mover === null && dolor.propuesta.texto.includes("profesional"), JSON.stringify(dolor.propuesta));
	check("anotar valida el tipo", Boolean((await llamar(ana, "coach_anotar", { tipo: "otro", texto: "x" })).error));

	// Comida: cuartos de plato; desayuno, comida, merienda y cena son una por dia
	const com1 = await llamar(ana, "comida_registrar", { tipo: "comida", carbohidrato: 2, proteina: 1, verdura: 1, descripcion: "Pasta con atún", hora: "14:10" });
	check("comida_registrar guarda en el formato de la app", com1.guardado && com1.comida.tipo === "Comida" && com1.comida.carbohidrato === 2, JSON.stringify(com1));
	const com2 = await llamar(ana, "comida_registrar", { tipo: "comida", verdura: 2, carbohidrato: 1 });
	check("registrar otra vez la comida del dia la corrige y conserva lo demas",
		com2.corregida && com2.comida.id === com1.comida.id && com2.comida.proteina === 1 && com2.comida.descripcion === "Pasta con atún", JSON.stringify(com2));
	await llamar(ana, "comida_registrar", { tipo: "tentempie", carbohidrato: 1, descripcion: "Plátano" });
	await llamar(ana, "comida_registrar", { tipo: "tentempie", carbohidrato: 1, proteina: 1, descripcion: "Yogur" });
	const lasDeHoy = await llamar(ana, "comidas");
	check("comidas devuelve las del dia; los tentempies se acumulan",
		lasDeHoy.comidas.filter((m) => m.tipo === "Comida").length === 1 && lasDeHoy.comidas.filter((m) => m.tipo === "Tentempié").length === 2, JSON.stringify(lasDeHoy));
	const estadoCom = await llamar(ana, "app_leer", { doc: "estado/app" });
	check("la comida queda en estado/app.meals con su sello de tiempo para que la app la cargue",
		estadoCom.meals.some((m) => m.tipo === "Comida" && m.c === 1 && m.p === 1 && m.v === 2 && m.f && m.h === "14:10") && typeof estadoCom.at === "number" && Boolean(estadoCom.plan), JSON.stringify(estadoCom.meals));
	check("los cuartos no pasan de 4", Boolean((await llamar(ana, "comida_registrar", { tipo: "cena", carbohidrato: 3, proteina: 2 })).error));
	const borrada = await llamar(ana, "comida_registrar", { tipo: "comida", borrar: true });
	check("borrar quita la comida del dia", borrada.borrado && !(await llamar(ana, "comidas")).comidas.some((m) => m.tipo === "Comida"));

	// Una sensacion y un dolor por dia: se corrigen, no se acumulan
	await llamar(ana, "coach_anotar", { tipo: "sensacion", animo: 4, fisico: 3 });
	const corrige = await llamar(ana, "coach_anotar", { tipo: "sensacion", fisico: 2 });
	check("la sensacion del dia se corrige y conserva lo que no cambias", corrige.corregida && corrige.entrada.animo === 4 && corrige.entrada.fisico === 2, JSON.stringify(corrige));
	const leidoDiario = await llamar(ana, "app_leer", { doc: "atleta/diario" }); const diarioHoy = (Array.isArray(leidoDiario) ? leidoDiario : leidoDiario.datos || leidoDiario.doc || []).filter((n) => n.fecha === HOY_C && n.tipo === "sensacion");
	check("solo queda una sensacion ese dia", diarioHoy.length === 1, JSON.stringify(diarioHoy));
	const conAnotado = await llamar(ana, "coach_hoy");
	check("coach_hoy devuelve lo anotado hoy para editarlo",
		conAnotado.anotado_hoy.sensacion.animo === 4 && conAnotado.anotado_hoy.sensacion.fisico === 2 && conAnotado.anotado_hoy.dolor.texto.includes("Rodilla"), JSON.stringify(conAnotado.anotado_hoy));
	await llamar(ana, "coach_anotar", { tipo: "dolor", borrar: true });
	const sinDolor = await llamar(ana, "coach_hoy");
	check("borrar el dolor lo quita del semaforo", sinDolor.anotado_hoy.dolor === null && !sinDolor.semaforo.razones.some((r) => r.includes("Rodilla")), JSON.stringify(sinDolor.semaforo));
	check("fisico 2 (cansado) cuenta en el semaforo", sinDolor.semaforo.razones.some((r) => r.includes("cansado")), JSON.stringify(sinDolor.semaforo.razones));
	check("la sensacion necesita animo, fisico o texto", Boolean((await llamar(ana, "coach_anotar", { tipo: "sensacion" })).error));
	await llamar(ana, "coach_anotar", { tipo: "sensacion", borrar: true });

	// Proponer: las reglas mandan
	const tres = {
		[proxLunes]: { dep: "bici", t: "int", d: "Umbral", min: 60 },
		[mas(proxLunes, 2)]: { dep: "correr", t: "int", d: "Series", min: 45 },
		[mas(proxLunes, 4)]: { dep: "bici", t: "int", d: "VO2", min: 60 },
	};
	const demasiados = await llamar(ana, "coach_proponer", { cambios: tres, porque: "Quiero apretar", guardar: true });
	check("tres intensos en modo forma no se guardan", demasiados.guardado === false && demasiados.valido === false);
	check("el motor dice por que", demasiados.semanas[0].errores.some((e) => e.regla === "max_intensos"));
	const corr = demasiados.semanas[0].cambios_corregidos;
	check("y ofrece una version corregida", corr && Object.values(corr).filter((s) => s?.t === "int").length === 2 && corr[mas(proxLunes, 4)].t === "fondo", JSON.stringify(corr));

	const seguidos = await llamar(ana, "coach_proponer", {
		cambios: { [mas(proxLunes, 1)]: { dep: "bici", t: "int", d: "A", min: 60 }, [mas(proxLunes, 2)]: { dep: "bici", t: "int", d: "B", min: 60 } },
		porque: "prueba",
	});
	check("dos intensos seguidos no pasan", seguidos.semanas[0].errores.some((e) => e.regla === "intensos_seguidos"));

	const valido = { [proxLunes]: { dep: "fuerza", t: "otros", d: "Fuerza 45", min: 45 }, [mas(proxLunes, 1)]: { dep: "bici", t: "int", d: "Umbral 3x10", min: 60 } };
	const soloValidar = await llamar(ana, "coach_proponer", { cambios: valido, porque: "Semana que viene" });
	check("sin guardar=true solo valida", soloValidar.guardado === false && soloValidar.valido === true);
	const antes = await llamar(ana, "app_leer", { doc: "estado/app" });
	check("validar no toca el plan", !antes.next);
	const guardado = await llamar(ana, "coach_proponer", { cambios: valido, porque: "Semana que viene", guardar: true });
	check("con guardar=true y reglas cumplidas se guarda", guardado.guardado === true);
	const despues = await llamar(ana, "app_leer", { doc: "estado/app" });
	check("la semana siguiente va a 'next', como en la app",
		despues.next?.[mas(proxLunes, 1)]?.d === "Umbral 3x10" && despues.plan[HOY_C]?.t === "int" && typeof despues.at === "number");
	check("la decision queda registrada con su porque",
		(await llamar(ana, "app_leer", { doc: "coach/decisiones" })).at(-1).porque === "Semana que viene");

	const pasado = await llamar(ana, "coach_proponer", { cambios: { [mas(HOY_C, -1)]: null }, porque: "x" });
	check("el pasado no se cambia", Boolean(pasado.error));
	const lejos = await llamar(ana, "coach_proponer", { cambios: { [mas(HOY_C, 30)]: null }, porque: "x" });
	check("solo esta semana y la siguiente", Boolean(lejos.error));
	const raro = await llamar(ana, "coach_proponer", { cambios: { [proxLunes]: { dep: "nadar", t: "int" } }, porque: "x" });
	check("una sesion mal formada se rechaza con explicacion", raro.semanas?.[0]?.errores?.[0]?.regla === "formato");

	// Semana
	const sem = await llamar(ana, "coach_semana");
	check("la semana tiene 7 dias con plan y lo hecho", sem.dias?.length === 7 && sem.dias.every((d) => d.estado));
	check("detecta sesiones saltadas o hechas en los dias pasados",
		sem.dias.filter((d) => d.fecha < HOY_C).every((d) => ["hecho", "saltado"].includes(d.estado)));
	check("la semana trae la carga frente a la media", typeof sem.carga.semana === "number" && typeof sem.carga.media_4_semanas === "number");
	check("sabe que la semana siguiente ya tiene plan", sem.siguiente_semana_planificada === true);
	const sig = await llamar(ana, "coach_semana", { semana: "siguiente" });
	check("se puede pedir la semana siguiente", sig.lunes === proxLunes && sig.dias[1].prevista?.t === "int");

	// Metricas por deporte: velocidad siempre, ritmo en carrera, eficiencia
	const prog = await llamar(ana, "coach_progreso", { deporte: "bici", semanas: 8 });
	check("progreso: una fila por semana", prog.semanas?.length === 8, JSON.stringify(prog).slice(0, 200));
	check("progreso: velocidad media en km/h", prog.ultimas_4_semanas.velocidad_kmh === 30.9, JSON.stringify(prog.ultimas_4_semanas));
	check("progreso: pulso y eficiencia (metros por latido)", prog.ultimas_4_semanas.fc_media === 135 && prog.ultimas_4_semanas.metros_por_latido === 3.81);
	check("progreso: tendencia y mejores registros", "velocidad" in prog.tendencia_pct && prog.mejores.some((x) => x.que.startsWith("Sesión más rápida")));
	const run = await llamar(ana, "coach_progreso", { deporte: "correr" });
	check("progreso en carrera da el ritmo", /^\d:\d\d \/km$/.test(run.ultimas_4_semanas.ritmo || ""), run.ultimas_4_semanas.ritmo);
	check("progreso solo de deportes que planifica", Boolean((await llamar(ana, "coach_progreso", { deporte: "raqueta" })).error));
	const semPasada = await llamar(ana, "coach_semana", { semana: "anterior" });
	const hecha = semPasada.dias.flatMap((d) => d.hecho)[0];
	check("lo hecho en la semana trae velocidad, pulso y eficiencia", hecha && hecha.velocidad_kmh > 0 && hecha.fc_media === 135 && hecha.metros_por_latido > 0, JSON.stringify(hecha));

	// Perfil
	check("el perfil empieza vacio", (await llamar(ana, "coach_perfil")).vacio === true);
	await llamar(ana, "coach_perfil_guardar", { cambios: { objetivo: { evento: "Quebrantahuesos", fecha: "2027-06-19" }, lesiones: [{ zona: "rodilla", estado: "activa" }], hackeo: 1 } });
	const perfil = await llamar(ana, "coach_perfil");
	check("el perfil guarda solo campos conocidos", perfil.perfil.objetivo.evento === "Quebrantahuesos" && perfil.perfil.hackeo === undefined);
	const conLesion = await llamar(ana, "coach_proponer", { cambios: { [mas(proxLunes, 3)]: { dep: "bici", t: "int", d: "X", min: 60 } }, porque: "x" });
	check("con una lesion activa avisa de la intensidad", conLesion.semanas[0].avisos.some((a) => a.regla === "lesion"));

	// El nombre del entrenador lo pone el usuario
	const instr = async () => (await rpc(env, ana, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).body.result.instructions;
	check("por defecto el entrenador se llama myCoach", (await instr()).includes("Eres myCoach") && (await llamar(ana, "coach_perfil")).nombre_entrenador === "myCoach");
	await llamar(ana, "coach_perfil_guardar", { cambios: { entrenador: { nombre: "Rafa" } } });
	check("con otro nombre, las instrucciones lo usan", (await instr()).includes("Eres Rafa"));
	check("y coach_hoy lo devuelve", (await llamar(ana, "coach_hoy")).entrenador === "Rafa");
	check("un nombre vacio o larguisimo no se guarda", Boolean((await llamar(ana, "coach_perfil_guardar", { cambios: { entrenador: { nombre: "" } } })).error));
	const padel = await llamar(ana, "coach_proponer", { cambios: { [mas(proxLunes, 5)]: { dep: "raqueta", t: "otros", d: "Padel", min: 60 } }, porque: "x" });
	check("un deporte que no planifica se avisa pero no se bloquea", padel.valido === true && padel.semanas[0].avisos.some((a) => a.regla === "deporte"));

	// Aislamiento: bob no ve nada de ana
	const deBob = await llamar(bob, "coach_perfil");
	check("el perfil de otro usuario no se ve", deBob.vacio === true);
	const hoyBob = await llamar(bob, "coach_hoy");
	check("el nombre del entrenador es de cada usuario", hoyBob.entrenador === "myCoach");
	check("el semaforo de bob no usa el diario ni el plan de ana", hoyBob.sesion_prevista === null && !hoyBob.semaforo.razones.some((r) => r.includes("Rodilla")));

	// El cron deja el semaforo preparado solo para quien usa myCoach
	for (const k of [...env._store.keys()].filter((k) => k.endsWith(":coach/hoy"))) env._store.delete(k);
	for (const t of env.LOGS._tablas.values()) for (const [k, fila] of t) if (fila.last_sync) t.set(k, { ...fila, last_sync: null });
	const esperas = [];
	await worker.scheduled({}, env, { waitUntil: (p) => esperas.push(p) });
	await Promise.all(esperas);
	const conSemaforo = [...env._store.keys()].filter((k) => k.endsWith(":coach/hoy"));
	check("el cron calcula el semaforo de quien usa myCoach, y solo de ellos", conSemaforo.length === 1, conSemaforo.join(","));

	globalThis.fetch = abajo;
}

// ── 12 bis. El entrenador con todo lo de Garmin, y sin reloj (solo un Edge) ──
{
	const fechaMadrid = (d = new Date()) =>
		new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
	const HOY_C = fechaMadrid();
	const mas = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
	const salidas = Array.from({ length: 20 }, (_, i) => ({
		activityId: 7000 + i, activityName: `Salida ${i}`, activityType: { typeKey: "cycling" },
		startTimeLocal: `${mas(HOY_C, -(i * 2 + 1))} 09:00:00`,
		duration: 3600, movingDuration: 3500, distance: 30000, averageHR: 135, maxHR: 170, aerobicTrainingEffect: 3, activityTrainingLoad: 90,
	}));
	mockGarmin({
		"ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } },
		"edu@x.com": { password: "e", data: { displayName: "edu", hrv: null } },
	});
	const abajo = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		const quien = (init?.headers?.Authorization || "").replace("Bearer TOK-", "");
		const r = (x) => new Response(JSON.stringify(x));
		if (!quien || u.hostname !== "connectapi.garmin.com" || u.pathname.includes("socialProfile")) return abajo(url, init);
		if (u.pathname.includes("/activitylist-service/")) return r(Number(u.searchParams.get("start")) ? [] : salidas);
		if (u.pathname.includes("trainingstatus")) return r({
			mostRecentTrainingStatus: { latestTrainingStatusData: { "1": { primaryTrainingDevice: true, trainingStatusFeedbackPhrase: "STRAINED_1",
				acuteTrainingLoadDTO: { dailyTrainingLoadAcute: 900, dailyTrainingLoadChronic: 600, minTrainingLoadChronic: 450, maxTrainingLoadChronic: 840, acwrStatus: "HIGH" } } } },
			mostRecentTrainingLoadBalance: { metricsTrainingLoadBalanceDTOMap: { "1": { trainingBalanceFeedbackPhrase: "ANAEROBIC_SHORTAGE", monthlyLoadAnaerobic: 20 } } } });
		if (quien === "edu") {
			// Solo un Edge: actividades sí, descanso no.
			if (u.pathname.includes("/usersummary-service/")) return r({ totalSteps: null });
			if (u.pathname.startsWith("/hrv-service/")) return new Response(null, { status: 204 });
			if (u.pathname.includes("dailySleepData")) return r({ dailySleepDTO: {} });
			if (u.pathname.includes("trainingreadiness")) return r([]);
			return new Response("{}", { status: 404 });
		}
		if (u.pathname.includes("/usersummary-service/")) return r({ restingHeartRate: 48, sleepingSeconds: 7.4 * 3600, totalSteps: 9000, dailyStepGoal: 8000 });
		if (u.pathname.includes("dailySleepData")) return r({ dailySleepDTO: { sleepTimeSeconds: 7.5 * 3600, deepSleepSeconds: 5400,
			sleepScores: { overall: { value: 80 }, remPercentage: { qualifierKey: "GOOD" } } }, restingHeartRate: 48 });
		if (u.pathname.startsWith("/hrv-service/hrv/")) return r({ hrvSummary: { lastNightAvg: 50, status: "BALANCED", baseline: { balancedLow: 44, balancedUpper: 58 } } });
		if (u.pathname.includes("trainingreadiness")) return r([{ score: 80, level: "HIGH", sleepScoreFactorPercent: 85, hrvFactorPercent: 90, acwrFactorPercent: 60 }]);
		if (u.pathname.includes("dailyStress")) return r({ avgStressLevel: 62, maxStressLevel: 95 });
		if (u.pathname.includes("bodyBattery/reports")) return r([{ charged: 60, drained: 55, bodyBatteryStat: { highestValue: 90, lowestValue: 20 } }]);
		if (u.pathname.includes("respiration")) return r({ avgWakingRespirationValue: 15, avgSleepRespirationValue: 13 });
		return new Response("{}", { status: 404 }); // sin SpO2: ese reloj no lo mide
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const edu = (await connect(env, "edu@x.com", "e")).tokens.access_token;
	const llamar = async (token, name, args = {}) => {
		const r = await rpc(env, token, { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name, arguments: args } });
		const res = r.body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};

	// garmin_dia: todo un día en una llamada; lo que no mide el reloj, en sin_datos.
	const dia = await llamar(ana, "garmin_dia", { date: HOY_C });
	check("garmin_dia: sueño con fases, puntuación y factores", dia.sueno?.horas === 7.5 && dia.sueno.profundo_h === 1.5 && dia.sueno.factores?.remPercentage === "GOOD", JSON.stringify(dia.sueno));
	check("garmin_dia: VFC con su franja normal", dia.vfc?.media_noche === 50 && dia.vfc.franja_normal[0] === 44 && dia.vfc.franja_normal[1] === 58);
	check("garmin_dia: readiness con lo que pesa cada factor", dia.readiness?.puntos === 80 && dia.readiness.factores_pct.carga === 60);
	check("garmin_dia: estrés, Body Battery, respiración y resumen", dia.estres?.medio === 62 && dia.body_battery?.maximo === 90 && dia.respiracion?.dormido === 13 && dia.resumen?.pasos === 9000);
	check("garmin_dia: lo que no mide va a sin_datos", dia.spo2 === null && dia.sin_datos?.includes("spo2"), JSON.stringify(dia.sin_datos));
	const solo = await llamar(ana, "garmin_dia", { date: HOY_C, partes: ["vfc"] });
	check("garmin_dia: con partes, solo esas", solo.vfc?.media_noche === 50 && !("sueno" in solo) && !solo.sin_datos);

	// El motor con lo de Garmin: carga por encima de la franja, estado sobrecargado y estrés alto.
	const hoyA = await llamar(ana, "coach_hoy");
	const porClave = Object.fromEntries((hoyA.semaforo?.datos || []).map((d) => [d.clave, d]));
	check("coach_hoy: carga de 7 días de Garmin frente a su franja", porClave.carga_garmin?.valor === "900" && porClave.carga_garmin.normal === "450-840" && porClave.carga_garmin.estado === "leve", JSON.stringify(porClave.carga_garmin));
	check("coach_hoy: el estado de Garmin (sobrecargado) cuenta", porClave.estado_garmin?.valor === "Sobrecargado" && hoyA.semaforo.razones.some((t) => /sobrecargado/.test(t)), JSON.stringify(hoyA.semaforo.razones));
	check("coach_hoy: estrés alto ayer cuenta como leve", porClave.estres?.estado === "leve");
	check("coach_hoy: tres señales leves de Garmin ponen ámbar", hoyA.semaforo.color === "ambar", hoyA.semaforo.color);
	check("coach_hoy: trae la carga y el Load Focus de Garmin", hoyA.garmin?.carga?.aguda_7d === 900 && hoyA.garmin.enfoque_carga?.veredicto === "Falta anaeróbico");
	check("coach_hoy: con reloj, mide el descanso", hoyA.fuentes?.sin_descanso === false && hoyA.fuentes.sueno && !hoyA.pide_sensacion, JSON.stringify(hoyA.fuentes));
	const sem = await llamar(ana, "coach_semana");
	check("coach_semana: el Load Focus dice qué tipo de trabajo falta", sem.avisos_garmin?.some((a) => a.regla === "enfoque_carga" && /anaeróbico/.test(a.texto)), JSON.stringify(sem.avisos_garmin));
	check("coach_semana: y avisa de la carga por encima de la franja", sem.avisos_garmin.some((a) => a.regla === "carga_garmin" && /por encima/.test(a.texto)));

	// Edu solo tiene un Edge: no hay huecos de sueño ni VFC; se le pregunta cómo llega.
	const hoyE = await llamar(edu, "coach_hoy");
	const claves = (hoyE.semaforo?.datos || []).map((d) => d.clave);
	check("sin reloj: se detecta que no hay datos de descanso", hoyE.fuentes?.sin_descanso === true, JSON.stringify(hoyE.fuentes));
	check("sin reloj: no se enseñan sueño, VFC, pulso ni readiness vacíos", !claves.some((k) => ["sueno", "vfc", "pulso", "readiness"].includes(k)) && claves.includes("frescura") && claves.includes("carga_garmin"), JSON.stringify(claves));
	check("sin reloj: no cuenta como dato que falta", hoyE.semaforo.datos_que_faltan.length === 0 && hoyE.semaforo.sin_descanso === true);
	check("sin reloj: pide cómo se encuentra", hoyE.pide_sensacion === true && /cuéntame cómo llegas/.test(hoyE.mensaje), hoyE.mensaje);
	await llamar(edu, "coach_anotar", { tipo: "sensacion", fisico: 4, animo: 4 });
	check("sin reloj: con lo anotado ya no lo pide", (await llamar(edu, "coach_hoy")).pide_sensacion === false);
	const serie = await llamar(edu, "garmin_dia", { dias: 7 });
	check("garmin_dia con dias: la serie guardada y qué mide el dispositivo", Array.isArray(serie.dias) && serie.dias.length >= 5 && serie.fuentes?.sin_descanso === true, JSON.stringify(serie).slice(0, 200));
	globalThis.fetch = abajo;
}

// ── 12 quinquies. Conocer a la persona: tono, lo que falta saber y lo que no le gusta ──
{
	mockGarmin({ "pau@x.com": { password: "p", data: { displayName: "pau", hrv: null } } });
	const abajo = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.hostname !== "connectapi.garmin.com" || u.pathname.includes("socialProfile")) return abajo(url, init);
		if (u.pathname.includes("/activitylist-service/")) return new Response("[]");
		return new Response("{}", { status: 404 });
	};
	const env = makeEnv();
	const pau = (await connect(env, "pau@x.com", "p")).tokens.access_token;
	const llamar = async (name, args = {}) => {
		const r = await rpc(env, pau, { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name, arguments: args } });
		const res = r.body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};

	// Las instrucciones caben enteras: Claude las corta a 4096 caracteres.
	await llamar("coach_perfil_guardar", { cambios: { entrenador: { nombre: "N".repeat(24) } } });
	const ins = (await rpc(env, pau, { jsonrpc: "2.0", id: 41, method: "initialize", params: { protocolVersion: "2025-06-18" } })).body.result.instructions;
	check("instrucciones por debajo del corte de 4096 (con un nombre de 24 letras)", ins.length < 3900, String(ins.length));
	const herr = (await rpc(env, pau, { jsonrpc: "2.0", id: 42, method: "tools/list" })).body.result.tools;
	const todo = ins + herr.map((t) => t.name + " " + t.description + JSON.stringify(t.inputSchema)).join(" ");
	// Ninguna regla se pierde al acortar: cada una vive en las instrucciones o en la herramienta a la que afecta.
	const reglas = ["nunca diagnostiques", "coach_proponer sin guardar", "por_conocer", "antes_de_proponer", "no_le_gusta", "sin_descanso", "garmin_api",
		"mycoach_abrir", "garmin_status", "nunca pidas capturas", "ya es su si", "vista previa", "mas reps o mas peso", "actualizar_entreno",
		"estime los cuartos", "no dibuje", "garmin_plan_route", "pida su confirmacion", "fuerza_desde_garmin", "entrenos_desde_garmin", "tendencia",
		"agenda_anotar", "entrena_igualmente", "no le preguntes lo que ya esta", "sin de/a"];
	const perdidas = reglas.filter((r) => !todo.toLowerCase().includes(r.toLowerCase()));
	check("ninguna regla se pierde al acortar las instrucciones", perdidas.length === 0, perdidas.join(" | "));
	check("las instrucciones no hablan de tecnicismos al usuario", /nunca digas MCP, conector/.test(ins));

	// Perfil vacío: lo primero que quiere saber es cómo hablarle.
	const p0 = await llamar("coach_perfil");
	check("perfil sin datos: por_conocer empieza por el tono", p0.por_conocer?.[0]?.clave === "tono" && p0.por_conocer.length === 6, JSON.stringify(p0.por_conocer?.map((x) => x.clave)));
	const h0 = await llamar("coach_hoy");
	check("coach_hoy trae una sola pregunta, la siguiente", h0.por_conocer?.clave === "tono" && h0.tono === null, JSON.stringify(h0.por_conocer));

	// Tono y nombre se guardan sin pisarse.
	await llamar("coach_perfil_guardar", { cambios: { entrenador: { tono: { estilo: "directo", humor: 1, emojis: false } } } });
	await llamar("coach_perfil_guardar", { cambios: { entrenador: { nombre: "Rafa" } } });
	const p1 = (await llamar("coach_perfil")).perfil;
	check("guardar el nombre no borra el tono (ni al revés)", p1.entrenador.nombre === "Rafa" && p1.entrenador.tono?.estilo === "directo" && p1.entrenador.tono.humor === 1, JSON.stringify(p1.entrenador));
	check("un humor fuera de 0-3 no se guarda", Boolean((await llamar("coach_perfil_guardar", { cambios: { entrenador: { tono: { humor: 7 } } } })).error));
	const h1 = await llamar("coach_hoy");
	check("con el tono guardado, coach_hoy lo trae y pasa a la siguiente pregunta", h1.tono?.estilo === "directo" && h1.por_conocer?.clave === "objetivo");
	await llamar("coach_perfil_guardar", { cambios: { lesiones: [] } });
	check("lesiones: [] cuenta como 'ninguna', ya no se pregunta", !(await llamar("coach_perfil")).por_conocer.some((x) => x.clave === "lesiones"));

	// Paula pide fuerza: antes de proponer, lo que falta saber.
	const f0 = await llamar("entrenos", { tipo: "fuerza" });
	const claves = (f0.antes_de_proponer?.preguntas || []).map((x) => x.clave);
	check("fuerza sin datos: antes de proponer pregunta nivel, material y tiempo", claves.join() === "experiencia.fuerza,material,disponibilidad", claves.join());
	check("la lista de cardio no lleva preguntas de fuerza", !(await llamar("entrenos", { tipo: "cardio" })).antes_de_proponer);
	await llamar("coach_perfil_guardar", { cambios: { experiencia: { fuerza: "nunca" }, material: { lugar: "casa", mancuernas: "2 de 5 kg" }, disponibilidad: { dias: 3, minutos: 40 },
		no_le_gusta: [{ ejercicio: "Sentadilla", motivo: "se aburre", alternativa: "Subida al banco" }] } });
	const f1 = await llamar("entrenos", { tipo: "fuerza" });
	check("con lo que hace falta sabido, ya no pregunta", !f1.antes_de_proponer);
	check("y devuelve lo que no le gusta, con su alternativa", f1.no_le_gusta?.[0]?.alternativa === "Subida al banco");
	const g = await llamar("fuerza_entreno_guardar", { nombre: "Piernas en casa", ejercicios: [{ nombre: "Sentadilla goblet", series: 3, reps: 10 }, { nombre: "Puente de glúteo", series: 3, reps: 12 }] });
	check("guardar un entreno con lo que no le gusta avisa (y lo guarda igual)", g.guardado?.id === "piernas-en-casa" && g.no_le_gusta?.[0]?.ejercicio === "Sentadilla", JSON.stringify(g.no_le_gusta));
	check("no_le_gusta tiene que ser una lista con ejercicio", Boolean((await llamar("coach_perfil_guardar", { cambios: { no_le_gusta: [{ motivo: "x" }] } })).error));
	globalThis.fetch = abajo;
}

// ── 12 quater. Agenda: tus compromisos y tu calendario mandan sobre el plan ──
{
	const fechaMadrid = (d = new Date()) =>
		new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
	const HOY_C = fechaMadrid();
	const mas = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
	const lunes = (() => { const d = new Date(`${HOY_C}T12:00:00Z`); return mas(HOY_C, -((d.getUTCDay() + 6) % 7)); })();
	const L = mas(lunes, 7); // la semana que viene: entera por delante
	const ics = (f) => f.replaceAll("-", "");
	let calendario = "ok";
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } }, "bob@x.com": { password: "b", data: { displayName: "bob", hrv: 60 } } });
	const abajo = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const u = String(url);
		if (!u.startsWith("https://cal.test/")) return abajo(url, init);
		if (calendario === "caido" || u.endsWith("no.ics")) return new Response("<html>no</html>");
		return new Response(["BEGIN:VCALENDAR",
			"BEGIN:VEVENT", "UID:boda", "SUMMARY:Boda de Marta", `DTSTART;VALUE=DATE:${ics(mas(L, 5))}`, `DTEND;VALUE=DATE:${ics(mas(L, 6))}`, "END:VEVENT",
			"BEGIN:VEVENT", "UID:dentista", "SUMMARY:Dentista", `DTSTART;TZID=Europe/Madrid:${ics(mas(L, 4))}T100000`, `DTEND;TZID=Europe/Madrid:${ics(mas(L, 4))}T110000`, "END:VEVENT",
			"END:VCALENDAR"].join("\r\n"));
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const bob = (await connect(env, "bob@x.com", "b")).tokens.access_token;
	const llamar = async (token, name, args = {}) => {
		const res = (await rpc(env, token, { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name, arguments: args } })).body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};
	const next = {
		[L]: { dep: "bici", t: "fondo", d: "Rodaje 1 h", min: 60 },
		[mas(L, 1)]: { dep: "bici", t: "int", d: "Series 5 x 4 min", min: 60 },
		[mas(L, 3)]: { dep: "correr", t: "fondo", d: "Rodaje 1 h 30", min: 90 },
		[mas(L, 5)]: { dep: "bici", t: "fondo", d: "Fondo 3 h", min: 180 },
	};
	const hoyPlan = { [HOY_C]: { dep: "bici", t: "fondo", d: "Rodaje 1 h", min: 60 } };
	await llamar(ana, "app_guardar", { doc: "estado/app", datos: { plan: hoyPlan, next, goal: { modo: "forma" }, sports: ["bici", "correr"] } });

	// Una franja deja el resto del día libre
	const cena = await llamar(ana, "agenda_anotar", { fecha: mas(L, 1), de: "19:30", a: "22:00", titulo: "Cena con amigos", tipo: "social" });
	check("agenda: una franja no bloquea el día entero", cena.guardado === false && cena.choques.length === 0 && cena.propuesta_plan === null, JSON.stringify(cena));
	check("agenda: sin guardar=true no se guarda nada", (await llamar(ana, "agenda", { desde: L })).dias[1].eventos.length === 0);

	// Todo el día: la sesión clave se mueve, sin pegarla a otra exigente
	const viaje = await llamar(ana, "agenda_anotar", { fecha: mas(L, 1), titulo: "Viaje a Bilbao", tipo: "viaje" });
	check("agenda: un día entero ocupado choca con la sesión", viaje.choques.some((c) => c.regla === "dia_ocupado" && c.fecha === mas(L, 1) && c.texto.includes("Viaje a Bilbao")), JSON.stringify(viaje.choques));
	const mov = viaje.propuesta_plan?.cambios || {};
	check("agenda: las series pasan a un día libre de esa semana", mov[mas(L, 1)] === null && mov[mas(L, 2)]?.t === "int" && mov[mas(L, 2)].d === "Series 5 x 4 min", JSON.stringify(viaje.propuesta_plan));
	const g1 = await llamar(ana, "agenda_anotar", { fecha: mas(L, 1), titulo: "Viaje a Bilbao", tipo: "viaje", guardar: true });
	check("agenda: con guardar=true queda guardado con su id", g1.guardado && /^c/.test(g1.compromiso.id));
	const ap = await llamar(ana, "coach_proponer", { cambios: mov, porque: viaje.propuesta_plan.porque, guardar: true });
	check("agenda: la propuesta se aplica con coach_proponer", ap.guardado === true, JSON.stringify(ap));
	const vuelta = await llamar(ana, "coach_proponer", { cambios: { [mas(L, 1)]: next[mas(L, 1)] }, porque: "x" });
	check("agenda: poner una sesión en un día ocupado no pasa", vuelta.valido === false && vuelta.semanas[0].errores.some((e) => e.regla === "dia_ocupado"), JSON.stringify(vuelta));
	const igual = await llamar(ana, "coach_proponer", { cambios: { [mas(L, 1)]: { dep: "correr", t: "rec", d: "30 min en el hotel", min: 30 } }, porque: "Entreno en el viaje", entrena_igualmente: true });
	check("agenda: si dice que entrena igualmente, solo se avisa", igual.valido === true && igual.semanas[0].avisos.some((a) => a.regla === "dia_ocupado"), JSON.stringify(igual));
	const hoyIgual = await llamar(ana, "coach_proponer", { cambios: { [HOY_C]: { dep: "bici", t: "rec", d: "Suave", min: 45 } }, porque: "x" });
	check("agenda: un choque en otro día no frena el cambio de hoy", hoyIgual.valido === true, JSON.stringify(hoyIgual));

	// Una franja larga: el relleno se recorta al hueco que queda
	const curro = await llamar(ana, "agenda_anotar", { fecha: mas(L, 3), de: "06:00", a: "20:30", titulo: "Turno largo", tipo: "trabajo" });
	const jue = curro.propuesta_plan?.cambios?.[mas(L, 3)];
	check("agenda: si no cabe, el rodaje se recorta a lo libre", curro.choques[0]?.regla === "no_cabe" && jue?.min === 75 && jue.d.startsWith("Versión corta"), JSON.stringify(curro));

	// Corregir y borrar
	const corr = await llamar(ana, "agenda_anotar", { id: g1.compromiso.id, de: "08:00", a: "12:00", guardar: true });
	check("agenda: corregir cambia la franja y conserva lo demás", corr.compromiso.titulo === "Viaje a Bilbao" && corr.compromiso.de === "08:00" && corr.compromiso.id === g1.compromiso.id, JSON.stringify(corr));
	check("agenda: de y a van juntos", Boolean((await llamar(ana, "agenda_anotar", { fecha: L, de: "19:00", titulo: "x" })).error));
	check("agenda: el pasado no se anota", Boolean((await llamar(ana, "agenda_anotar", { fecha: mas(HOY_C, -1), titulo: "x" })).error));
	check("agenda: borrar sin id no hace nada a ciegas", Boolean((await llamar(ana, "agenda_anotar", { borrar: true, guardar: true })).error));
	const borr = await llamar(ana, "agenda_anotar", { id: g1.compromiso.id, borrar: true, guardar: true });
	check("agenda: borrar lo quita", borr.guardado && (await llamar(ana, "agenda", { desde: L })).dias[1].eventos.length === 0);

	// El calendario: se conecta desde la app y el motor lo usa
	check("calendario: solo https o webcal", Boolean((await llamar(ana, "agenda_calendario", { url: "http://cal.test/ok.ics" })).error));
	check("calendario: tiene que ser un calendario", Boolean((await llamar(ana, "agenda_calendario", { url: "https://cal.test/no.ics" })).error));
	const con = await llamar(ana, "agenda_calendario", { url: "webcal://cal.test/ok.ics" });
	check("calendario: conectado", con.conectado === true);
	const guardado = [...env._store.entries()].find(([k]) => k.endsWith(":agenda/fuente"))?.[1] || "";
	check("calendario: el enlace se guarda cifrado", guardado && !guardado.includes("cal.test"), guardado);
	const sem = await llamar(ana, "coach_semana", { semana: "siguiente" });
	const sab = sem.dias.find((d) => d.fecha === mas(L, 5));
	check("calendario: coach_semana trae los eventos de cada día", sab.agenda?.todo_ocupado === true && sab.agenda.eventos[0].origen === "calendario" && sab.agenda.eventos[0].titulo === "Boda de Marta", JSON.stringify(sab));
	check("calendario: el plan que choca sale en las reglas", sem.plan_cumple_reglas.errores.some((e) => e.regla === "dia_ocupado" && e.fecha === mas(L, 5)), JSON.stringify(sem.plan_cumple_reglas));
	const vie = (await llamar(ana, "agenda", { desde: L })).dias[4];
	check("calendario: un evento con hora deja libres los huecos de alrededor", vie.libre_min > 300 && vie.huecos.length === 2 && vie.huecos[0] === "06:00-09:45", JSON.stringify(vie));
	const finde = await llamar(ana, "agenda_anotar", { fecha: mas(L, 5), titulo: "Comida familiar", de: "14:00", a: "17:00" });
	check("calendario: el fondo largo de la boda se mueve al domingo", finde.propuesta_plan?.cambios?.[mas(L, 6)]?.min === 180, JSON.stringify(finde.propuesta_plan));

	// Sin culpa: el día sin hueco no cuenta como saltado (se comprueba con hoy)
	await llamar(ana, "agenda_anotar", { fecha: HOY_C, titulo: "Mudanza", tipo: "casa", guardar: true });
	const hoy = await llamar(ana, "coach_hoy");
	check("coach_hoy: dice que hoy no tienes hueco", hoy.agenda?.cabe === false && hoy.mensaje.includes("no tienes hueco") && hoy.mensaje.includes("Mudanza"), JSON.stringify({ agenda: hoy.agenda, mensaje: hoy.mensaje }));

	// Si el calendario no responde, todo sigue funcionando y se dice
	calendario = "caido";
	for (const k of [...env._store.keys()].filter((k) => k.startsWith("agenda-ics:"))) env._store.delete(k);
	const sinCal = await llamar(ana, "agenda", { desde: L });
	check("calendario caído: se avisa y lo tuyo sigue", Boolean(sinCal.calendario.error) && sinCal.dias.length === 7, JSON.stringify(sinCal.calendario));
	calendario = "ok";

	// Cada uno su agenda
	const deBob = await llamar(bob, "agenda", { desde: L });
	check("agenda: la de otro usuario no se ve", deBob.calendario.conectado === false && deBob.dias.every((d) => d.eventos.length === 0));
	await llamar(ana, "agenda_calendario", { quitar: true });
	check("calendario: quitarlo borra el enlace", (await llamar(ana, "agenda", { desde: L })).calendario.conectado === false);

	globalThis.fetch = abajo;
}

// ── 12 ter. Convenciones de las herramientas (el camino para crecer sin romper) ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const { tokens } = await connect(env, "ana@x.com", "a");
	const tools = (await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 30, method: "tools/list" })).body.result.tools;
	const FAMILIAS = /^(agenda|garmin|coach|entrenos?|entreno|fuerza|cardio|comida|comidas|peso|intervals|app|mycoach)(_[a-z0-9]+)*$/;
	check("convención: cada herramienta empieza por su familia", tools.every((t) => FAMILIAS.test(t.name)), tools.filter((t) => !FAMILIAS.test(t.name)).map((t) => t.name).join());
	check("convención: todas con título, descripción y esquema de objeto", tools.every((t) => t.title && t.description?.length > 40 && t.inputSchema?.type === "object"));
	check("convención: descripciones de menos de 1500 caracteres", tools.every((t) => t.description.length < 1500), tools.filter((t) => t.description.length >= 1500).map((t) => t.name).join());
	const soloApp = tools.filter((t) => t._meta?.ui?.visibility?.join() === "app").map((t) => t.name).sort();
	check("las de la app no se le enseñan al modelo (visibility app)", soloApp.join() === "agenda_calendario,app_guardar,fuerza_dia,intervals_conectar,intervals_desconectar", soloApp.join());
	check("la app sigue pudiendo llamarlas", !(await rpc(env, tokens.access_token, { jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "app_guardar", arguments: { doc: "notas", datos: [] } } })).body.result.isError);
	const viejas = ["garmin_sleep", "garmin_hrv", "garmin_daily_summary", "garmin_body_battery", "garmin_training_readiness", "garmin_course_detail", "fuerza_entrenos", "cardio_entrenos", "fuerza_enviar_garmin", "cardio_enviar_garmin"];
	check("las herramientas juntadas ya no existen", !tools.some((t) => viejas.includes(t.name)));
	const visibles = tools.filter((t) => !t._meta?.ui?.visibility || t._meta.ui.visibility.includes("model"));
	check("Claude ve 42 herramientas", visibles.length === 42, String(visibles.length));
}

// ── 13. Intervals.icu: clave cifrada, actividades, series, bienestar y curvas ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } }, "bob@x.com": { password: "b", data: { displayName: "bob", hrv: 60 } } });
	const abajo = globalThis.fetch;
	const vistas = [];
	const CLAVE = "clave-secreta-de-intervals-123";
	globalThis.fetch = async (url, init) => {
		const u = new URL(url);
		if (u.hostname !== "intervals.icu") return abajo(url, init);
		vistas.push(u.pathname + u.search);
		if (init?.headers?.Authorization !== `Basic ${btoa(`API_KEY:${CLAVE}`)}`) return new Response("{}", { status: 401 });
		const json = (o) => new Response(JSON.stringify(o));
		if (u.pathname === "/api/v1/athlete/i77") return json({ id: "i77", name: "Ana" });
		if (u.pathname === "/api/v1/athlete/i77/activities") return json([
			{ id: "i1", start_date_local: "2026-09-27T09:00:00", type: "Ride", name: "Fondo", moving_time: 7200, elapsed_time: 7500, distance: 60000,
				average_speed: 8.333, max_speed: 16, total_elevation_gain: 900, average_heartrate: 138, max_heartrate: 172, icu_average_watts: 190,
				icu_weighted_avg_watts: 210, icu_intensity: 76.4, icu_efficiency_factor: 1.52, decoupling: 3.2, icu_training_load: 120,
				icu_hr_zone_times: [600, 3600, 2400, 600, 0], icu_zone_times: [{ id: "Z1", secs: 1800 }, { id: "Z2", secs: 5400 }],
				average_cadence: 86, stream_types: ["watts", "heartrate", "cadence"], nada: null },
			{ id: "i2", start_date_local: "2026-09-26T08:00:00", type: "Run", name: "Series", moving_time: 3000, distance: 10000, average_speed: 3.333,
				gap: 3.45, average_heartrate: 155, average_cadence: 172, average_stride: 1.16, average_stance_time: 240, average_vertical_oscillation: 8.1 },
		]);
		if (u.pathname === "/api/v1/activity/i1") return json({ id: "i1", type: "Ride", name: "Fondo", average_speed: 8.333, average_heartrate: 138 });
		if (u.pathname === "/api/v1/activity/i1/intervals") return json({ icu_intervals: [
			{ label: "Umbral 1", type: "WORK", moving_time: 600, distance: 6000, average_watts: 260, average_heartrate: 162, average_speed: 10, average_cadence: 90, decoupling: 1.5 },
		] });
		if (u.pathname === "/api/v1/activity/i1/streams.json") return json([
			{ type: "distance", data: Array.from({ length: 48 }, (_, i) => (i + 1) * 1250) },
			{ type: "watts", name: "Power", data: Array.from({ length: 48 }, (_, i) => 150 + i) },
			{ type: "heartrate", data: Array.from({ length: 48 }, () => 140) },
			{ type: "velocity_smooth", data: Array.from({ length: 48 }, () => 8.333) },
			{ type: "latlng", data: [[1, 2]] },
		]);
		if (u.pathname === "/api/v1/athlete/i77/wellness.json") return json([{ id: "2026-09-28", ctl: 55.12, atl: 60.3, restingHR: 47, hrv: 58, sleepSecs: 27000, readiness: 71, weight: 70.2 }]);
		if (u.pathname === "/api/v1/athlete/i77/power-curves.json") return json({ list: [{ id: "42d", label: "42 dias", secs: [5, 15, 30, 60, 300, 600, 1200, 3600], values: [900, 700, 500, 400, 300, 280, 260, 230] }] });
		if (u.pathname === "/api/v1/athlete/i77/pace-curves.json") return json({ list: [{ id: "1y", distance: [400, 1000, 5000, 10000], values: [80, 220, 1200, 2520] }] });
		return new Response("{}", { status: 404 });
	};

	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const bob = (await connect(env, "bob@x.com", "b")).tokens.access_token;
	const llamar = async (token, name, args = {}) => {
		const r = (await rpc(env, token, { jsonrpc: "2.0", id: 30, method: "tools/call", params: { name, arguments: args } })).body.result;
		return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
	};

	check("sin conectar, lo dice y explica donde", (await llamar(ana, "intervals_actividades")).error?.includes("Ajustes"));
	check("una clave mala no se guarda", Boolean((await llamar(ana, "intervals_conectar", { athlete_id: "i77", api_key: "otra-clave-cualquiera" })).error));
	check("un id raro se rechaza sin llamar", Boolean((await llamar(ana, "intervals_conectar", { athlete_id: "../x", api_key: CLAVE })).error));
	const con = await llamar(ana, "intervals_conectar", { athlete_id: "i77", api_key: CLAVE });
	check("con la clave buena conecta", con.conectado === true && con.nombre === "Ana");
	const guardado = [...env._store.entries()].find(([k]) => k.startsWith("intervals:"))?.[1] || "";
	check("la clave se guarda cifrada, no en claro", guardado && !guardado.includes(CLAVE) && JSON.parse(guardado).athlete_id === "i77");
	check("estado conectado", (await llamar(ana, "intervals_estado")).conectado === true);

	const acts = await llamar(ana, "intervals_actividades", { desde: "2026-09-20", hasta: "2026-09-28" });
	const [fondo, series] = acts;
	check("actividades con velocidad, potencia, eficiencia y desacople",
		fondo.velocidad_media_kmh === 30 && fondo.potencia_normalizada_w === 210 && fondo.factor_eficiencia === 1.52 && fondo.desacople_pct === 3.2, JSON.stringify(fondo));
	check("VAM y metros por latido calculados", fondo.vam_mh === 450 && fondo.metros_por_latido === 3.62);
	check("tiempo en zonas en minutos", fondo.zonas_fc_min[1].min === 60 && fondo.zonas_potencia_min[1].zona === "Z2");
	check("sin campos vacios", !("nada" in fondo));
	check("carrera: ritmo, GAP, zancada, contacto, oscilacion",
		series.ritmo_medio === "5:00 /km" && series.ritmo_ajustado_pendiente === "4:50 /km" && series.zancada_m === 1.16 && series.contacto_suelo_ms === 240 && series.oscilacion_vertical_cm === 8.1, JSON.stringify(series));
	check("las fechas llegan a la API", vistas.some((v) => v.includes("oldest=2026-09-20") && v.includes("newest=2026-09-28")));

	const det = await llamar(ana, "intervals_actividad", { id: "i1" });
	check("detalle con intervalos", det.intervalos?.[0]?.potencia_w === 260 && det.intervalos[0].velocidad_kmh === 36);
	check("detalle con series resumidas", det.series?.find((x) => x.tipo === "watts")?.max === 197 && !det.series.some((x) => x.tipo === "latlng"));
	check("detalle con perfil por km", det.perfil?.eje === "km" && det.perfil.puntos.length === 24 && det.perfil.puntos.at(-1)[0] === 60);

	const bien = await llamar(ana, "intervals_bienestar");
	check("bienestar: forma, VFC, sueno, peso", bien[0].forma_ctl === 55.1 && bien[0].vfc === 58 && bien[0].sueno_h === 7.5 && bien[0].peso_kg === 70.2);
	const pot = await llamar(ana, "intervals_curvas", { deporte: "bici", tipo: "potencia" });
	check("curva de potencia en duraciones claras", pot.curvas[0].mejores.find((x) => x.duracion === "20 min")?.vatios === 260);
	check("pide el tipo de deporte de Intervals", vistas.some((v) => v.startsWith("/api/v1/athlete/i77/power-curves.json") && v.includes("type=Ride")));
	const rit = await llamar(ana, "intervals_curvas", { deporte: "correr", tipo: "ritmo" });
	check("curva de ritmo por distancias", rit.curvas[0].mejores.find((x) => x.distancia === "5 km")?.ritmo === "4:00 /km", JSON.stringify(rit.curvas[0]));

	check("otro usuario no ve el Intervals de ana", (await llamar(bob, "intervals_estado")).conectado === false);
	await llamar(ana, "intervals_desconectar");
	check("desconectar borra la clave", ![...env._store.keys()].some((k) => k.startsWith("intervals:")));
	globalThis.fetch = abajo;
}

// ── 14. myCoach dentro de Claude (MCP Apps) ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const env = makeEnv();
	const pedidas = [];
	env.MYCOACH = { fetch: async (req) => { pedidas.push(new URL(req.url).pathname); return new Response("<!doctype html><html><body>myCoach</body></html>"); } };
	const tok = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const init = await rpc(env, tok, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	check("el servidor anuncia recursos", Boolean(init.body.result.capabilities.resources));
	check("las instrucciones dicen cuando abrir la app", init.body.result.instructions.includes("mycoach_abrir"));
	const lista = await rpc(env, tok, { jsonrpc: "2.0", id: 2, method: "resources/list" });
	const rec = lista.body.result.resources[0];
	check("la app es un recurso ui:// de tipo MCP App, con version", /^ui:\/\/mycoach\/app\?v=[0-9a-f]{12}$/.test(rec?.uri) && rec.mimeType === "text/html;profile=mcp-app");
	const tools = (await rpc(env, tok, { jsonrpc: "2.0", id: 3, method: "tools/list" })).body.result.tools;
	const abrir = tools.find((t) => t.name === "mycoach_abrir");
	check("mycoach_abrir enlaza con la pantalla de la version actual", abrir?._meta?.ui?.resourceUri === rec.uri);
	check("las demas herramientas no abren pantallas", !tools.find((t) => t.name === "coach_hoy")._meta);
	const leido = await rpc(env, tok, { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: rec.uri } });
	const c = leido.body.result.contents[0];
	check("leer el recurso da el HTML de la app", c.mimeType === "text/html;profile=mcp-app" && c.text.includes("myCoach") && pedidas[0] === "/mcp-app");
	await rpc(env, tok, { jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "ui://mycoach/app" } });
	check("cada apertura trae la version recien desplegada", pedidas.length === 2);
	check("la pantalla puede cargar el codigo de la web (CSP)",
		c._meta.ui.csp.resourceDomains.includes("https://mycoach.albertbecervas.workers.dev"));
	const llamada = await rpc(env, tok, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "coach_hoy", arguments: {} } });
	check("toda respuesta lleva resultType (lo exige MCP 2026-07-28)", llamada.body.result.resultType === "complete");
	check("la pantalla no se cachea (ttlMs 0)", leido.body.result.ttlMs === 0 && leido.body.result.resultType === "complete");
	const lista2 = (await rpc(env, tok, { jsonrpc: "2.0", id: 7, method: "tools/list" })).body.result;
	check("la lista de herramientas se cachea como mucho un minuto", lista2.ttlMs === 60000 && lista2.cacheScope === "public");
	// server/discover no se implementa: el -32601 manda al cliente (Claude y ChatGPT)
	// por initialize. Contestarlo sin 2026-07-28 dejaba a ChatGPT sin herramientas.
	const desc = await rpc(env, tok, { jsonrpc: "2.0", id: 8, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });
	check("server/discover da metodo no soportado (-32601), como un servidor de initialize",
		desc.status === 200 && desc.body.error?.code === -32601 && desc.body.result === undefined);
	const ini = (await rpc(env, tok, { jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openai-mcp", version: "1.0.0" } } })).body.result;
	check("tras el -32601, initialize da version, capacidades e instrucciones",
		ini.protocolVersion === "2025-06-18" && Boolean(ini.capabilities.tools) && Boolean(ini.capabilities.resources) &&
		ini.instructions.includes("mycoach_abrir"));
	const iniNuevo = (await rpc(env, tok, { jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {} } })).body.result;
	check("un cliente con una version desconocida recibe la de por defecto", iniNuevo.protocolVersion === "2025-06-18");
	check("la version del servidor lleva la huella de las herramientas (Claude ve que han cambiado)",
		/^1\.1\.0\+[0-9a-f]{8}$/.test(ini.serverInfo.version));
	const bien = env.MYCOACH.fetch;
	env.MYCOACH = { fetch: async () => new Response("caida", { status: 503 }) };
	const caida = await rpc(env, tok, { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "ui://mycoach/app" } });
	check("si la web no responde, se sirve la ultima copia buena", caida.body.result.contents[0].text.includes("<body>myCoach"));
	env.MYCOACH = { fetch: bien };
	check("un recurso que no existe da error", Boolean((await rpc(env, tok, { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "ui://otra" } })).body.error));
	const r = JSON.parse((await rpc(env, tok, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "mycoach_abrir", arguments: { pantalla: "plan" } } })).body.result.content[0].text);
	check("mycoach_abrir devuelve la pantalla pedida", r.abierta === true && r.pantalla === "plan");
}

// ── 15. Fuerza: entrenos con nombre, registro, historico, reloj ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const base = globalThis.fetch;
	const garmin = { creados: [], programados: [], borrados: [], actualizados: [], putFalla: false, siguienteId: 500 };
	const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(url);
		if (u.pathname === "/workout-service/workout" && init.method === "POST") {
			garmin.creados.push(JSON.parse(init.body));
			return new Response(JSON.stringify({ workoutId: garmin.siguienteId++ }));
		}
		if (u.pathname.startsWith("/workout-service/schedule/")) { garmin.programados.push([u.pathname.split("/").pop(), JSON.parse(init.body)]); return new Response("{}"); }
		if (u.pathname.startsWith("/workout-service/workout/") && init.method === "DELETE") { garmin.borrados.push(u.pathname.split("/").pop()); return new Response(null, { status: 204 }); }
		if (u.pathname.startsWith("/workout-service/workout/") && init.method === "PUT") {
			if (garmin.putFalla) return new Response("{}", { status: 404 });
			garmin.actualizados.push([u.pathname.split("/").pop(), JSON.parse(init.body)]); return new Response(null, { status: 204 });
		}
		if (u.pathname === "/activitylist-service/activities/search/activities")
			return new Response(JSON.stringify([
				{ activityId: 77, activityType: { typeKey: "road_biking" }, startTimeLocal: `${HOY} 08:00:00` },
				{ activityId: 99, activityType: { typeKey: "strength_training" }, startTimeLocal: `${HOY} 19:00:00` },
			]));
		if (u.pathname === "/activity-service/activity/99/exerciseSets") {
			const serie = (category, name, reps, weight) => ({ setType: "ACTIVE", repetitionCount: reps, weight, exercises: [{ category, name, probability: 99 }] });
			return new Response(JSON.stringify({ exerciseSets: [
				serie("SQUAT", "GOBLET_SQUAT", 8, 24000), { setType: "REST" }, serie("SQUAT", "GOBLET_SQUAT", 8, 24000), { setType: "REST" }, serie("SQUAT", "GOBLET_SQUAT", 7, 24000),
				serie("DEADLIFT", "ROMANIAN_DEADLIFT", 10, 30000), serie("DEADLIFT", "ROMANIAN_DEADLIFT", 10, 30000),
			] }));
		}
		return base(url, init);
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const llamar = async (name, args = {}) => {
		const r = await rpc(env, ana, { jsonrpc: "2.0", id: 30, method: "tools/call", params: { name, arguments: args } });
		const res = r.body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};

	const busca = await llamar("fuerza_ejercicios_garmin", { buscar: "sentadilla goblet" });
	check("buscar en castellano encuentra el ejercicio de Garmin", busca.ejercicios[0]?.categoria === "SQUAT" && busca.ejercicios[0]?.ejercicio === "GOBLET_SQUAT", JSON.stringify(busca.ejercicios?.slice(0, 3)));
	check("y dice que musculos trabaja, en castellano", busca.ejercicios[0].musculos.includes("cuádriceps"));
	const rumano = await llamar("fuerza_ejercicios_garmin", { buscar: "peso muerto rumano" });
	check("peso muerto rumano", rumano.ejercicios[0]?.ejercicio === "ROMANIAN_DEADLIFT", JSON.stringify(rumano.ejercicios?.slice(0, 3)));

	const malo = await llamar("fuerza_entreno_guardar", { nombre: "X", ejercicios: [{ nombre: "Sentadilla", garmin: { categoria: "SQUAT", ejercicio: "SENTADILLA" } }] });
	check("un ejercicio de Garmin que no existe se rechaza con parecidos", /no esta en el catalogo/.test(malo.error || "") && /SQUAT\//.test(malo.error));

	const pierna = {
		nombre: "Pierna A", lugar: "casa",
		ejercicios: [
			{ nombre: "Sentadilla goblet", series: 3, reps: "8-10", peso_kg: 20, material: "mancuerna", descanso_s: 90, garmin: { categoria: "SQUAT", ejercicio: "GOBLET_SQUAT" } },
			{ nombre: "Peso muerto rumano", series: 3, reps: 10, peso_kg: 30, material: "mancuernas", descanso_s: 90, garmin: { categoria: "DEADLIFT", ejercicio: "ROMANIAN_DEADLIFT" } },
			{ nombre: "Plancha", series: 3, segundos: 40, descanso_s: 45 },
		],
	};
	const g = await llamar("fuerza_entreno_guardar", pierna);
	check("guardar un entreno le da un id por su nombre", g.guardado?.id === "pierna-a");
	check("'8-10' queda como reps 8 y reps_max 10", g.guardado.ejercicios[0].reps === 8 && g.guardado.ejercicios[0].reps_max === 10);
	check("avisa de los ejercicios sin Garmin", /Plancha/.test(g.aviso || ""));

	const sinGarmin = await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "Pierna A", confirm: true });
	check("no se manda al reloj si falta el ejercicio de Garmin", /Plancha/.test(sinGarmin.error || ""));
	pierna.ejercicios[2].garmin = { categoria: "PLANK", ejercicio: "PLANK" };
	await llamar("fuerza_entreno_guardar", pierna);
	const sinPermiso = await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", confirm: false });
	check("mandar al reloj pide confirmacion", /confirmacion/.test(sinPermiso.error || ""));

	const env1 = await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", fecha: HOY, confirm: true });
	const w = garmin.creados[0];
	const g1 = w?.workoutSegments?.[0]?.workoutSteps?.[0];
	check("se crea un entreno de fuerza en Garmin", env1.enviado === true && w.sportType.sportTypeKey === "strength_training" && w.workoutName === "Pierna A");
	check("cada ejercicio es una repeticion de series con reps, peso y descanso",
		g1.type === "RepeatGroupDTO" && g1.numberOfIterations === 3 &&
		g1.workoutSteps[0].category === "SQUAT" && g1.workoutSteps[0].exerciseName === "GOBLET_SQUAT" &&
		g1.workoutSteps[0].endCondition.conditionTypeKey === "reps" && g1.workoutSteps[0].endConditionValue === 8 &&
		g1.workoutSteps[0].weightValue === 20000 && g1.workoutSteps[1].stepType.stepTypeKey === "rest" && g1.workoutSteps[1].endConditionValue === 90,
		JSON.stringify(g1).slice(0, 400));
	check("los pasos van numerados sin repetir", (() => { const o = []; const r = (ps) => ps.forEach((p) => { o.push(p.stepOrder); if (p.workoutSteps) r(p.workoutSteps); }); r(w.workoutSegments[0].workoutSteps); return new Set(o).size === o.length; })());
	const plancha = w.workoutSegments[0].workoutSteps[2].workoutSteps[0];
	check("la plancha va al reloj por tiempo", plancha.endCondition.conditionTypeKey === "time" && plancha.endConditionValue === 40);
	check("y se programa para el dia", garmin.programados[0]?.[0] === "500" && garmin.programados[0][1].date === HOY);
	// Pareja estable: reenviar actualiza el mismo entreno en Garmin y no apila programados
	const otraVezMismo = await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", fecha: HOY, confirm: true });
	check("mandarlo otra vez actualiza el mismo entreno (no crea otro ni borra)",
		otraVezMismo.actualizado === true && otraVezMismo.workout_id === "500" && garmin.creados.length === 1 && garmin.borrados.length === 0 &&
		garmin.actualizados[0]?.[0] === "500" && garmin.actualizados[0][1].workoutId === 500, JSON.stringify(otraVezMismo));
	check("el mismo dia no se programa dos veces", garmin.programados.length === 1);
	const otroDia = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
	await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", fecha: otroDia, confirm: true });
	check("otro dia si se programa, con el mismo entreno", garmin.programados.length === 2 && garmin.programados[1][0] === "500" && garmin.creados.length === 1);
	garmin.putFalla = true;
	const trasBorrarlo = await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", fecha: HOY, confirm: true });
	garmin.putFalla = false;
	check("si Garmin ya no lo tiene, se crea otro y se apunta el nuevo", trasBorrarlo.actualizado === false && trasBorrarlo.workout_id === "501" && garmin.creados.length === 2 && garmin.borrados.includes("500"));

	const lista = (await llamar("entrenos", { tipo: "fuerza" })).fuerza;
	check("la lista de entrenos trae los nombres de ejercicio que ya usa", lista.entrenos[0].nombre === "Pierna A" && lista.nombres_de_ejercicio.includes("Sentadilla goblet"));

	const reg = await llamar("fuerza_registrar", { entreno: "Pierna A", fecha: "2026-09-22", ejercicios: [{ nombre: "Sentadilla goblet", peso_kg: 22 }, { nombre: "Plancha", omitido: true }] });
	const cambios = Object.fromEntries(reg.cambios_frente_al_plan.map((c) => [c.ejercicio, c]));
	check("registrar solo lo que cambio: lo demas, como estaba", cambios["Peso muerto rumano"].estado === "hecho");
	check("el peso que sube se marca", cambios["Sentadilla goblet"].estado === "mas" && /22 kg \(plan 20\)/.test(cambios["Sentadilla goblet"].texto));
	check("lo omitido sale como no hecho", cambios.Plancha.estado === "no_hecho");
	const detalle = await llamar("entrenos", { id: "pierna-a" });
	check("registrar no cambia la plantilla si no se pide", detalle.ejercicios[0].peso_kg === 20);
	check("el plan de un ejercicio de tiempo se escribe en segundos", detalle.ejercicios[2].plan === "3 × 40 s");
	check("el entreno trae la ultima vez de cada ejercicio", detalle.ejercicios[0].ultima?.texto === "3 × 8 · 22 kg" && detalle.ejercicios[0].ultima.fecha === "2026-09-22");
	await llamar("fuerza_registrar", { entreno: "Pierna A", fecha: "2026-09-22", ejercicios: [{ nombre: "Sentadilla goblet", peso_kg: 22 }, { nombre: "Plancha", omitido: true }], actualizar_entreno: true });
	const detalle2 = await llamar("entrenos", { id: "pierna-a" });
	check("con actualizar_entreno, el peso hecho queda para la proxima", detalle2.ejercicios[0].peso_kg === 22 && detalle2.garmin?.desactualizado === true);

	// Un dia de fuerza del plan sin entreno: al mandarlo al reloj para ese dia, queda enlazado.
	await llamar("app_guardar", { doc: "estado/app", datos: { plan: { "2026-10-01": { dep: "fuerza", t: "otros", d: "Pierna en casa", min: 40 } } } });
	await llamar("entreno_enviar_garmin", { tipo: "fuerza", entreno: "pierna-a", fecha: "2026-10-01", confirm: true });
	check("mandar al reloj enlaza el dia de fuerza del plan con su entreno", (await llamar("app_leer", { doc: "estado/app" })).plan["2026-10-01"].entreno === "pierna-a");
	await llamar("app_guardar", { doc: "estado/app", datos: { plan: { "2026-10-01": { dep: "fuerza", t: "otros", d: "Pierna en casa", min: 40 } } } });
	const sinEnlace = await llamar("fuerza_dia", { fecha: "2026-10-01" });
	check("sin enlace en el plan, fuerza_dia encuentra el entreno mandado al reloj ese dia y lo enlaza",
		sinEnlace.entreno?.id === "pierna-a" && (await llamar("app_leer", { doc: "estado/app" })).plan["2026-10-01"].entreno === "pierna-a");

	// El dia de hoy, en el plan, apunta al entreno; el reloj conto las series.
	await llamar("app_guardar", { doc: "estado/app", datos: { plan: { [HOY]: { deporte: "fuerza", titulo: "Pierna A", min: 45, entreno: "pierna-a" } } } });
	const estado = await llamar("app_leer", { doc: "estado/app" });
	check("el plan conserva a que entreno apunta el dia de fuerza", estado.plan[HOY].entreno === "pierna-a" && estado.plan[HOY].dep === "fuerza");
	const dia = await llamar("fuerza_dia", { fecha: HOY });
	check("fuerza_dia cierra la sesion con las series del reloj", dia.hecha?.fuente === "garmin" && dia.hecha.actividad_id === "99");
	const sent = dia.hecha.ejercicios.find((e) => e.clave === "SQUAT/GOBLET_SQUAT");
	check("con los nombres del usuario y el peso en kg", sent?.nombre === "Sentadilla goblet" && sent.series.length === 3 && sent.series[0].peso_kg === 24);
	const cd = Object.fromEntries(dia.cambios_frente_al_plan.map((c) => [c.ejercicio, c]));
	check("y dice que cambio frente al plan", /24 kg \(plan 22\)/.test(cd["Sentadilla goblet"].texto) && /7 reps/.test(cd["Sentadilla goblet"].texto) &&
		/2 series \(plan 3\)/.test(cd["Peso muerto rumano"].texto) && cd.Plancha.estado === "no_hecho", JSON.stringify(dia.cambios_frente_al_plan));
	check("fuerza_dia trae el entreno con su ultima vez anterior", dia.entreno?.id === "pierna-a" && dia.entreno.ejercicios[0].ultima?.fecha === "2026-09-22");
	const otra = await llamar("fuerza_desde_garmin", { fecha: HOY });
	check("leer otra vez la misma actividad no la duplica", otra.registrado && otra.nueva === false);

	const hist = await llamar("fuerza_historial", { ejercicio: "sentadilla" });
	check("el historico de un ejercicio, de lo mas nuevo a lo mas viejo", hist.sesiones.length === 2 && hist.sesiones[0].fecha === HOY && hist.sesiones[0].peso_max === 24);
	check("con su evolucion", /22 kg \(2026-09-22\) → .*24/.test(hist.evolucion || ""), hist.evolucion);
	const todo = await llamar("fuerza_historial");
	check("sin nada, cada ejercicio con su ultima vez", todo.ejercicios.some((e) => e.ejercicio === "Peso muerto rumano" && e.veces === 2));

	check("cada entreno dice cuanto dura, aproximadamente", lista.entrenos[0].min_estimados >= 10 && detalle.min_estimados === lista.entrenos[0].min_estimados);
	// coach_proponer enlaza el dia con su entreno, lo conserva y rechaza uno que no existe
	const dentro2 = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
	const enl = await llamar("coach_proponer", { cambios: { [dentro2]: { dep: "fuerza", t: "otros", d: "Pierna", min: 45, entreno: "Pierna A" } }, porque: "enlazar", guardar: true });
	const planEnl = await llamar("app_leer", { doc: "estado/app" });
	const diaEnl = (planEnl.plan || {})[dentro2] || (planEnl.next || {})[dentro2];
	check("coach_proponer enlaza el dia con su entreno de fuerza", enl.guardado === true && diaEnl?.entreno === "pierna-a", JSON.stringify(enl).slice(0, 300));
	await llamar("coach_proponer", { cambios: { [dentro2]: { dep: "fuerza", t: "otros", d: "Pierna, 40 min", min: 40 } }, porque: "acortar", guardar: true });
	const planEnl2 = await llamar("app_leer", { doc: "estado/app" });
	check("cambiar el dia sin tocar el deporte conserva el entreno", ((planEnl2.plan || {})[dentro2] || (planEnl2.next || {})[dentro2])?.entreno === "pierna-a");
	check("un entreno que no existe se explica", /No hay ningun entreno de fuerza/.test((await llamar("coach_proponer", { cambios: { [dentro2]: { dep: "fuerza", t: "otros", d: "x", min: 30, entreno: "Brazos Z" } }, porque: "x" })).error || ""));
	const dup = await llamar("fuerza_entreno_guardar", { nombre: "Pierna A", nuevo: true, ejercicios: pierna.ejercicios });
	check("crear uno nuevo con un nombre que ya existe no lo pisa", /Ya tienes un entreno/.test(dup.error || ""));
	const copia = await llamar("fuerza_entreno_guardar", { nombre: "Pierna A (copia)", nuevo: true, ejercicios: pierna.ejercicios });
	check("duplicar con otro nombre crea otro entreno", copia.guardado?.id === "pierna-a-copia");
	const renombrado = await llamar("fuerza_entreno_guardar", { id: "pierna-a-copia", nombre: "Pierna B", ejercicios: pierna.ejercicios });
	check("renombrar conserva el id", renombrado.guardado.id === "pierna-a-copia" && renombrado.guardado.nombre === "Pierna B");
	await llamar("fuerza_entreno_guardar", { id: "pierna-a-copia", nombre: "Pierna B", borrar: true });
	const borrado = await llamar("fuerza_entreno_guardar", { nombre: "Pierna A", borrar: true });
	check("un entreno se puede borrar", borrado.borrado === "pierna-a" && !(await llamar("entrenos")).fuerza.entrenos.length);
	globalThis.fetch = base;
}

// ── 16. Entrenos de bici y correr para el reloj ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const base = globalThis.fetch;
	const garmin = { creados: [], programados: [] };
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(url);
		if (u.pathname === "/workout-service/workout" && init.method === "POST") { garmin.creados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ workoutId: 900 + garmin.creados.length })); }
		if (u.pathname.startsWith("/workout-service/schedule/")) { garmin.programados.push(JSON.parse(init.body)); return new Response("{}"); }
		if (u.pathname.startsWith("/workout-service/workout/") && init.method === "DELETE") return new Response(null, { status: 204 });
		return base(url, init);
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const llamar = async (name, args = {}) => {
		const res = (await rpc(env, ana, { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name, arguments: args } })).body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};
	const series = {
		nombre: "5 × 4 min umbral", deporte: "bici", fecha: "2026-10-02", nota: "Umbral para subir el FTP.",
		pasos: [
			{ tipo: "calentamiento", duracion_s: 900, objetivo: { tipo: "fc", zona: 2 } },
			{ repetir: 5, pasos: [
				{ tipo: "intervalo", duracion_s: 240, objetivo: { tipo: "potencia", min: 300, max: 280 } },
				{ tipo: "recuperacion", duracion_s: 180, objetivo: { tipo: "fc", min: 110, max: 125 } },
			] },
			{ tipo: "vuelta_calma", duracion_s: 600 },
		],
	};
	const vista = await llamar("entreno_enviar_garmin", { tipo: "cardio", ...series });
	check("sin confirm, solo la vista previa: no escribe en Garmin", vista.escrito === false && garmin.creados.length === 0);
	check("la vista previa se lee: series y objetivos", vista.vista_previa.pasos.includes("5 ×") && vista.vista_previa.pasos.some((l) => /Serie: 4 min · 280-300 W/.test(l)) && vista.vista_previa.min_estimados === 60, JSON.stringify(vista.vista_previa));
	const malo = await llamar("entreno_enviar_garmin", { tipo: "cardio", ...series, pasos: [{ tipo: "intervalo", duracion_s: 60, objetivo: { tipo: "ritmo", min: "rapido", max: "4:00" } }] });
	check("un ritmo mal escrito se explica", /min\/km/.test(malo.error || ""));
	await llamar("app_guardar", { doc: "estado/app", datos: { plan: { "2026-10-02": { dep: "bici", t: "int", d: "Series", min: 60 } } } });
	const ok = await llamar("entreno_enviar_garmin", { tipo: "cardio", ...series, confirm: true });
	const w = garmin.creados[0];
	const pasos = w.workoutSegments[0].workoutSteps;
	check("se crea un entreno de ciclismo en Garmin", ok.enviado === true && w.sportType.sportTypeKey === "cycling" && w.workoutName === "5 × 4 min umbral");
	check("calentamiento por tiempo con zona de pulso del reloj",
		pasos[0].stepType.stepTypeKey === "warmup" && pasos[0].endConditionValue === 900 && pasos[0].targetType.workoutTargetTypeKey === "heart.rate.zone" && pasos[0].zoneNumber === 2);
	const bloque = pasos[1];
	check("las series son una repeticion con potencia y recuperacion por pulso",
		bloque.type === "RepeatGroupDTO" && bloque.numberOfIterations === 5 &&
		bloque.workoutSteps[0].targetType.workoutTargetTypeKey === "power.zone" && bloque.workoutSteps[0].targetValueOne === 280 && bloque.workoutSteps[0].targetValueTwo === 300 &&
		bloque.workoutSteps[1].stepType.stepTypeKey === "recovery" && bloque.workoutSteps[1].targetValueOne === 110, JSON.stringify(bloque).slice(0, 300));
	check("los pasos van numerados sin repetir", (() => { const o = []; const r = (ps) => ps.forEach((p) => { o.push(p.stepOrder); if (p.workoutSteps) r(p.workoutSteps); }); r(pasos); return new Set(o).size === o.length; })());
	check("se programa para el dia y enlaza el dia de bici del plan", garmin.programados[0].date === "2026-10-02" && ok.enlazado_al_plan === true &&
		(await llamar("app_leer", { doc: "estado/app" })).plan["2026-10-02"].entreno_cardio === "5-4-min-umbral");

	const carrera = await llamar("entreno_enviar_garmin", { tipo: "cardio", nombre: "Tempo 3 km", deporte: "correr", confirm: true, pasos: [
		{ tipo: "calentamiento", distancia_m: 2000 },
		{ tipo: "intervalo", distancia_m: 3000, objetivo: { tipo: "ritmo", min: "4:20", max: "4:40" } },
		{ tipo: "vuelta_calma" },
	] });
	const c = garmin.creados[1].workoutSegments[0].workoutSteps;
	check("correr: distancia en metros, ritmo como velocidad (lento primero) y 'hasta pulsar vuelta'",
		carrera.enviado && garmin.creados[1].sportType.sportTypeKey === "running" && c[1].endCondition.conditionTypeKey === "distance" && c[1].endConditionValue === 3000 &&
		c[1].targetType.workoutTargetTypeKey === "pace.zone" && c[1].targetValueOne < c[1].targetValueTwo && Math.abs(c[1].targetValueTwo - 1000 / 260) < 0.01 &&
		c[2].endCondition.conditionTypeKey === "lap.button", JSON.stringify(c[1]));
	const lista = await llamar("entrenos", { tipo: "cardio" });
	check("los entrenos quedan guardados para repetirlos", lista.cardio.length === 2 && lista.cardio.some((e) => e.id === "tempo-3-km" && e.deporte === "correr"));
	const otra = await llamar("entreno_enviar_garmin", { tipo: "cardio", id: "tempo-3-km", fecha: "2026-10-09", confirm: true });
	check("repetir uno guardado solo con su id y la fecha", otra.enviado && garmin.programados.at(-1).date === "2026-10-09");
	globalThis.fetch = base;
}

// ── 17. Peso: a Garmin y de Garmin ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const base = globalThis.fetch;
	const subidos = [];
	// Garmin ya tiene un pesaje del 2026-09-20 (de la bascula, en gramos).
	const enGarmin = [{ summaryDate: "2026-09-20", latestWeight: { weight: 71400, calendarDate: "2026-09-20" } }];
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(url);
		if (u.pathname.startsWith("/weight-service/weight/range/")) {
			const [, , , , ini, fin] = u.pathname.split("/");
			const todos = [...enGarmin, ...subidos.map((b) => ({ summaryDate: b.dateTimestamp.slice(0, 10), latestWeight: { weight: b.value * 1000 } }))];
			return new Response(JSON.stringify({ dailyWeightSummaries: todos.filter((d) => d.summaryDate >= ini && d.summaryDate <= fin) }));
		}
		if (u.pathname === "/weight-service/user-weight" && init.method === "POST") { subidos.push(JSON.parse(init.body)); return new Response(""); }
		return base(url, init);
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const llamar = async (name, args = {}) => {
		const res = (await rpc(env, ana, { jsonrpc: "2.0", id: 41, method: "tools/call", params: { name, arguments: args } })).body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};
	const lote = { pesajes: [{ fecha: "2026-09-20", kg: 71.4 }, { fecha: "2026-09-22", kg: "71,1" }, { fecha: "2026-09-25", hora: "07:30", kg: 70.8 }] };
	const vista = await llamar("peso_registrar", lote);
	check("peso: sin confirm, vista previa y nada escrito", vista.escrito === false && vista.vista_previa.nuevos === 2 && vista.vista_previa.ya_estaban === 1 && subidos.length === 0, JSON.stringify(vista));
	const ok = await llamar("peso_registrar", { ...lote, confirm: true });
	check("peso: con confirm sube solo los nuevos", ok.subidos === 2 && subidos.length === 2 && subidos[1].value === 70.8 && subidos[0].value === 71.1, JSON.stringify(ok));
	check("peso: hora local de España y su hora en UTC, como lo pide Garmin",
		subidos[1].dateTimestamp === "2026-09-25T07:30:00.00" && subidos[1].gmtTimestamp === "2026-09-25T05:30:00.00" && subidos[1].unitKey === "kg" && subidos[1].sourceType === "MANUAL", JSON.stringify(subidos[1]));
	const dos = await llamar("peso_registrar", { kg: "70,85", fecha: "2026-09-27", confirm: true });
	check("peso: dos decimales, como da la bascula", dos.subidos === 1 && subidos.at(-1).value === 70.85, JSON.stringify(subidos.at(-1)));
	check("peso: un valor raro se explica", /no parece un peso/.test((await llamar("peso_registrar", { kg: 7, confirm: true })).error || ""));
	check("peso: nada de fechas futuras", /futura/.test((await llamar("peso_registrar", { kg: 70, fecha: "2999-01-01" })).error || ""));
	const hist = await llamar("peso_historico", { dias: 3650 });
	check("peso_historico: un pesaje por dia, en kg y ordenados, con sus dos decimales", hist.pesajes.length === 4 && hist.pesajes[0].kg === 71.4 && hist.pesajes.at(-1).kg === 70.85, JSON.stringify(hist.pesajes));
	check("peso_historico: ultimo y media de 7 dias", hist.resumen.ultimo.kg === 70.85 && hist.resumen.media_7_dias === 70.9, JSON.stringify(hist.resumen));
	globalThis.fetch = base;
}

// ── 18. Importar entrenos de Garmin Connect ──
{
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } } });
	const base = globalThis.fetch;
	const lista = [
		{ workoutId: 11, workoutName: "Pecho gym", sportType: { sportTypeKey: "strength_training" } },
		{ workoutId: 12, workoutName: "Rodillo 4x8", sportType: { sportTypeKey: "cycling" } },
		{ workoutId: 13, workoutName: "Natacion", sportType: { sportTypeKey: "lap_swimming" } },
		{ workoutId: 14, workoutName: "myCoach · Pierna A", sportType: { sportTypeKey: "strength_training" } },
	];
	const detalle = {
		11: { workoutSegments: [{ workoutSteps: [{ type: "RepeatGroupDTO", numberOfIterations: 4, workoutSteps: [
			{ type: "ExecutableStepDTO", stepType: { stepTypeKey: "interval" }, category: "BENCH_PRESS", exerciseName: "BARBELL_BENCH_PRESS", endCondition: { conditionTypeKey: "reps" }, endConditionValue: 8, weightValue: 60000 },
			{ type: "ExecutableStepDTO", stepType: { stepTypeKey: "rest" }, endCondition: { conditionTypeKey: "time" }, endConditionValue: 120 }] }] }] },
		12: { workoutSegments: [{ workoutSteps: [
			{ type: "ExecutableStepDTO", stepType: { stepTypeKey: "warmup" }, endCondition: { conditionTypeKey: "time" }, endConditionValue: 600, targetType: { workoutTargetTypeKey: "heart.rate.zone" }, zoneNumber: 2 },
			{ type: "RepeatGroupDTO", numberOfIterations: 4, workoutSteps: [
				{ type: "ExecutableStepDTO", stepType: { stepTypeKey: "interval" }, endCondition: { conditionTypeKey: "time" }, endConditionValue: 480, targetType: { workoutTargetTypeKey: "power.zone" }, targetValueOne: 250, targetValueTwo: 270 },
				{ type: "ExecutableStepDTO", stepType: { stepTypeKey: "recovery" }, endCondition: { conditionTypeKey: "time" }, endConditionValue: 240 }] }] }] },
	};
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(url);
		if (u.pathname === "/workout-service/workouts") return new Response(JSON.stringify(lista));
		const m = u.pathname.match(/^\/workout-service\/workout\/(\d+)$/);
		if (m && (!init.method || init.method === "GET")) return new Response(JSON.stringify(detalle[m[1]] || {}));
		return base(url, init);
	};
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const llamar = async (name, args = {}) => {
		const res = (await rpc(env, ana, { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name, arguments: args } })).body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};
	const vista = await llamar("entrenos_desde_garmin");
	check("importar: vista previa con fuerza y bici, sin natacion ni los de myCoach", vista.escrito === false && vista.nuevos.length === 2, JSON.stringify(vista));
	const imp = await llamar("entrenos_desde_garmin", { confirm: true });
	check("importar: entran los dos", imp.importados.length === 2 && imp.fallidos.length === 0, JSON.stringify(imp));
	const pecho = (await llamar("entrenos", { id: "pecho-gym", tipo: "fuerza" }));
	const e0 = pecho.ejercicios?.[0] || {};
	check("fuerza importada: series, reps, kg, descanso y ejercicio de Garmin", e0.series === 4 && e0.reps === 8 && e0.peso_kg === 60 && e0.descanso_s === 120 && e0.garmin?.ejercicio === "BARBELL_BENCH_PRESS" && pecho.garmin?.workout_id === "11", JSON.stringify(pecho).slice(0, 300));
	const rod = await llamar("entrenos", { id: "rodillo-4x8" });
	check("bici importada: series con potencia y zona de pulso", rod.resumen.includes("4 ×") && rod.resumen.some((l) => /250-270 W/.test(l)) && /zona 2/.test(rod.resumen[0]), JSON.stringify(rod.resumen));
	const otra = await llamar("entrenos_desde_garmin");
	check("importar otra vez no duplica", otra.nuevos.length === 0);
	globalThis.fetch = base;
}

// ── 19. Plan de comidas: la semana de comidas va como la de entrenos ──
{
	const fechaMadrid = (d = new Date()) =>
		new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
	const HOY_C = fechaMadrid();
	const mas = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
	const lunes = (() => { const d = new Date(`${HOY_C}T12:00:00Z`); return mas(HOY_C, -((d.getUTCDay() + 6) % 7)); })();
	const L = mas(lunes, 7); // la semana que viene: entera por delante
	mockGarmin({ "ana@x.com": { password: "a", data: { displayName: "ana", hrv: 50 } }, "bob@x.com": { password: "b", data: { displayName: "bob", hrv: 60 } } });
	const env = makeEnv();
	const ana = (await connect(env, "ana@x.com", "a")).tokens.access_token;
	const bob = (await connect(env, "bob@x.com", "b")).tokens.access_token;
	const llamar = async (token, name, args = {}) => {
		const res = (await rpc(env, token, { jsonrpc: "2.0", id: 50, method: "tools/call", params: { name, arguments: args } })).body.result;
		return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
	};
	// Semana que viene: series el martes y fondo de 3 h el sábado.
	const next = { [mas(L, 1)]: { dep: "bici", t: "int", d: "Series 5 x 4 min", min: 60 }, [mas(L, 5)]: { dep: "bici", t: "fondo", d: "Fondo largo", min: 180 }, [mas(L, 3)]: { dep: "correr", t: "rec", d: "Rodaje", min: 40 } };
	await llamar(ana, "app_guardar", { doc: "estado/app", datos: { plan: {}, next, goal: { modo: "forma" }, sports: ["bici", "correr"] } });

	const vacio = await llamar(ana, "comida_plan", { semana: "siguiente" });
	check("comida_plan: siete días con la carga sacada del plan de entrenos",
		vacio.lunes === L && vacio.dias.length === 7 && vacio.dias[5].carga.nivel === "duro" && vacio.dias[1].carga.nivel === "duro" && vacio.dias[3].carga.nivel === "suave", JSON.stringify(vacio.dias.map((d) => d.carga)));
	check("comida_plan: hidrato alto el día duro y en la cena de la víspera del fondo",
		vacio.dias[5].comidas.comida.hidrato === "alto" && vacio.dias[4].comidas.cena.hidrato === "alto" && vacio.dias[4].comidas.comida.hidrato === "bajo"
		&& vacio.dias[4].comidas.cena.por_que.includes("3 h") && vacio.dias[3].comidas.cena.cuartos_hidrato === "1", JSON.stringify(vacio.dias[4].comidas));
	check("comida_plan: sin preferencias, pregunta antes de proponer", vacio.antes_de_proponer.length === 4 && vacio.planeadas === "0 de 28 comidas");

	// El perfil de comida se mezcla por dentro.
	await llamar(ana, "coach_perfil_guardar", { cambios: { nutricion: { alergias: ["marisco"], no_gustos: ["coliflor"] } } });
	const perf = await llamar(ana, "coach_perfil_guardar", { cambios: { nutricion: { tiempo_min: 30, para_cuantos: 2 } } });
	check("perfil: nutricion se mezcla y no borra las alergias", perf.perfil.nutricion.alergias[0] === "marisco" && perf.perfil.nutricion.tiempo_min === 30, JSON.stringify(perf.perfil.nutricion));
	check("perfil: nutricion valida las listas", Boolean((await llamar(ana, "coach_perfil_guardar", { cambios: { nutricion: { alergias: "marisco" } } })).error));

	// Platos: lo que no se sabe queda como desconocido.
	const lent = await llamar(ana, "comida_plato_guardar", {
		nombre: "Lentejas con verduras", carbohidrato: 2, proteina: 1, verdura: 1, grupo: "legumbre", tupper: true, momentos: ["comida", "cena"],
		ingredientes: [{ nombre: "Lentejas", cantidad: "80 g", pasillo: "despensa" }, { nombre: "Zanahoria", cantidad: "1", pasillo: "fruta y verdura" }],
		nutrientes: { hc_g: 48, prot_g: 19, sal_g: "desconocido" },
	});
	check("plato: se guarda con id y los nutrientes que faltan como desconocido",
		lent.guardado && lent.plato.id === "lentejas-con-verduras" && lent.plato.nutrientes.hc_g === 48 && lent.plato.nutrientes.sal_g === "desconocido" && lent.plato.nutrientes.kcal === "desconocido" && lent.plato.nutrientes_son === "estimados por Claude", JSON.stringify(lent.plato));
	const corr = await llamar(ana, "comida_plato_guardar", { id: "lentejas-con-verduras", nutrientes: { kcal: 420 }, nutrientes_origen: "usuario" });
	check("plato: corregir conserva lo que no se pasa", corr.corregido && corr.plato.nutrientes.hc_g === 48 && corr.plato.nutrientes.kcal === 420 && corr.plato.ingredientes.length === 2, JSON.stringify(corr.plato));
	check("plato: los cuartos no pasan de 4", Boolean((await llamar(ana, "comida_plato_guardar", { nombre: "Raro", carbohidrato: 3, proteina: 2, verdura: 0 })).error));
	check("plato: un nutriente tiene que ser número o desconocido", Boolean((await llamar(ana, "comida_plato_guardar", { nombre: "Raro", carbohidrato: 1, proteina: 1, verdura: 1, nutrientes: { hc_g: "mucho" } })).error));
	await llamar(ana, "comida_plato_guardar", { nombre: "Paella de marisco", carbohidrato: 2, proteina: 1, verdura: 1, grupo: "pescado", ingredientes: [{ nombre: "Arroz" }, { nombre: "Gambas" }], alergenos: ["marisco", "crustaceos"] });
	const lista = await llamar(ana, "comida_platos", { momento: "comida" });
	check("comida_platos: lista con cuartos y cuántos nutrientes se conocen", lista.total === 2 && lista.platos[0].nombre === "Lentejas con verduras" && lista.platos[0].nutrientes_conocidos === "3 de 6", JSON.stringify(lista));
	check("comida_platos: con id, el detalle", (await llamar(ana, "comida_platos", { id: "Lentejas con verduras" })).ingredientes.length === 2);
	check("los platos son de cada uno", (await llamar(bob, "comida_platos")).total === 0);

	// Proponer: sin guardar, el antes y después; las alergias no se guardan.
	const prop = await llamar(ana, "comida_proponer", {
		porque: "Semana con fondo el sábado",
		cambios: {
			[mas(L, 4)]: { cena: { descripcion: "Ensalada de pollo", carbohidrato: 0, proteina: 2, verdura: 2 } },
			[mas(L, 2)]: { comida: { plato_id: "lentejas-con-verduras" } },
			[mas(L, 3)]: { comida: { plato_id: "lentejas-con-verduras" } },
		},
	});
	check("comida_proponer: sin guardar devuelve antes y después", prop.guardado === false && prop.valido && prop.cambios.length === 3 && prop.cambios.every((c) => c.antes === null), JSON.stringify(prop));
	const av = prop.semanas[0].avisos;
	check("comida_proponer: avisa del hidrato bajo en la víspera del fondo", av.some((a) => a.regla === "hidrato" && a.fecha === mas(L, 4) && a.momento === "cena"), JSON.stringify(av));
	check("comida_proponer: las sobras de un plato de tupper al día siguiente no cuentan como repetir", !av.some((a) => a.regla === "repetido"), JSON.stringify(av));
	check("comida_proponer: no guarda sin el sí", (await llamar(ana, "comida_plan", { semana: "siguiente" })).planeadas === "0 de 28 comidas");
	const alergia = await llamar(ana, "comida_proponer", { porque: "x", guardar: true, cambios: { [mas(L, 6)]: { comida: { plato_id: "paella-de-marisco" } } } });
	check("comida_proponer: un plato con su alergia no se guarda", alergia.guardado === false && alergia.semanas[0].errores.some((e) => e.regla === "alergia"), JSON.stringify(alergia));
	const noGusta = await llamar(ana, "comida_proponer", { porque: "x", cambios: { [mas(L, 6)]: { cena: { descripcion: "Coliflor gratinada", carbohidrato: 1, proteina: 1, verdura: 2 } } } });
	check("comida_proponer: lo que no le gusta tampoco", noGusta.valido === false && noGusta.semanas[0].errores[0].regla === "no_le_gusta");
	const sinSaber = await llamar(ana, "comida_proponer", { porque: "x", cambios: { [mas(L, 6)]: { cena: { descripcion: "Arroz tres delicias", carbohidrato: 2, proteina: 1, verdura: 1 } } } });
	check("comida_proponer: si no sabe lo que lleva, pide confirmarlo", sinSaber.valido && sinSaber.semanas[0].avisos.some((a) => a.regla === "alergia_sin_saber"), JSON.stringify(sinSaber.semanas[0].avisos));
	check("comida_proponer: un plato que no existe da error", Boolean((await llamar(ana, "comida_proponer", { porque: "x", cambios: { [mas(L, 6)]: { cena: { plato_id: "no-existe" } } } })).error));
	check("comida_proponer: sin cuartos ni plato da error", Boolean((await llamar(ana, "comida_proponer", { porque: "x", cambios: { [mas(L, 6)]: { cena: { descripcion: "Algo" } } } })).error));
	check("comida_proponer: nada de días pasados", Boolean((await llamar(ana, "comida_proponer", { porque: "x", cambios: { [mas(lunes, -1)]: { cena: null } } })).error));

	const guardado = await llamar(ana, "comida_proponer", {
		porque: "Semana con fondo el sábado", guardar: true,
		cambios: { [mas(L, 4)]: { cena: { descripcion: "Pasta con atún", carbohidrato: 2, proteina: 1, verdura: 1 } }, [mas(L, 2)]: { comida: { plato_id: "lentejas-con-verduras" } } },
	});
	check("comida_proponer: con el sí se guarda", guardado.guardado === true && guardado.cambios.length === 2, JSON.stringify(guardado));
	const plan = await llamar(ana, "comida_plan", { semana: mas(L, 3), lista_compra: true });
	check("comida_plan: lo guardado sale en su día", plan.planeadas === "2 de 28 comidas" && plan.dias[4].comidas.cena.plan.descripcion === "Pasta con atún" && plan.dias[2].comidas.comida.plan.plato_id === "lentejas-con-verduras", JSON.stringify(plan.dias[4].comidas.cena));
	const compra = plan.lista_compra;
	check("lista de la compra: por pasillo, y lo que no tiene ingredientes aparte",
		compra.pasillos.some((p) => p.pasillo === "despensa" && p.ingredientes[0].nombre === "Lentejas" && p.ingredientes[0].cantidades[0] === "80 g") && compra.sin_ingredientes.some((x) => x.includes("Pasta con atún")), JSON.stringify(compra));
	const dec = await llamar(ana, "app_leer", { doc: "coach/decisiones" });
	check("el cambio queda en las decisiones con su porqué", JSON.stringify(dec).includes("Semana con fondo el sábado") && JSON.stringify(dec).includes("\"comida\""));

	// La agenda dice qué comidas son fuera de casa.
	await llamar(ana, "agenda_anotar", { fecha: mas(L, 6), de: "21:00", a: "23:30", titulo: "Cena con amigos", tipo: "social", guardar: true });
	const conAgenda = await llamar(ana, "comida_plan", { semana: "siguiente" });
	check("comida_plan: la cena con amigos sale como comida fuera", conAgenda.dias[6].comidas.cena.fuera === "Cena con amigos" && !conAgenda.dias[6].comidas.comida.fuera, JSON.stringify(conAgenda.dias[6].comidas));

	// Registrar: con un plato guardado, y guardar una comida como plato.
	const reg = await llamar(ana, "comida_registrar", { tipo: "comida", plato_id: "lentejas-con-verduras", hora: "14:00" });
	check("comida_registrar con plato_id toma sus cuartos y su nombre", reg.comida.carbohidrato === 2 && reg.comida.descripcion === "Lentejas con verduras", JSON.stringify(reg));
	const reg2 = await llamar(ana, "comida_registrar", { tipo: "cena", carbohidrato: 1, proteina: 2, verdura: 1, descripcion: "Tortilla de patatas", guardar_como_plato: true });
	check("comida_registrar puede guardarla como plato", reg2.plato_guardado?.id === "tortilla-de-patatas" && (await llamar(ana, "comida_platos", { id: "tortilla-de-patatas" })).momentos[0] === "cena", JSON.stringify(reg2));
	await llamar(ana, "comida_proponer", { porque: "x", guardar: true, cambios: { [HOY_C]: { merienda: { descripcion: "Yogur con fruta", carbohidrato: 1, proteina: 1, verdura: 0 } } } });
	const prev = await llamar(ana, "comida_registrar", { tipo: "merienda", del_plan: true });
	check("comida_registrar del_plan registra lo previsto", prev.comida?.descripcion === "Yogur con fruta" && prev.comida.proteina === 1, JSON.stringify(prev));
	check("comida_registrar del_plan sin nada previsto da error", Boolean((await llamar(ana, "comida_registrar", { tipo: "cena", del_plan: true })).error));

	// Borrar un plato
	const borr = await llamar(ana, "comida_plato_guardar", { id: "paella-de-marisco", borrar: true });
	check("plato: borrar lo quita", borr.borrado && (await llamar(ana, "comida_platos")).total === 2);
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
