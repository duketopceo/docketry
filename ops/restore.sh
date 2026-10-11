#!/usr/bin/env bash
# Restore a Tallyline backup made by ops/backup.sh.
#
#   ops/restore.sh <backup.dump.gz.age | s3-key>
#
# Required env
#   BACKUP_AGE_IDENTITY    path to the age PRIVATE key file (age-keygen output). Supply it
#                          only for the restore — it should not live on the production box.
#   target (explicit — there is deliberately NO default, so a typo can't hit production):
#     RESTORE_PG_CONTAINER [RESTORE_PG_USER=postgres] [RESTORE_PG_DB=docketry]
#     or RESTORE_DATABASE_URL
# The target database must already exist (CREATE DATABASE) and ideally be empty;
# objects are replaced with --clean --if-exists. Stop api/web first on a live box.
# S3 fetch (when the argument is not an existing file): BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT,
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, [BACKUP_S3_PREFIX=tallyline/]
set -Eeuo pipefail

log() { printf '%s restore: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

src="${1:?usage: restore.sh <backup.dump.gz.age | s3-key>}"
: "${BACKUP_AGE_IDENTITY:?set BACKUP_AGE_IDENTITY to the age private key file}"
[ -r "$BACKUP_AGE_IDENTITY" ] || die "cannot read BACKUP_AGE_IDENTITY"
[ -n "${RESTORE_PG_CONTAINER:-}${RESTORE_DATABASE_URL:-}" ] || die "set RESTORE_PG_CONTAINER or RESTORE_DATABASE_URL (no default, on purpose)"
for bin in age gzip; do command -v "$bin" >/dev/null || die "missing dependency: $bin"; done

tmp=""
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT

if [ ! -f "$src" ]; then
  : "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}" "${BACKUP_S3_ENDPOINT:?set BACKUP_S3_ENDPOINT}"
  tmp="$(mktemp -d)"
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
  key="${BACKUP_S3_PREFIX-tallyline/}${src##*/}"
  for f in "$key" "$key.sha256"; do
    aws s3 cp --only-show-errors --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://${BACKUP_S3_BUCKET}/$f" "$tmp/${f##*/}"
  done
  ( cd "$tmp" && sha256sum -c "${key##*/}.sha256" ) || die "checksum mismatch — download corrupted"
  src="$tmp/${key##*/}"
elif [ -f "$src.sha256" ]; then
  ( cd "$(dirname "$src")" && sha256sum -c "$(basename "$src").sha256" ) || die "checksum mismatch"
fi

restore() {
  if [ -n "${RESTORE_PG_CONTAINER:-}" ]; then
    docker exec -i "$RESTORE_PG_CONTAINER" pg_restore -U "${RESTORE_PG_USER:-postgres}" \
      -d "${RESTORE_PG_DB:-docketry}" --clean --if-exists --no-owner --exit-on-error
  elif [ -n "${RESTORE_DATABASE_URL:-}" ]; then
    pg_restore -d "$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --exit-on-error
  else
    die "set RESTORE_PG_CONTAINER or RESTORE_DATABASE_URL (no default, on purpose)"
  fi
}

log "decrypting and restoring $(basename "$src")"
age -d -i "$BACKUP_AGE_IDENTITY" "$src" | gzip -dc | restore
log "ok — restart api/web; the API re-runs migrations on boot"
