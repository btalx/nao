import { describe, expect, it } from 'vitest';

import { isPrivateOrReservedIp } from '../src/utils/private-network';

describe('isPrivateOrReservedIp', () => {
	it('flags IPv4 loopback, private, link-local and reserved ranges', () => {
		for (const ip of [
			'127.0.0.1',
			'10.0.0.1',
			'172.16.5.4',
			'192.168.1.1',
			'169.254.169.254', // cloud metadata endpoint
			'100.64.0.1', // carrier-grade NAT
			'0.0.0.0',
			'198.18.0.1',
			'224.0.0.1',
		]) {
			expect(isPrivateOrReservedIp(ip), ip).toBe(true);
		}
	});

	it('allows public IPv4 addresses', () => {
		for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
			expect(isPrivateOrReservedIp(ip), ip).toBe(false);
		}
	});

	it('flags IPv6 loopback, unspecified, ULA, link-local and multicast', () => {
		for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
			expect(isPrivateOrReservedIp(ip), ip).toBe(true);
		}
	});

	it('allows public IPv6 addresses', () => {
		for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
			expect(isPrivateOrReservedIp(ip), ip).toBe(false);
		}
	});

	it('flags IPv4-mapped IPv6 in every textual form (rebinding bypass guard)', () => {
		for (const ip of [
			'::ffff:127.0.0.1', // dotted-quad mapped
			'::ffff:7f00:1', // hex mapped -> 127.0.0.1
			'0:0:0:0:0:ffff:127.0.0.1', // uncompressed dotted mapped
			'::FFFF:169.254.169.254', // upper-case metadata endpoint
			'::ffff:a9fe:a9fe', // hex metadata endpoint
			'::ffff:10.0.0.1', // mapped private
			'::ffff:c0a8:0101', // hex 192.168.1.1
		]) {
			expect(isPrivateOrReservedIp(ip), ip).toBe(true);
		}
	});

	it('allows IPv4-mapped IPv6 that points at a public address', () => {
		expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
		expect(isPrivateOrReservedIp('::ffff:0808:0808')).toBe(false);
	});

	it('flags IPv4-compatible and NAT64-embedded private addresses', () => {
		expect(isPrivateOrReservedIp('::127.0.0.1')).toBe(true);
		expect(isPrivateOrReservedIp('64:ff9b::127.0.0.1')).toBe(true);
		expect(isPrivateOrReservedIp('64:ff9b::7f00:1')).toBe(true);
	});

	it('treats non-IP literals as unsafe', () => {
		expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
		expect(isPrivateOrReservedIp('')).toBe(true);
	});
});
