export interface EnvVarMeta {
  key: string;
  required: boolean;
  description: string;
  example?: string;
}

export const ENV_SCHEMA: EnvVarMeta[] = [
  { 
    key: 'APP_URL', 
    required: true, 
    description: 'Public base URL of your MLBoss deployment. Used for OAuth redirects.',
    example: 'https://mlboss.example.com'
  },
  { 
    key: 'YAHOO_CLIENT_ID', 
    required: true, 
    description: 'Yahoo Developer application client ID.',
    example: 'dj0yJmk9Y…'
  },
  { 
    key: 'YAHOO_CLIENT_SECRET', 
    required: true, 
    description: 'Yahoo Developer application client secret.',
    example: 'a83f5c3…'
  },
  {
    key: 'REDIS_URL',
    required: false,
    description: 'Preferred way to configure Redis. When set, takes precedence over REDIS_HOST/PORT/DB. Either REDIS_URL or REDIS_HOST must be provided.',
    example: 'redis://localhost:6379'
  },
  { 
    key: 'SESSION_SECRET', 
    required: true, 
    description: '64-character random string used to encrypt iron-session cookies.',
    example: 'change_me_to_a_long_random_string'
  },
  {
    key: 'REDIS_HOST',
    required: false,
    description: 'Redis host. Used when REDIS_URL is not set.',
    example: 'localhost'
  },
  {
    key: 'REDIS_PORT',
    required: false,
    description: 'Redis port. Used when REDIS_URL is not set.',
    example: '6379'
  },
  {
    key: 'REDIS_PASSWORD',
    required: false,
    description: 'Redis password. Used when REDIS_URL is not set and the server requires AUTH.',
    example: ''
  },
  {
    key: 'REDIS_DB',
    required: false,
    description: 'Redis database number. Used when REDIS_URL is not set.',
    example: '0'
  }
];

/**
 * Validate that all required environment variables are present.
 * 
 * @example
 *   import { validateEnvVars } from '@/constants/envSchema';
 *   validateEnvVars(); // throws if any required vars missing
 */
export function validateEnvVars(): void {
  const missing = ENV_SCHEMA
    .filter(({ key, required }) => required && !process.env[key])
    .map(({ key }) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Redis is required, but it can be configured either via REDIS_URL or via
  // the discrete REDIS_HOST/PORT/DB triplet. Enforce that here so the schema
  // can leave both groups optional individually.
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    throw new Error('Missing Redis configuration: set REDIS_URL or REDIS_HOST');
  }
}

/**
 * Generate example .env.local content from schema.
 * 
 * @example
 *   import { generateEnvExample } from '@/constants/envSchema';
 *   console.log(generateEnvExample());
 */
export function generateEnvExample(): string {
  return ENV_SCHEMA
    .map(({ key, example, description }) => 
      `# ${description}\n${key}=${example || '<your_value_here>'}`
    )
    .join('\n\n');
} 