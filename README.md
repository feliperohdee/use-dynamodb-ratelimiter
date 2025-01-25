# use-dynamodb-ratelimiter

A TypeScript library for implementing rate limiting using Amazon DynamoDB. It provides a robust, scalable system for managing request rate limits with configurable time windows and limits per namespace/ID combination.

[![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/-Vitest-729B1B?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ Features

- 💾 **DynamoDB Backend**: Uses DynamoDB for persistent storage of rate limit data
- 🔄 **Configurable Limits**: Define custom rate limits and time windows per namespace/ID
- 🏷️ **Namespace Support**: Group rate limits by namespaces for better organization
- ⏱️ **TTL Support**: Automatic cleanup of expired rate limits using DynamoDB TTL
- 📊 **Standard Headers**: Returns standard rate limit headers (X-RateLimit-\*)
- 🔍 **Clear Interface**: Simple API for checking and clearing rate limits

## Installation

```bash
npm install use-dynamodb-ratelimiter
# or
yarn add use-dynamodb-ratelimiter
```

## Quick Start

### Initialize the Rate Limiter

```typescript
import { RateLimiter } from 'use-dynamodb-ratelimiter';

const rateLimiter = new RateLimiter({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: process.env.AWS_REGION,
	tableName: 'YOUR_TABLE_NAME',
	createTable: true, // Optional: automatically create DynamoDB table
	getConfig: async ({ id, namespace }) => ({
		limit: 100, // Number of requests allowed
		seconds: 3600 // Time window in seconds
	})
});
```

### Check Rate Limits

```typescript
// Check if a request is allowed
const result = await rateLimiter.checkLimit({
	id: 'user-123',
	namespace: 'api-requests'
});

// Example response object:
// {
//   allowed: true,
//   headers: {
//     'x-rate-limit': '100',
//     'x-rate-limit-remaining': '99',
//     'x-rate-limit-reset': '1706198400',
//     'x-rate-limit-retry-in-seconds': '3597'
//   },
//   limit: 100,
//   remaining: 99,
//   resetAt: '2024-01-25T12:00:00.000Z'
//   retryInSeconds: 3597
// }

if (result.allowed) {
	// Process the request
	console.log(`Request allowed - Rate limit status:
    Limit: ${result.limit}
    Remaining: ${result.remaining}
    Reset at: ${new Date(result.resetAt).toLocaleString()}
    Headers: ${JSON.stringify(result.headers, null, 2)}
    Retry in seconds: ${result.retryInSeconds}
  `);

	// Apply rate limit headers to your HTTP response
	const response = {
		headers: {
			'x-rate-limit': result.headers['x-rate-limit'],
			'x-rate-limit-remaining': result.headers['x-rate-limit-remaining'],
			'x-rate-limit-reset': result.headers['x-rate-limit-reset'],
			'x-rate-limit-retry-in-seconds': result.headers['x-rate-limit-retry-in-seconds']
		}
	};
} else {
	// Rate limit exceeded
	console.log(`Rate limit exceeded:
    Limit: ${result.limit}
    Remaining: ${result.remaining}
    Reset at: ${new Date(result.resetAt).toLocaleString()}
	Headers: ${JSON.stringify(result.headers, null, 2)}
    Retry in seconds: ${result.retryInSeconds}
  `);

	// Return rate limit exceeded response
	const response = {
		status: 429, // Too Many Requests
		headers: {
			'x-rate-limit': result.headers['x-rate-limit'],
			'x-rate-limit-remaining': result.headers['x-rate-limit-remaining'],
			'x-rate-limit-reset': result.headers['x-rate-limit-reset'],
			'x-rate-limit-retry-in-seconds': result.headers['x-rate-limit-retry-in-seconds']
		},
		body: {
			error: 'Too Many Requests',
			message: `Rate limit exceeded. Try again after ${new Date(result.resetAt).toLocaleString()}`,
			limit: result.limit,
			resetAt: result.resetAt
		}
	};
}
```

### Clear Rate Limits

```typescript
// Clear all rate limits for a namespace
const result = await rateLimiter.clearLimits('api-requests');
console.log(`Cleared ${result.count} rate limits`);
```

## API Reference

### Constructor Options

```typescript
type ConstructorOptions = {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	tableName: string;
	createTable?: boolean;
	getConfig: (keys: { id: string; namespace: string }) => Config | Promise<Config>;
};

type Config = {
	limit: number; // Maximum number of requests allowed
	seconds: number; // Time window in seconds
};
```

### Check Rate Limit

```typescript
type CheckInput = {
	id: string; // Unique identifier for the rate limit
	namespace: string; // Grouping namespace
};

type CheckResult = {
	allowed: boolean; // Whether the request is allowed
	headers: {
		// Standard rate limit headers
		'x-rate-limit': string;
		'x-rate-limit-remaining': string;
		'x-rate-limit-reset': string;
		'x-rate-limit-retry-in-seconds': string;
	};
	limit: number; // Maximum requests allowed
	remaining: number; // Remaining requests allowed
	resetAt: string; // ISO timestamp when the limit resets
	retryInSeconds: number; // Retry in seconds
};
```

### Clear Rate Limits

```typescript
type ClearResult = {
	count: number; // Number of rate limits cleared
};
```

## Rate Limit Headers

The library returns standard rate limit headers that can be used directly in your HTTP responses:

```typescript
// Example header values for a rate limit of 100 requests per hour
{
  'x-rate-limit': '100',       // Maximum requests allowed
  'x-rate-limit-remaining': '97',    // Remaining requests in current window
  'x-rate-limit-reset': '1706198400', // Unix timestamp for window reset
  'x-rate-limit-retry-in-seconds': '3597' // Retry in seconds
}

// Example header values when rate limit is exceeded
{
  'x-rate-limit': '100',       // Maximum requests allowed
  'x-rate-limit-remaining': '0',     // No requests remaining
  'x-rate-limit-reset': '1706198400', // Unix timestamp for window reset
  'x-rate-limit-retry-in-seconds': '3597' // Retry in seconds
}
```

These headers follow standard rate limiting conventions:

- `X-RateLimit`: Maximum number of requests allowed in the time window
- `X-RateLimit-Remaining`: Number of requests remaining in the current time window
- `X-RateLimit-Reset`: Unix timestamp (in seconds) when the rate limit window resets
- `X-RateLimit-Retry-In-Seconds`: Retry in seconds

## DynamoDB Schema

The library uses the following DynamoDB schema:

- Partition Key: `namespace`
- Sort Key: `id`
- Additional Attributes:
  - `count`: Number of requests made
  - `resetAt`: ISO timestamp when the limit resets
  - `ttl`: Unix timestamp for DynamoDB TTL
  - `__createdAt`: ISO timestamp of creation
  - `__updatedAt`: ISO timestamp of last update

## Development

```bash
# Required environment variables
export AWS_ACCESS_KEY='YOUR_ACCESS_KEY'
export AWS_SECRET_KEY='YOUR_SECRET_KEY'
export AWS_REGION='YOUR_REGION'

# Run tests
yarn test
```

## License

MIT © [Felipe Rohde](mailto:feliperohdee@gmail.com)

## 👨‍💻 Author

**Felipe Rohde**

- Twitter: [@feliperohdee](https://twitter.com/felipe_rohde)
- Github: [@feliperohdee](https://github.com/feliperohdee)
- Email: feliperohdee@gmail.com
