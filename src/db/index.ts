import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

export const db = drizzle(env.DB_URL, { schema });
