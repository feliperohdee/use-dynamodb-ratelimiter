import Dynamodb from 'use-dynamodb';
import z from 'zod';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const checkInput = z.object({
	id: z.string(),
	namespace: z.string()
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rule = z.object({
	__createdAt: z
		.string()
		.datetime()
		.default(() => new Date().toISOString()),
	__updatedAt: z
		.string()
		.datetime()
		.default(() => new Date().toISOString()),
	count: z.number(),
	id: z.string(),
	namespace: z.string(),
	resetAt: z.string().datetime(),
	ttl: z.number()
});

namespace RateLimiter {
	export type ConstructorOptions = {
		accessKeyId: string;
		createTable?: boolean;
		endpoint?: string;
		getConfig: GetConfig;
		region: string;
		secretAccessKey: string;
		tableName: string;
	};

	export type CheckInput = z.input<typeof checkInput>;
	export type CheckResult = {
		allowed: boolean;
		headers: Record<string, string>;
		limit: number;
		remaining: number;
		resetAt: string;
		retryInSeconds: number;
	};

	export type Config = {
		limit: number;
		seconds: number;
	};

	export type GetConfig = (keys: { id: string; namespace: string }) => RateLimiter.Config | Promise<RateLimiter.Config>;
	export type Rule = z.infer<typeof rule>;
}

class RateLimiter {
	public db: Dynamodb<RateLimiter.Rule>;
	public getConfig: RateLimiter.GetConfig;

	constructor(options: RateLimiter.ConstructorOptions) {
		const db = new Dynamodb<RateLimiter.Rule>({
			accessKeyId: options.accessKeyId,
			endpoint: options.endpoint,
			region: options.region,
			schema: {
				partition: 'namespace',
				sort: 'id'
			},
			secretAccessKey: options.secretAccessKey,
			table: options.tableName
		});

		if (options.createTable) {
			(async () => {
				await db.createTable();
			})();
		}

		this.db = db;
		this.getConfig = options.getConfig;
	}

	async checkLimit(args: RateLimiter.CheckInput): Promise<RateLimiter.CheckResult> {
		const now = new Date();

		// Try to get existing rate limit
		const existing = await this.db.get({
			item: {
				id: args.id,
				namespace: args.namespace
			}
		});

		const config = await this.getConfig({
			id: args.id,
			namespace: args.namespace
		});

		if (!existing || new Date(existing.resetAt) <= now) {
			// Create new rate limit entry
			const resetAt = new Date(now.getTime() + config.seconds * 1000).toISOString();
			const newLimit = await this.db.put(
				{
					count: 1,
					id: args.id,
					namespace: args.namespace,
					resetAt,
					ttl: Math.floor(now.getTime() / 1000 + config.seconds)
				},
				{ overwrite: true }
			);

			const retryInSeconds = Math.floor((new Date(newLimit.resetAt).getTime() - new Date().getTime()) / 1000);

			return {
				allowed: true,
				headers: this.headers(newLimit.resetAt, config.limit, 1, retryInSeconds),
				limit: config.limit,
				remaining: config.limit - 1,
				resetAt: newLimit.resetAt,
				retryInSeconds: Math.floor((new Date(newLimit.resetAt).getTime() - new Date().getTime()) / 1000)
			};
		}

		if (existing.count >= config.limit) {
			const retryInSeconds = Math.floor((new Date(existing.resetAt).getTime() - new Date().getTime()) / 1000);

			return {
				allowed: false,
				headers: this.headers(existing.resetAt, config.limit, existing.count, retryInSeconds),
				limit: config.limit,
				remaining: 0,
				resetAt: existing.resetAt,
				retryInSeconds: Math.floor((new Date(existing.resetAt).getTime() - new Date().getTime()) / 1000)
			};
		}

		// Update count
		const updated = await this.db.update({
			attributeNames: { '#count': 'count' },
			attributeValues: { ':one': 1 },
			filter: {
				item: {
					id: args.id,
					namespace: args.namespace
				}
			},
			updateExpression: 'ADD #count :one'
		});

		const retryInSeconds = Math.floor((new Date(updated.resetAt).getTime() - new Date().getTime()) / 1000);

		return {
			allowed: true,
			headers: this.headers(updated.resetAt, config.limit, updated.count, retryInSeconds),
			limit: config.limit,
			remaining: config.limit - updated.count,
			resetAt: updated.resetAt,
			retryInSeconds
		};
	}

	async clearLimits(namespace: string): Promise<{ count: number }> {
		return this.db.clear(namespace);
	}

	private headers(resetAt: string, limit: number, count: number, retryInSeconds: number): Record<string, string> {
		return {
			'x-rate-limit': limit.toString(),
			'x-rate-limit-remaining': (limit - count).toString(),
			'x-rate-limit-reset': Math.floor(new Date(resetAt).getTime() / 1000).toString(),
			'x-rate-limit-retry-in-seconds': retryInSeconds.toString()
		};
	}
}

export default RateLimiter;
