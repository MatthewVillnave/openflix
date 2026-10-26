# Local self-hosted candidate

This is a source-build candidate, not a published release or native installer. Docker Engine with Compose v2, a working internet connection for pinned build dependencies, and an existing Jellyfin server are required. The package contains OpenFlix source and container definitions; it does not install or include Jellyfin, media, accounts or a master key.

The local configuration binds the web interface to `127.0.0.1:8080`. It uses HTTP and is intended only for the computer running Docker. It is not a LAN or public deployment; use the separate HTTPS reverse-proxy configuration for remote access. Before enabling any network access, complete the first owner setup: the first person to create an account becomes the administrator.

From the extracted package, generate a private key once and store it outside the source tree in a private operator-owned environment file. For example, in a terminal on the host:

```sh
umask 077
mkdir -p "$HOME/.config/openflix"
( set -C; printf 'OPENFLIX_MASTER_KEY=%s\n' "$(openssl rand -base64 32)" > "$HOME/.config/openflix/local.env" )
chmod 600 "$HOME/.config/openflix/local.env"
docker compose --env-file "$HOME/.config/openflix/local.env" -f docker-compose.local.yml up --build -d --wait
```

Run the key creation only for a new installation. Replacing or losing this key makes existing encrypted Jellyfin credentials unavailable. Existing users should preserve and reuse their original key. Open `http://127.0.0.1:8080`, create the first OpenFlix administrator account, then connect your own Jellyfin account in Settings. The first OpenFlix account is separate from Jellyfin. Additional users currently require the operator's interactive command:

```sh
docker compose --env-file "$HOME/.config/openflix/local.env" -f docker-compose.local.yml exec server node dist/cli.js user:create USERNAME
```

Use a real unique username; the interactive prompt hides the password. `--admin` grants administrator authority and should only be used deliberately. Each person then links their own Jellyfin identity.

Stop with `docker compose --env-file "$HOME/.config/openflix/local.env" -f docker-compose.local.yml down`; restart with the same command used for startup and the same project directory, key and named volume. For an update, stop the old version, back up as below, extract the new source into the same project directory and rebuild. Check migrations and release notes before changing versions; a rollback may require restoring the pre-update backup. Avoid a different Compose project name, which selects a different volume.

For a consistent backup, first capture the actual volume and image from the running server, then stop the services and archive the complete volume. This example writes a private unencrypted backup outside the source directory; protect it with your backup system:

```sh
(
set -eu
candidate_server=$(docker compose --env-file "$HOME/.config/openflix/local.env" -f docker-compose.local.yml ps -q server)
[ -n "$candidate_server" ] || { echo 'Server container not found' >&2; exit 1; }
candidate_volume=$(docker inspect "$candidate_server" --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}')
candidate_image=$(docker inspect "$candidate_server" --format '{{.Image}}')
[ -n "$candidate_volume" ] && [ -n "$candidate_image" ] || { echo 'Volume or image missing' >&2; exit 1; }
docker compose --env-file "$HOME/.config/openflix/local.env" -f docker-compose.local.yml stop
sh scripts/backup-volume.sh "$candidate_volume" "$candidate_image" "$HOME/.config/openflix/backup.tar"
)
```

The backup command refuses to replace an existing `backup.tar`; choose a new filename for each recovery point. If it fails, the stopped services can be restarted with the normal startup command. Back up the key separately and securely. Treat the backup as sensitive: it contains account data and encrypted connector tokens. Test restoration into a separate isolated project before relying on it. Do not copy production data or keys into a test instance without authorization.

To restore a trusted backup into a **new, empty** volume for an isolated project, stop the original local service first so port 8080 is free. The example below refuses to overwrite an existing restore volume. It uses the same key file; without the original key, saved Jellyfin credentials cannot be decrypted.

```sh
restore_volume=openflix-restore-test_openflix-config
if docker volume inspect "$restore_volume" >/dev/null 2>&1; then
  echo 'Restore volume already exists; choose a new project name.'
else
  docker volume create "$restore_volume" &&
    docker run --rm -i --network none --user 0 --mount "type=volume,src=$restore_volume,dst=/data" --entrypoint tar "$candidate_image" -C /data -xf - < "$HOME/.config/openflix/backup.tar" &&
    docker compose --env-file "$HOME/.config/openflix/local.env" -p openflix-restore-test -f docker-compose.local.yml up --build -d --wait
fi
```

Confirm the restored account can sign in and that its settings are present, then stop the restore project with `docker compose --env-file "$HOME/.config/openflix/local.env" -p openflix-restore-test -f docker-compose.local.yml down`. This leaves the restored volume intact. Archive extraction is appropriate only for a backup you trust. Do not restore over a volume containing data you need.

Uninstall containers with `docker compose ... down`; this leaves the named data volume and key in place. Removing a volume or key permanently destroys access to its contents and is a separate explicit decision. Docker image removal does not remove that volume.

The footer links to a locally served archive generated from the first-party source used for the container build. A separate local `openflix-third-party-material.tar.gz` companion preserves selected upstream material but is not automatically served and is not verified as complete. Before distributing or serving modified builds, provide applicable complete third-party corresponding source and notices as described in [licensing](licensing.md). `OPENFLIX_SOURCE_URL` is a public build-time complete source offer, not a secret. Do not point it at an older release that lacks this branch's changes.
