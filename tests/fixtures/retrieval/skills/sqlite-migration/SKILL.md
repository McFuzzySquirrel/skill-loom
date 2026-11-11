---
name: sqlite-migration
description: Manage local database storage.
inputs: [database_path]
outputs: [migration_report]
metadata:
  tags: [database, sqlite, storage]
---

# SQLite migration

Keep the database derived and disposable unless a user-owned record explicitly requires durability.

## Schema migration

Version the schema with `PRAGMA user_version`, validate it before use, and migrate in one transaction.

## Journal mode

Use the documented journal mode for the database and reject unexpected sidecars instead of silently adopting them.
