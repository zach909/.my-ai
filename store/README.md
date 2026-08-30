# The NeuroClaw Store

Everything anyone has published, in one folder that travels with this
repository.

## Why it lives here

A published skill, plugin, binary, source drop, file or wiki page is **not**
stored on the publisher's machine. It is written into this folder, committed,
and pushed. Anyone who clones or pulls this repository gets the whole
catalogue — no account, no server anyone has to keep running, and no access to
the publisher's computer.

`git pull` is a complete sync. The catalogue is read from these files, not
from a database, so what you have on disk *is* the store.

## Layout

```
store/
  skills/<name>/     manifest.json + the skill's files
  plugins/<name>/    plugins and tools
  binaries/<name>/   binary skills / weights
  source/<name>/     source code drops
  files/<name>/      anything else
  wiki/<name>/       wiki pages published to the store
```

Each item folder has a `manifest.json` (title, description, author, dates) and
its files alongside.

## Publishing

Open to anyone, from the Store page in the app or by POSTing to `/api/store`.
The agent can publish too, through its `store` plugin.

## Installing

Nothing here installs itself. Publishing is open precisely so that running
someone else's code is not automatic — you browse, you read it, and you choose
to install it. Downloading and viewing never execute anything.

## Removal

Publishing is open; deleting is not. Removal requires the same authority as
deleting a wiki page, for the same reason: an open door for contributions must
not be an open door for destruction.

## Limits

8 MB per file, 32 MB per item, 64 files per item — because everyone who clones
this repository pays for whatever anyone pushes into it.
