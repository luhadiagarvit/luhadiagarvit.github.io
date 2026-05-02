import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
	const { pathname, search } = context.url;
	let target: string | null = null;
	if (pathname === "/posts" || pathname === "/posts/") target = "/notes/";
	else if (pathname.startsWith("/posts/")) target = "/notes/" + pathname.slice("/posts/".length);
	else if (pathname === "/tags" || pathname === "/tags/") target = "/notes/tag/";
	else if (pathname.startsWith("/tags/")) target = "/notes/tag/" + pathname.slice("/tags/".length);
	if (target) return context.redirect(target + search, 301);
	return next();
});
