CREATE TABLE applicants (
  email TEXT PRIMARY KEY,
  canceled INTEGER NOT NULL
);

CREATE TABLE tokens (
  email TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  issued_at TEXT NOT NULL,
  last_sent_date TEXT NOT NULL DEFAULT '',
  pending INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE profiles (
  email TEXT PRIMARY KEY,
  name TEXT,
  job TEXT,
  fields TEXT,
  challenge TEXT,
  strengths TEXT,
  needs TEXT,
  link TEXT,
  photo_id TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
