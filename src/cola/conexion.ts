import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../env.js";

export const conexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const cola = new Queue("historias", { connection: conexion });

export const opcionesTrabajo = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 60_000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};
