# Storage boundary — not implemented yet

E06 remains open. The current app does not save worlds to IndexedDB, localStorage or a server.
The in-memory section snapshots and session edit map are not persistent saves.

Next implementation: versioned manifest and consistent world snapshot → storage adapter → atomic save/recovery → migration/export tests. The simulation must not import browser storage APIs.
