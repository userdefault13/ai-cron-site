import { importJWK, importPKCS8, SignJWT } from "jose";

const CDP_HOST = "api.cdp.coinbase.com";

function nonce(): string {
	return crypto.randomUUID();
}

/**
 * Generate a CDP JWT (Bearer token) for authenticating a REST request.
 * Mirrors @coinbase/cdp-sdk/auth generateJwt, implemented on `jose` so it runs
 * in Workers (WebCrypto only). Supports Ed25519 (base64) and ES256 (PEM) keys.
 */
export async function generateCdpJwt(params: {
	apiKeyId: string;
	apiKeySecret: string;
	requestMethod: string;
	requestPath: string;
	expiresIn?: number;
}): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const expiresIn = params.expiresIn ?? 120;

	const claims = {
		sub: params.apiKeyId,
		iss: "cdp",
		aud: ["cdp_service"],
		uris: [`${params.requestMethod.toUpperCase()} ${CDP_HOST}${params.requestPath}`],
	};

	if (params.apiKeySecret.includes("BEGIN EC PRIVATE KEY")) {
		const ecKey = await importPKCS8(params.apiKeySecret, "ES256");
		return new SignJWT(claims)
			.setProtectedHeader({ alg: "ES256", kid: params.apiKeyId, typ: "JWT", nonce: nonce() })
			.setIssuedAt(now)
			.setNotBefore(now)
			.setExpirationTime(now + expiresIn)
			.sign(ecKey);
	}

	const decoded = Uint8Array.from(atob(params.apiKeySecret), (c) => c.charCodeAt(0));
	if (decoded.length !== 64) {
		throw new Error("CDP_API_KEY_SECRET must be an EC PEM key or a 64-byte base64 Ed25519 key");
	}
	const seed = decoded.slice(0, 32);
	const publicKey = decoded.slice(32);
	const toB64Url = (bytes: Uint8Array) =>
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	const jwk = {
		kty: "OKP",
		crv: "Ed25519",
		d: toB64Url(seed),
		x: toB64Url(publicKey),
	};
	const edKey = await importJWK(jwk, "EdDSA");
	return new SignJWT(claims)
		.setProtectedHeader({ alg: "EdDSA", kid: params.apiKeyId, typ: "JWT", nonce: nonce() })
		.setIssuedAt(now)
		.setNotBefore(now)
		.setExpirationTime(now + expiresIn)
		.sign(edKey);
}
