import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

interface Env {
	TURNSTILE_SECRET_KEY: string;
	TO_EMAIL: string;
	FROM_EMAIL: string;
	MAIL: SendEmail;
	PORTFOLIO_KV: KVNamespace;
	TRAILS_TOKEN: string;
}

interface SendEmail {
	send(message: EmailMessage): Promise<void>;
}

const THANKS_URL = "https://luhadiagarvit.me/contact/thanks/";
const CORS_ORIGIN = "https://luhadiagarvit.me";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders() });
		}
		const url = new URL(request.url);
		if (url.pathname === "/api/contact") return handleContact(request, env);
		if (url.pathname === "/api/trails") return handleTrails(request, env);
		if (url.pathname === "/api/streak") return handleStreak(request, env);
		return new Response("Not found", { status: 404 });
	},
};

async function handleContact(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const contentType = request.headers.get("content-type") ?? "";
	let token: string | null = null;
	let name = "";
	let fromEmail = "";
	let message = "";

	if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
		const form = await request.formData();
		token = form.get("cf-turnstile-response")?.toString() ?? null;
		name = (form.get("name")?.toString() ?? "").trim();
		fromEmail = (form.get("email")?.toString() ?? "").trim();
		message = (form.get("message")?.toString() ?? "").trim();
	} else if (contentType.includes("application/json")) {
		const body = (await request.json()) as Record<string, unknown>;
		token = typeof body.token === "string" ? body.token : null;
		name = typeof body.name === "string" ? body.name.trim() : "";
		fromEmail = typeof body.email === "string" ? body.email.trim() : "";
		message = typeof body.message === "string" ? body.message.trim() : "";
	} else {
		return json({ error: "Unsupported content type" }, 415);
	}

	if (!token) return json({ error: "Missing captcha" }, 400);
	if (!name || !fromEmail || !message) return json({ error: "Missing fields" }, 400);
	if (name.length > 100 || fromEmail.length > 200 || message.length > 5000) {
		return json({ error: "Field too long" }, 400);
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
		return json({ error: "Invalid email" }, 400);
	}

	const ip = request.headers.get("CF-Connecting-IP") ?? "";
	const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
	});
	const verify = (await verifyRes.json()) as { success: boolean; "error-codes"?: string[] };
	if (!verify.success) return json({ error: "Captcha failed" }, 400);

	const mime = createMimeMessage();
	mime.setSender({ name: "luhadiagarvit.me contact form", addr: env.FROM_EMAIL });
	mime.setRecipient(env.TO_EMAIL);
	mime.setSubject(`luhadiagarvit.me contact — ${name}`);
	mime.setHeader("Reply-To", `${name} <${fromEmail}>`);
	mime.addMessage({
		contentType: "text/plain",
		data: `From: ${name} <${fromEmail}>\nIP: ${ip}\n\n${message}\n`,
	});

	const email = new EmailMessage(env.FROM_EMAIL, env.TO_EMAIL, mime.asRaw());
	try {
		await env.MAIL.send(email);
	} catch {
		return json({ error: "Send failed" }, 502);
	}

	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("application/json")) {
		return json({ ok: true }, 200);
	}
	return Response.redirect(THANKS_URL, 303);
}

async function handleTrails(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
	if (!verifyBearer(request, env.TRAILS_TOKEN)) return json({ error: "unauthorized" }, 401);
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "invalid json" }, 400);
	}
	const slug = typeof body.slug === "string" ? body.slug : null;
	const date = typeof body.date === "string" ? body.date : null;
	if (!slug || !date) return json({ error: "missing slug or date" }, 400);
	for (const f of ["name", "park", "km", "ascent_m", "duration_min", "elevation_profile"] as const) {
		if (!(f in body)) return json({ error: `missing ${f}` }, 400);
	}
	if (!Array.isArray((body as { elevation_profile?: unknown }).elevation_profile)) {
		return json({ error: "elevation_profile must be array" }, 400);
	}
	const key = `trails:${date}:${slug}`;
	await env.PORTFOLIO_KV.put(key, JSON.stringify(body));
	return json({ ok: true, key }, 200);
}

async function handleStreak(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
	if (!verifyBearer(request, env.TRAILS_TOKEN)) return json({ error: "unauthorized" }, 401);
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "invalid json" }, 400);
	}
	const value = typeof body.value === "number" ? body.value : null;
	const updated = typeof body.updated === "string" ? body.updated : null;
	if (value === null || !updated) return json({ error: "missing value or updated" }, 400);
	await env.PORTFOLIO_KV.put("streak:current", JSON.stringify({ value, updated }));
	return json({ ok: true }, 200);
}

function verifyBearer(request: Request, expected: string): boolean {
	if (!expected) return false;
	const auth = request.headers.get("authorization") ?? "";
	const m = auth.match(/^Bearer\s+(.+)$/i);
	return !!m && m[1] === expected;
}

function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": CORS_ORIGIN,
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	};
}

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders() },
	});
}
