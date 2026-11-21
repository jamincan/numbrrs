# Backups and restore

Numbrrs keeps everything it stores in one SQLite file on one Fly volume.

|           |                                                                               |
| --------- | ----------------------------------------------------------------------------- |
| App       | `numbrrs`                                                                     |
| Volume    | `vol_vjyk76mg6yz027zv` — named `data`, 1 GB, region `yyz`, mounted at `/data` |
| Database  | `/data/numbrrs.db`, in WAL mode                                               |
| Snapshots | Taken by Fly daily and kept 5 days, as of 2026-11-21                          |

**Last drilled: never.** After each [drill](#the-drill), replace this line with
the date, how old the snapshot was, and how long the restore took.

> [!WARNING]
> **Untested until the first drill.** No command on this page has been run
> against production. The `flyctl` spellings were checked against `flyctl --help`
> (v0.4.3) and Fly's documentation, and the two `node -e` lines were run against a
> scratch database; the sequences as a whole have not been exercised. When the
> drill finds something wrong, fix it here.

## What is worth restoring

| Tables                           | If lost                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `teams`, `players`, `sync_state` | Nothing. They are copies of the leagues' feeds, and the app fetches them again within minutes.     |
| `events`, `errors`               | Gone for good: up to 90 days of page views and the error history. `/admin` starts again from zero. |

Nothing a visitor sees depends on the second row. So when the site is down and
the clock matters, take path A and accept the gap in the charts; take path B
when the history is worth the extra steps. A daily snapshot is up to 24 hours
old, so path B loses up to a day of history as well.

## Path A — start empty

```sh
flyctl volumes create data -r yyz -s 1 -a numbrrs
```

The name has to be `data`, which is what `[mounts]` in `fly.toml` asks for. Then
[put a machine on it](#swapping-a-volume-in).

What the first minutes look like:

- The server creates the schema at boot, and `/api/health` answers 200 as soon
  as it is listening.
- The first request for the home page waits on the five leagues' team lists, for
  up to 8 seconds. A league that has not answered by then shows "Teams are still
  syncing" until a later request finds its list.
- A minute after boot the hourly sweep starts and fetches every roster, which
  takes a few minutes. A team page opened before its roster arrives fetches that
  one roster on the spot, and is not cached at the edge until it has one. The
  resync button on `/admin` starts the same walk without waiting for the sweep.

## Path B — restore a snapshot

```sh
flyctl volumes snapshots list vol_vjyk76mg6yz027zv -a numbrrs
flyctl volumes create data --snapshot-id <snapshot id> -s 1 -r yyz -a numbrrs
```

If the volume itself has been destroyed, `flyctl volumes list --all -a numbrrs`
still shows its ID for the first command. Then
[put a machine on the new volume](#swapping-a-volume-in).

The restored database has the schema it had when the snapshot was taken, and the
server migrates it forward at boot to whatever its image expects. So when the
reason for restoring is a migration that went wrong, roll the image back
_first_ (the README's [Roll back](../README.md#roll-back)) and swap the volume
second — otherwise the new machine applies the same migration to the restored
copy.

## Swapping a volume in

A machine gets its volume when it is created, so swapping means a new machine.

**If the app's machine still exists**, clone it onto the new volume, check the
clone, then remove the original:

```sh
flyctl machine list -a numbrrs
flyctl machine clone <old machine id> --attach-volume <new volume id>:/data -r yyz -a numbrrs
flyctl status -a numbrrs                      # the clone is started and passing its check
flyctl machine destroy <old machine id> --force -a numbrrs
```

For the minute both exist, requests land on either. Stopping the old machine
first does not avoid that: `auto_start_machines` starts it again on the next
request.

**If there is no machine**, make sure the new volume is the only unattached one
named `data` (`flyctl volumes list -a numbrrs`), then deploy the image that was
running, from a checkout of the deployed commit:

```sh
flyctl releases --image -a numbrrs
flyctl deploy --image <image reference> --ha=false -a numbrrs
flyctl volumes list -a numbrrs                # the new volume now shows a machine attached
```

Afterwards, either way:

- Check `https://numbrrs.app/api/health`, the home page and `/admin`.
- Destroy the old volume once the site checks out
  (`flyctl volumes destroy <old volume id> -a numbrrs`). An unattached volume
  named `data` is a trap: a machine created later can attach to it instead.
- The new volume has a new ID and Fly's default snapshot retention. Update the
  ID on this page and in the README's dashboard table, and set the retention
  again if it had been raised
  (`flyctl volumes update <volume id> --snapshot-retention <days> -a numbrrs`).

## The drill

This proves that a snapshot opens as a healthy database, and times it. It
touches neither the live volume nor the app's machine.

```sh
flyctl volumes snapshots list vol_vjyk76mg6yz027zv -a numbrrs
flyctl volumes create restore_drill --snapshot-id <newest snapshot id> -s 1 -r yyz -a numbrrs
flyctl releases --image -a numbrrs            # the image reference of the newest release
flyctl machine run <image reference> --shell -a numbrrs -r yyz -v <drill volume id>:/restore
```

The volume is named `restore_drill`, not `data`, so nothing looking for the
app's volume can pick it up. `--shell` matters: it starts the throwaway machine
on `sleep` instead of the server, opens a shell on it, and destroys the machine
when the shell exits. Without it the image would start a second copy of the app,
with the app's secrets.

In that shell:

```sh
ls -la /restore                               # numbrrs.db and its -wal and -shm
cd /app
node -e "const d=require('better-sqlite3')('/restore/numbrrs.db');console.log(d.pragma('integrity_check'),new Date(d.prepare('select max(at) as at from events').get().at).toISOString())"
exit
```

A good restore prints `[ { integrity_check: 'ok' } ]` and the time of the newest
page view, which should fall shortly before the snapshot was taken. Then clean
up, reading the ID twice — destroying a volume has no undo:

```sh
flyctl volumes destroy <drill volume id> -a numbrrs
flyctl volumes list -a numbrrs                # only vol_vjyk76mg6yz027zv, attached
flyctl machine list -a numbrrs                # only the app's machine
```

Record the date, the snapshot's age and the minutes from the first command to
the printed timestamp in the "Last drilled" line at the top.

## Before a deploy that migrates

Whenever the commit being deployed adds a file to `drizzle/`:

```sh
flyctl volumes snapshots create vol_vjyk76mg6yz027zv -a numbrrs
flyctl volumes snapshots list vol_vjyk76mg6yz027zv -a numbrrs     # wait for it to show as created
```

Migrations run at boot and nothing un-applies them, so this snapshot is the only
way back from one that damages data, and unlike the daily one it is minutes old
rather than up to a day. Note its ID until the deploy has been checked.

A snapshot is a copy of the disk taken while the server is writing to it.
SQLite's write-ahead log is what makes such a copy openable, the same way the
database survives a power cut; the drill is what shows that it does.

## Pulling a copy of the production database

Do not download `/data/numbrrs.db` as it stands. In WAL mode the newest writes
sit in `numbrrs.db-wal` beside it, so the main file copied on its own is stale
at best and inconsistent at worst. Have SQLite write a consistent single-file
copy first:

```sh
flyctl ssh console -a numbrrs
```

```sh
# on the machine
cd /app
node -e "require('better-sqlite3')('/data/numbrrs.db',{readonly:true}).backup('/tmp/numbrrs-copy.db').then(()=>console.log('done'))"
exit
```

```sh
# back on your own computer
flyctl ssh sftp get /tmp/numbrrs-copy.db <a folder outside OneDrive>/numbrrs-copy.db -a numbrrs
flyctl ssh console -a numbrrs -C "rm /tmp/numbrrs-copy.db"
```

The copy contains the analytics and error rows, which the privacy page says
stay in the site's database and its backups, read by one person. So keep it out
of this repository's folder, which syncs to OneDrive — `.gitignore` keeps `*.db`
out of git, but does nothing about the sync — and delete it when the question
that needed it is answered.
