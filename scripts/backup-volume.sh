#!/bin/sh
# Publish only a complete, readable backup; never replace an existing recovery point.
set -eu
if [ "$#" -ne 3 ]; then
  echo 'Usage: backup-volume.sh VOLUME IMAGE DESTINATION' >&2
  exit 2
fi
volume=$1
image=$2
destination=$3
[ -n "$volume" ] && [ -n "$image" ] && [ -n "$destination" ] || exit 2
umask 077
parent=$(dirname -- "$destination")
tmp=$(mktemp "$parent/.openflix-backup.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT HUP INT TERM
docker run --rm --network none --user 0 --mount "type=volume,src=$volume,dst=/data,readonly" --entrypoint tar "$image" -C /data -cf - . > "$tmp"
tar -tf "$tmp" >/dev/null
# Hard-link creation is atomic and fails if destination already exists.
ln -- "$tmp" "$destination"
