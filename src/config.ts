import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3200', 10),
  apiKey: process.env.API_KEY!,
  rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM || '60', 10),
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,
  metaApiVersion: process.env.META_API_VERSION || 'v21.0',
};

if (!config.apiKey) throw new Error('API_KEY is required');
