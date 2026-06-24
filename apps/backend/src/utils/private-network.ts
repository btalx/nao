import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard helpers used when executing untrusted project content (custom
 * chart plugins) inside a server-side headless browser. They block requests
 * that target loopback/private/link-local/reserved addresses — in particular
 * the cloud metadata endpoint (169.254.169.254) and internal services.
 */

/** True when `ip` is a loopback, private, link-local, or otherwise reserved address. */
export function isPrivateOrReservedIp(ip: string): boolean {
	const version = isIP(ip);
	if (version === 4) {
		return isPrivateIpv4(ip);
	}
	if (version === 6) {
		return isPrivateIpv6(ip);
	}
	// Not a literal IP — treat as unknown/unsafe.
	return true;
}

/**
 * Resolves `hostname` and returns true if it is empty, an unsafe literal IP, or
 * resolves (via DNS) to any private/reserved address. Fails closed on lookup
 * errors so an attacker cannot bypass the guard by forcing resolution to fail.
 */
export async function resolvesToPrivateHost(hostname: string): Promise<boolean> {
	if (!hostname) {
		return true;
	}
	const normalized = stripBrackets(hostname).toLowerCase();
	if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
		return true;
	}
	if (isIP(normalized)) {
		return isPrivateOrReservedIp(normalized);
	}
	try {
		const records = await lookup(normalized, { all: true });
		if (records.length === 0) {
			return true;
		}
		return records.some((record) => isPrivateOrReservedIp(record.address));
	} catch {
		return true;
	}
}

function stripBrackets(hostname: string): string {
	return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isPrivateIpv4(ip: string): boolean {
	const octets = ip.split('.').map(Number);
	if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
		return true;
	}
	const [a, b] = octets;
	if (a === 0 || a === 10 || a === 127) {
		return true; // "this" network, private, loopback
	}
	if (a === 100 && b >= 64 && b <= 127) {
		return true; // 100.64.0.0/10 carrier-grade NAT
	}
	if (a === 169 && b === 254) {
		return true; // 169.254.0.0/16 link-local (cloud metadata)
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true; // 172.16.0.0/12
	}
	if (a === 192 && b === 168) {
		return true; // 192.168.0.0/16
	}
	if (a === 198 && (b === 18 || b === 19)) {
		return true; // 198.18.0.0/15 benchmarking
	}
	if (a >= 224) {
		return true; // multicast + reserved
	}
	return false;
}

function isPrivateIpv6(ip: string): boolean {
	const address = ip.toLowerCase();
	if (address === '::1' || address === '::') {
		return true; // loopback / unspecified
	}
	// IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
	const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) {
		return isPrivateIpv4(mapped[1]);
	}
	const firstHextet = parseInt(address.split(':')[0] || '0', 16);
	if ((firstHextet & 0xfe00) === 0xfc00) {
		return true; // fc00::/7 unique local
	}
	if ((firstHextet & 0xffc0) === 0xfe80) {
		return true; // fe80::/10 link-local
	}
	if ((firstHextet & 0xff00) === 0xff00) {
		return true; // ff00::/8 multicast
	}
	return false;
}
