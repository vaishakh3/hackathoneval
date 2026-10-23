-- Applied by scripts/desk-migrate.ts, in a validated application schema.
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  role TEXT NOT NULL CHECK (role IN ('organizer','mentor','participant')),
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS users_event ON users(event_id);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), project_id TEXT NOT NULL,
  mime TEXT NOT NULL, content BYTEA, blob_path TEXT,
  CHECK (content IS NOT NULL OR blob_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS files_project ON files(project_id);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, count INTEGER NOT NULL);
