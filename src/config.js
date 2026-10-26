import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const DEV_SECRET = 'dev-only-secret-change-me';

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  dbPath: process.env.DB_PATH || './data/quizarena.db',
  // How many login/register attempts one IP may make per 15 minutes.
  authRateMax: Number(process.env.AUTH_RATE_MAX) || 20,
  // Set TRUST_PROXY=1 when deployed behind a proxy (Render, Railway, Fly, nginx...).
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  // Pause between a question's result and the next question.
  revealMs: Number(process.env.REVEAL_MS) || 4000,
};

if (isProd && config.jwtSecret === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
