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
 * Resolves `hostname` to a single public IP literal to connect to, or returns
 * `null` when the host is empty, a `localhost` alias, an unsafe literal IP, or
 * resolves (via DNS) to any private/reserved address.
 *
 * Callers MUST connect to the returned IP rather than re-resolving `hostname`
 * themselves: pinning the validated address is what closes the DNS-rebinding
 * (TOCTOU) gap where a name resolves to a public IP during the check and to a
 * private IP at connection time. Fails closed on lookup errors.
 */
export async function resolvePublicAddress(hostname: string): Promise<string | null> {
	if (!hostname) {
		return null;
	}
	const normalized = stripBrackets(hostname).toLowerCase();
	if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
		return null;
	}
	if (isIP(normalized)) {
		return isPrivateOrReservedIp(normalized) ? null : normalized;
	}
	try {
		const records = await lookup(normalized, { all: true });
		if (records.length === 0) {
			return null;
		}
		if (records.some((record) => isPrivateOrReservedIp(record.address))) {
			return null;
		}
		return records[0].address;
	} catch {
		return null;
	}
}

/**
 * Resolves `hostname` and returns true if it is empty, an unsafe literal IP, or
 * resolves (via DNS) to any private/reserved address. Fails closed on lookup
 * errors so an attacker cannot bypass the guard by forcing resolution to fail.
 */
export async function resolvesToPrivateHost(hostname: string): Promise<boolean> {
	return (await resolvePublicAddress(hostname)) === null;
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
	const groups = expandIpv6(ip.toLowerCase());
	if (!groups) {
		return true; // unparseable — treat as unsafe
	}

	const upper96Zero = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0;
	// IPv4-mapped (::ffff:a.b.c.d and its hex/uncompressed forms) — the routed
	// destination is the embedded IPv4, so validate that instead.
	if (upper96Zero && groups[5] === 0xffff) {
		return isPrivateIpv4(embeddedIpv4(groups));
	}
	// IPv4-compatible (::a.b.c.d, deprecated), loopback (::1) and unspecified (::):
	// all map to or behave like low IPv4 space — block conservatively.
	if (upper96Zero && groups[5] === 0) {
		return true;
	}
	// NAT64 well-known prefix 64:ff9b::/96 also embeds an IPv4 destination.
	if (
		groups[0] === 0x64 &&
		groups[1] === 0xff9b &&
		groups[2] === 0 &&
		groups[3] === 0 &&
		groups[4] === 0 &&
		groups[5] === 0
	) {
		return isPrivateIpv4(embeddedIpv4(groups));
	}

	const first = groups[0];
	if ((first & 0xfe00) === 0xfc00) {
		return true; // fc00::/7 unique local
	}
	if ((first & 0xffc0) === 0xfe80) {
		return true; // fe80::/10 link-local
	}
	if ((first & 0xff00) === 0xff00) {
		return true; // ff00::/8 multicast
	}
	return false;
}

/** Renders the last 32 bits of an expanded IPv6 address as a dotted IPv4 string. */
function embeddedIpv4(groups: number[]): string {
	const a = (groups[6] >> 8) & 0xff;
	const b = groups[6] & 0xff;
	const c = (groups[7] >> 8) & 0xff;
	const d = groups[7] & 0xff;
	return `${a}.${b}.${c}.${d}`;
}

/**
 * Expands any valid IPv6 textual form (compressed `::`, uncompressed, or with a
 * trailing dotted-quad IPv4) into its eight 16-bit groups. Returns `null` when
 * the input is not a well-formed IPv6 address.
 */
function expandIpv6(address: string): number[] | null {
	let work = address.split('%')[0]; // drop any zone identifier

	// Fold a trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
	const dotted = work.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (dotted) {
		const octets = dotted[1].split('.').map(Number);
		if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
			return null;
		}
		const high = ((octets[0] << 8) | octets[1]).toString(16);
		const low = ((octets[2] << 8) | octets[3]).toString(16);
		work = work.slice(0, work.length - dotted[1].length) + `${high}:${low}`;
	}

	const halves = work.split('::');
	if (halves.length > 2) {
		return null;
	}
	const parseSide = (side: string): number[] | null => {
		if (side === '') {
			return [];
		}
		const parts = side.split(':');
		const values = parts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN));
		return values.some((value) => Number.isNaN(value)) ? null : values;
	};

	const head = parseSide(halves[0]);
	const tail = halves.length === 2 ? parseSide(halves[1]) : [];
	if (!head || !tail) {
		return null;
	}

	let groups: number[];
	if (halves.length === 2) {
		const missing = 8 - head.length - tail.length;
		if (missing < 1) {
			return null; // `::` must stand in for at least one zero group
		}
		groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
	} else {
		groups = head;
	}

	return groups.length === 8 ? groups : null;
}
