import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { RateLimiter } from './index';

describe('/index', () => {
	let getConfig: Mock;
	let rateLimiter: RateLimiter;

	beforeAll(() => {
		rateLimiter = new RateLimiter({
			accessKeyId: process.env.AWS_ACCESS_KEY || '',
			createTable: true,
			getConfig: vi.fn(),
			region: process.env.AWS_REGION || '',
			secretAccessKey: process.env.AWS_SECRET_KEY || '',
			tableName: 'use-dynamodb-ratelimiter-spec'
		});
	});

	beforeEach(() => {
		getConfig = vi.fn(() => {
			return {
				limit: 5,
				seconds: 3600
			};
		});

		rateLimiter = new RateLimiter({
			accessKeyId: process.env.AWS_ACCESS_KEY || '',
			createTable: true,
			getConfig,
			region: process.env.AWS_REGION || '',
			secretAccessKey: process.env.AWS_SECRET_KEY || '',
			tableName: 'use-dynamodb-ratelimiter-spec'
		});
	});

	afterAll(async () => {
		await rateLimiter.clearLimits('spec');
	});

	describe('checkLimit', () => {
		afterEach(async () => {
			await rateLimiter.clearLimits('spec');
		});

		it('should create new rate limit when none exists', async () => {
			const res = await rateLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			expect(getConfig).toHaveBeenCalledWith({
				id: 'test-id',
				namespace: 'spec'
			});
			expect(res).toEqual({
				allowed: true,
				headers: {
					'x-rate-limit': '5',
					'x-rate-limit-remaining': '4',
					'x-rate-limit-reset': expect.any(String),
					'x-rate-limit-retry-in-seconds': '3599'
				},
				limit: 5,
				remaining: 4,
				resetAt: expect.any(String),
				retryInSeconds: 3599
			});
		});

		it('should increment existing rate limit', async () => {
			// First request
			await rateLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			// Second request
			const res = await rateLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			expect(getConfig).toHaveBeenCalledWith({
				id: 'test-id',
				namespace: 'spec'
			});
			expect(res).toEqual({
				allowed: true,
				headers: {
					'x-rate-limit': '5',
					'x-rate-limit-remaining': '3',
					'x-rate-limit-reset': expect.any(String),
					'x-rate-limit-retry-in-seconds': '3599'
				},
				limit: 5,
				remaining: 3,
				resetAt: expect.any(String),
				retryInSeconds: 3599
			});
		});

		it('should block requests when limit is exceeded', async () => {
			// Make 5 requests to hit the limit
			for (let i = 0; i < 5; i++) {
				await rateLimiter.checkLimit({
					id: 'test-id',
					namespace: 'spec'
				});
			}

			// Sixth request should be blocked
			const res = await rateLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			expect(getConfig).toHaveBeenCalledWith({
				id: 'test-id',
				namespace: 'spec'
			});
			expect(res).toEqual({
				allowed: false,
				headers: {
					'x-rate-limit': '5',
					'x-rate-limit-remaining': '0',
					'x-rate-limit-reset': expect.any(String),
					'x-rate-limit-retry-in-seconds': expect.any(String)
				},
				limit: 5,
				remaining: 0,
				resetAt: expect.any(String),
				retryInSeconds: expect.any(Number)
			});
		});

		it('should reset limit after expiration', async () => {
			getConfig = vi.fn(() => {
				return {
					limit: 2,
					seconds: 1
				};
			});

			// Create rate limiter with short duration
			const shortLimiter = new RateLimiter({
				accessKeyId: process.env.AWS_ACCESS_KEY || '',
				createTable: true,
				getConfig,
				region: process.env.AWS_REGION || '',
				secretAccessKey: process.env.AWS_SECRET_KEY || '',
				tableName: 'use-dynamodb-ratelimiter-spec'
			});

			// Make initial request
			await shortLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			// Wait for expiration
			await new Promise(resolve => setTimeout(resolve, 1100));

			// Make new request
			const res = await shortLimiter.checkLimit({
				id: 'test-id',
				namespace: 'spec'
			});

			expect(getConfig).toHaveBeenCalledWith({
				id: 'test-id',
				namespace: 'spec'
			});
			expect(res).toEqual({
				allowed: true,
				headers: {
					'x-rate-limit': '2',
					'x-rate-limit-remaining': '1',
					'x-rate-limit-reset': expect.any(String),
					'x-rate-limit-retry-in-seconds': '0'
				},
				limit: 2,
				remaining: 1,
				resetAt: expect.any(String),
				retryInSeconds: 0
			});
		});
	});

	describe('clearLimits', () => {
		it('should clear all limits for a namespace', async () => {
			// Create multiple rate limits
			await Promise.all([
				rateLimiter.checkLimit({ id: 'test1', namespace: 'spec' }),
				rateLimiter.checkLimit({ id: 'test2', namespace: 'spec' }),
				rateLimiter.checkLimit({ id: 'test3', namespace: 'spec' })
			]);

			const res = await rateLimiter.clearLimits('spec');
			expect(res).toEqual({
				count: 3
			});

			// Verify limits are cleared
			const newLimit = await rateLimiter.checkLimit({
				id: 'test1',
				namespace: 'spec'
			});
			expect(newLimit.remaining).toBe(4);
		});
	});
});
