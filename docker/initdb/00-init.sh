#!/bin/bash
# Ubuntu 3.0 — first-run DB init.
#
# MariaDB runs everything in /docker-entrypoint-initdb.d/ once, the first time
# the data volume is created. By then the database `ubuntu_me` and the user
# `ubuntu_me` already exist (env vars on the container created them).
#
# We just need to load the schema and apply every migration in lexical order.
set -euo pipefail

DB_HOST=127.0.0.1
DB_NAME="${MARIADB_DATABASE:-ubuntu_me}"

echo "[ubuntu3-init] loading schema.sql"
mariadb -h "$DB_HOST" -uroot -p"${MARIADB_ROOT_PASSWORD}" "$DB_NAME" < /sql/schema.sql

echo "[ubuntu3-init] applying migrations:"
for f in /sql/migrations/v*.sql; do
  echo "  ▸ $(basename "$f")"
  mariadb -h "$DB_HOST" -uroot -p"${MARIADB_ROOT_PASSWORD}" "$DB_NAME" < "$f"
done

echo "[ubuntu3-init] done. Create the first admin from the app container:"
echo "  docker exec -it ubuntu3-app php /var/www/server/bin/create-admin.php \\"
echo "      --email=admin@local --name=\"Local Admin\" --role=admin --password=local-admin-pwd"
