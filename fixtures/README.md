# Foundation regression fixtures

`foundation-v1.json` is a snapshot of the original prototype's 120-tick scenario.
It is NOT extracted from Minecraft and is NOT a vanilla-conformance fixture.

`npm run headless` replays the scenario in Node.js. The Playwright suite asks an actual browser
Worker to replay the same input and compares both results. Update a baseline only after reviewing
an intentional simulation change; never change a vanilla reference merely to make tests pass.
