# Local host protocol v1

`src/protocol.ts` describes typed messages between a browser client and its local Web Worker.
This is NOT the Minecraft network protocol and NOT a deployed multiplayer server.

Generation sessions and mesh revisions prevent stale results from replacing the current world.
The future network adapter will share commands/state contracts, but must add runtime validation,
authentication/session ownership, request sequencing, compression, rate limits and reconciliation.
