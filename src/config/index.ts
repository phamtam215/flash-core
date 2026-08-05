/**
 * Public interface của module config. Module khác import từ đây, không import sâu vào file
 * bên trong — đó là cách ranh giới module được giữ trong một Modular Monolith.
 */
export { ConfigModule, ENV } from './config.module';
export { envSchema, validateEnv, type Env } from './env.schema';
