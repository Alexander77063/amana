-- Initial bootstrap migration. Enables required Postgres extensions only.
-- Domain schema lands in Sub-plan 2.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
