import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

interface Env {
	TURNSTILE_SECRET_KEY: string;
	TO_EMAIL: string;
	FROM_EMAIL: string;
	MAIL: SendEmail;
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
	},
};

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
