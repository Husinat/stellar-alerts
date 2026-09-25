import { defineConfig } from "prisma/config";

const defaultDatabaseUrl =
  "postgresql://user:password@localhost:5432/stellar_alerts?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
