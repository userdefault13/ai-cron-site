const PAYMENT_HEADERS = ["x-payment", "payment-signature", "payment"];

function decodeBase64(value: string): unknown {
	try {
		const normalized = value.replace(/^Bearer\s+/i, "").trim();
		const binary = atob(normalized.replace(/-/g, "+").replace(/_/g, "/"));
		return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0))));
	} catch {
		return null;
	}
}

/**
 * Extract the payer address from an x402 payment payload attached to the request.
 * Supports v1 (`X-PAYMENT`) and v2 (`PAYMENT-SIGNATURE`) header shapes:
 *   { from } | { authorization: { from } } | { payload: { from | authorization: { from } } }
 */
export function extractPayer(headers: Headers): string | null {
	for (const name of PAYMENT_HEADERS) {
		const raw = headers.get(name);
		if (!raw) continue;
		// biome-ignore lint/suspicious/noExplicitAny: x402 payload shapes vary across v1/v2 headers
		const payload = decodeBase64(raw) as Record<string, any> | null;
		if (!payload) continue;
		const candidates = [
			payload,
			payload.payload,
			payload.authorization,
			payload.payload?.authorization,
		];
		for (const candidate of candidates) {
			const from = candidate?.from ?? candidate?.payerAddress;
			if (typeof from === "string" && /^0x[a-fA-F0-9]{40}$/.test(from)) {
				return from.toLowerCase();
			}
		}
	}
	return null;
}

export function isHexAddress(value: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeAddress(value: string): string {
	return value.toLowerCase();
}
