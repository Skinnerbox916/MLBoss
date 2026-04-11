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
    required: true, 
    description: 'Connection string for Redis.',
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
    description: 'Alternative Redis host if not using REDIS_URL.',
    example: 'localhost'
  },
  { 
    key: 'REDIS_PORT', 
    required: false, 
    description: 'Alternative Redis port if not using REDIS_URL.',
    example: '6379'
  },
  { 
    key: 'REDIS_DB', 
    required: false, 
    description: 'Alternative Redis database number if not using REDIS_URL.',
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