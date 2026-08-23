import type { FacilitatorClient } from "@x402/core/server";
import type {
	PaymentPayload,
	PaymentRequirements,
	SettleResponse,
	SupportedResponse,
	VerifyResponse,
} from "@x402/core/types";
import { generateCdpJwt } from "./cdp-auth";

const CDP_X402_BASE = "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * FacilitatorClient backed by the Coinbase Developer Platform hosted x402
 * facilitator. Generates a fresh per-request CDP JWT (bound to the exact
 * endpoint via the `uris` claim) and posts to /verify and /settle.
 */
export class CdpFacilitatorClient implements FacilitatorClient {
	private readonly apiKeyId: string;
	private readonly apiKeySecret: string;
	private readonly baseUrl: string;
	private readonly timeoutMs: number;

	constructor(params: {
		apiKeyId: string;
		apiKeySecret: string;
		baseUrl?: string;
		timeoutMs?: number;
	}) {
		this.apiKeyId = params.apiKeyId;
		this.apiKeySecret = params.apiKeySecret;
		this.baseUrl = (params.baseUrl ?? CDP_X402_BASE).replace(/\/$/, "");
		this.timeoutMs = params.timeoutMs ?? 30_000;
	}

	async verify(
		paymentPayload: PaymentPayload,
		paymentRequirements: PaymentRequirements,
	): Promise<VerifyResponse> {
		return this.request<VerifyResponse>("POST", "verify", paymentPayload, paymentRequirements);
	}

	async settle(
		paymentPayload: PaymentPayload,
		paymentRequirements: PaymentRequirements,
	): Promise<SettleResponse> {
		return this.request<SettleResponse>("POST", "settle", paymentPayload, paymentRequirements);
	}

	async getSupported(): Promise<SupportedResponse> {
		return this.request<SupportedResponse>("GET", "supported");
	}

	private async request<T>(
		method: "GET" | "POST",
		endpoint: "verify" | "settle" | "supported",
		paymentPayload?: PaymentPayload,
		paymentRequirements?: PaymentRequirements,
	): Promise<T> {
		const jwt = await generateCdpJwt({
			apiKeyId: this.apiKeyId,
			apiKeySecret: this.apiKeySecret,
			requestMethod: method,
			requestPath: `/platform/v2/x402/${endpoint}`,
			expiresIn: 60,
		});

		const res = await fetch(`${this.baseUrl}/${endpoint}`, {
			method,
			headers: {
				accept: "application/json",
				...(method === "POST" ? { "content-type": "application/json" } : {}),
				authorization: `Bearer ${jwt}`,
			},
			body:
				method === "POST"
					? JSON.stringify({
							x402Version:
								typeof (paymentPayload as { x402Version?: number } | undefined)?.x402Version ===
								"number"
									? (paymentPayload as { x402Version: number }).x402Version
									: 2,
							paymentPayload,
							paymentRequirements,
						})
					: undefined,
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		const body = (await res.json().catch(() => null)) as T | null;
		if (!res.ok || body === null) {
			throw new Error(
				`CDP facilitator ${endpoint} failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`,
			);
		}
		return body;
	}
}
