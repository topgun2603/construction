#!/usr/bin/env bash
#
# Nightly database dump to S3.
#
# On the single-host shape the database lives on the same disk as the application, so a lost
# instance is a lost database unless something like this runs. It is the one piece of operational
# work that managed Postgres would have done for you, and the reason to move to RDS once there are
# customers whose data you would have to explain losing.
#
# Install on the box:
#   sudo cp infra/backup.sh /usr/local/bin/sitebook-backup
#   sudo chmod +x /usr/local/bin/sitebook-backup
#   ( crontab -l 2>/dev/null; echo "15 2 * * * /usr/local/bin/sitebook-backup >> /var/log/sitebook-backup.log 2>&1" ) | crontab -
#
# 02:15 UTC is 07:45 IST â€” after the nightly rollup jobs and before anybody is on site.

set -euo pipefail

BUCKET="${BACKUP_BUCKET:?set BACKUP_BUCKET}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/sitebook}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="sitebook-${stamp}.sql.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[$(date -u +%FT%TZ)] dumping"

# As the superuser, not sitebook_app: the app role is NOBYPASSRLS and every tenant policy would
# match zero rows, producing a dump that restores cleanly and contains nothing.
docker compose --env-file "${COMPOSE_DIR}/.env.prod" -f "${COMPOSE_DIR}/infra/docker-compose.prod.yml" exec -T postgres \
	pg_dump -U sitebook -d sitebook --clean --if-exists \
	| gzip -9 > "${tmp}/${file}"

size="$(stat -c %s "${tmp}/${file}")"
# A dump of a database with tenants in it is never a few hundred bytes. Refusing to upload a
# suspiciously small one keeps a broken backup from quietly replacing a working history.
if [ "${size}" -lt 10000 ]; then
	echo "dump is only ${size} bytes â€” refusing to upload it" >&2
	exit 1
fi

echo "[$(date -u +%FT%TZ)] uploading ${file} (${size} bytes)"
aws s3 cp "${tmp}/${file}" "s3://${BUCKET}/db/${file}" \
	--storage-class STANDARD_IA \
	--only-show-errors

# Prune anything older than the retention window. Listing rather than relying on a lifecycle rule,
# so the pruning is visible in this log next to the upload that caused it.
cutoff="$(date -u -d "${KEEP_DAYS} days ago" +%Y%m%d)"
aws s3 ls "s3://${BUCKET}/db/" | awk '{print $4}' | while read -r key; do
	[ -n "${key}" ] || continue
	day="$(echo "${key}" | sed -n 's/^sitebook-\([0-9]\{8\}\)T.*/\1/p')"
	[ -n "${day}" ] || continue
	if [ "${day}" -lt "${cutoff}" ]; then
		echo "pruning ${key}"
		aws s3 rm "s3://${BUCKET}/db/${key}" --only-show-errors
	fi
done

echo "[$(date -u +%FT%TZ)] done"
