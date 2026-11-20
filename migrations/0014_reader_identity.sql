-- Reader sign-in, with a one-time code sent by email.
--
-- The auth_ tables belong to Better Auth and are as its migration generator
-- writes them for SQLite. They hold each person's email address and sessions,
-- and no party-db collection serves them, so nothing in them reaches a browser.
-- A Better Auth upgrade that changes them needs a new migration of its own.
create table "auth_users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_sessions" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_users" ("id") on delete cascade);

create table "auth_accounts" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_users" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "auth_rate_limits" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "auth_sessions_userId_idx" on "auth_sessions" ("userId");

create index "auth_accounts_userId_idx" on "auth_accounts" ("userId");

create index "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");

-- Everyone who has signed in, as the public sees them: a name they choose, never
-- their email address. A row is added the first time someone signs in. While
-- muted_at is set, their waiting proposals and comments are left off public pages.
CREATE TABLE people (
  id TEXT PRIMARY KEY REFERENCES auth_users(id),
  display_name TEXT,
  muted_at TEXT,
  created_at TEXT NOT NULL
);

-- What a person may do, and where: one row per role they hold, so the same
-- person can be a volunteer for one organisation and an editor for another.
-- A null scope means the role holds everywhere. Nothing reads this yet.
CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL,
  scope_kind TEXT,
  scope_id TEXT,
  granted_by TEXT REFERENCES people(id),
  granted_at TEXT NOT NULL
);
-- A plain UNIQUE would let two rows hold the same role everywhere, since SQLite
-- counts each null scope as different.
CREATE UNIQUE INDEX role_assignments_once ON role_assignments(person_id, role, coalesce(scope_kind, ''), coalesce(scope_id, ''));

-- Who posted a comment, when they were signed in.
ALTER TABLE comments ADD COLUMN person_id TEXT REFERENCES people(id);

CREATE INDEX proposals_submitted_by ON proposals(submitted_by);
CREATE INDEX comments_person ON comments(person_id);
