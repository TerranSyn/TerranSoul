# Boeing 747 reference images (judging use only)

The actual image files live in `prepared/` and are **gitignored** — they are
downloaded from Wikimedia Commons by:

```
node benchmark/boeing747/references/fetch-references.mjs
```

which normalizes each to PNG (max dimension 1024, deterministic sharp
pipeline) and records source URL, license, and sha256 per file in
`prepared/meta.json`. Judge results pin the sha256 of every reference they
saw, so a re-download can be verified against recorded runs.

These images are used ONLY as ground-truth context for the local
vision-judge model (gemma4:12b-it-qat) during benchmark scoring. They are
not bundled, shipped, or published. Per the repo's external-code/licensing
policy, license diligence before any public release is tracked in
`docs/licensing-audit.md`; the GFDL/CC items below would need attribution
review if these files were ever distributed (they are not).

## Frozen reference set (manifest.json is the machine-readable copy)

| key | file (Commons) | license | artist |
| --- | --- | --- | --- |
| `threeview` | [Boeing 747-400 3view.svg](https://commons.wikimedia.org/wiki/File:Boeing_747-400_3view.svg) | CC BY-SA 4.0 | Kaboldy |
| `side` | [Air New Zealand 747-400 sideview.jpg](https://commons.wikimedia.org/wiki/File:Air_New_Zealand_747-400_sideview.jpg) | Public domain | Adrian Pingstone |
| `front-quarter` | [Thai airways b747-400 hs-tgj arp.jpg](https://commons.wikimedia.org/wiki/File:Thai_airways_b747-400_hs-tgj_arp.jpg) | Public domain | Adrian Pingstone |
| `rear-quarter` | [Highland Express Boeing 747-100 rear Watt.jpg](https://commons.wikimedia.org/wiki/File:Highland_Express_Boeing_747-100_rear_Watt.jpg) | GFDL 1.2 | Steve Watt |
| `planform` | [Virgin atlantic b747-400 g-vbig in planform arp.jpg](https://commons.wikimedia.org/wiki/File:Virgin_atlantic_b747-400_g-vbig_in_planform_arp.jpg) | Public domain | Adrian Pingstone |
| `nose-hump` | [Boeing 747-443, Virgin Atlantic Airways, Manchester (MAN-EGCC) 06.07.09.jpg](https://commons.wikimedia.org/wiki/File:Boeing_747-443,_Virgin_Atlantic_Airways,_Manchester_-_Int._(Ringway)_(MAN-EGCC)_06.07.09.jpg) | CC BY 2.0 | eisenbahner |

Which two references each camera view is judged against is frozen in
`../rubric.json` (`view_references`). Do not swap images once benchmark runs
have been recorded — that changes the judge's ground truth.
