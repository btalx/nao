import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

import { logger } from './logger';
import { resolvePublicAddress } from './private-network';

/**
 * Local HTTP forward proxy that pins every connection to a server-validated
 * public IP. The headless browser used to render untrusted chart plugins is
 * pointed at this proxy, so Chromium never performs its own DNS resolution —
 * the proxy resolves each host exactly once, blocks private/reserved targets,
 * and connects to that pinned address.
 *
 * This closes the DNS-rebinding (TOCTOU) gap that exists when a guard resolves
 * a hostname and then lets the browser re-resolve it at connection time.
 */

let proxyPromise: Promise<string> | null = null;
let proxyServer: http.Server | null = null;

export async function getSsrfProxyUrl(): Promise<string> {
	if (!proxyPromise) {
		proxyPromise = startProxy();
	}
	return proxyPromise;
}

export async function closeSsrfProxy(): Promise<void> {
	const server = proxyServer;
	proxyServer = null;
	proxyPromise = null;
	if (server) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

async function startProxy(): Promise<string> {
	const server = http.createServer(handlePlainHttp);
	server.on('connect', handleConnect);
	server.on('clientError', (_error, socket) => socket.destroy());

	server.listen(0, '127.0.0.1');
	await once(server, 'listening');

	proxyServer = server;
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to determine SSRF proxy address.');
	}
	return `http://127.0.0.1:${address.port}`;
}

/** Tunnels HTTPS (CONNECT) requests to the pinned IP; TLS stays end-to-end. */
function handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
	const { host, port } = parseAuthority(req.url ?? '', 443);
	void (async () => {
		const ip = host ? await resolvePublicAddress(host) : null;
		if (!ip) {
			blocked(host);
			clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
			return;
		}
		const upstream = net.connect(port, ip, () => {
			clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			if (head.length > 0) {
				upstream.write(head);
			}
			upstream.pipe(clientSocket);
			clientSocket.pipe(upstream);
		});
		upstream.on('error', () => clientSocket.destroy());
		clientSocket.on('error', () => upstream.destroy());
	})();
}

/** Forwards plain HTTP requests to the pinned IP. */
function handlePlainHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
	let target: URL;
	try {
		target = new URL(req.url ?? '');
	} catch {
		res.writeHead(400).end();
		return;
	}
	void (async () => {
		const ip = await resolvePublicAddress(target.hostname);
		if (!ip) {
			blocked(target.hostname);
			res.writeHead(403).end();
			return;
		}
		const upstream = http.request(
			{
				host: ip,
				port: target.port || 80,
				method: req.method,
				path: `${target.pathname}${target.search}`,
				headers: { ...req.headers, host: target.host },
			},
			(upstreamRes) => {
				res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
				upstreamRes.pipe(res);
			},
		);
		upstream.on('error', () => res.writeHead(502).end());
		req.pipe(upstream);
	})();
}

function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } {
	const lastColon = authority.lastIndexOf(':');
	if (authority.startsWith('[')) {
		const close = authority.indexOf(']');
		const host = authority.slice(1, close < 0 ? undefined : close);
		const port = close >= 0 && authority[close + 1] === ':' ? Number(authority.slice(close + 2)) : defaultPort;
		return { host, port: Number.isInteger(port) ? port : defaultPort };
	}
	if (lastColon === -1) {
		return { host: authority, port: defaultPort };
	}
	const port = Number(authority.slice(lastColon + 1));
	return { host: authority.slice(0, lastColon), port: Number.isInteger(port) ? port : defaultPort };
}

function blocked(host: string): void {
	logger.warn(`Blocked custom chart plugin network request to private/unresolved host "${host}"`, {
		source: 'system',
	});
}
