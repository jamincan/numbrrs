/**
 * Write a client-side preference cookie: long-lived, Lax, sent to every path,
 * and Secure whenever the page itself came over HTTPS (so plain-http local
 * dev still works).
 */
export function rememberCookie(name: string, value: string, maxAge: number) {
	const secure = location.protocol === 'https:' ? '; secure' : '';
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
