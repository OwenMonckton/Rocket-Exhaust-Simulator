# Fingerprints of the plume grid before the expansion-deflection change

Taken with `fingerprint(name)` in `src/dev/accuracy.ts` at commit 7ebb87c (before any change to
`src/render/fluidSim.ts`), on 25 November 2026, in the Claude desktop app's built-in browser, on
"ANGLE (Intel, Intel(R) UHD Graphics 730 (0x00004682) Direct3D11 vs_5_0 ps_5_0, D3D11)".

Each case runs the plume grid alone from cold for 240 frames, the fire ramped up over the first
60, and gives the sum of every number in the grid (the gas state and the exhaust amount), the sum
of their squares, and the count of cells that are not numbers. Each was run twice and gave the
same string both times.

| Case | What it is | Fingerprint |
|---|---|---|
| `bell` | Merlin 1D at sea level, jet from the whole nozzle | `1338547.4418925592 14572161.179692116 bad=0` |
| `aerospike` | XRS-2200 at sea level: a ring of gas at the lip of a solid spike | `913148.81585065660 7487920.1513556857 bad=0` |
| `extensionSeated` | RL10B-2 at 60 km, extension seated: a curved wall in the grid | `227147.84393119425 1114930.3024551545 bad=0` |
| `extensionHalf` | RL10B-2 at 60 km, extension halfway along its travel | `213964.34721942496 987621.48865292338 bad=0` |

After the change these must be identical, on the same machine and browser. A different graphics
card or driver may round differently and give other sums; that is not a failure of the change.
