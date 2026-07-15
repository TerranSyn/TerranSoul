# Boeing 747 Design & Geometry Reference

*Compiled from public Boeing specifications, Wikipedia, and aviation-engineering references. Primary variant used for headline dimensions: **Boeing 747-400** (the most-produced passenger variant and the baseline most 747 imagery depicts). The 747-8 and 747SP are called out explicitly wherever they diverge, since those divergences are themselves useful modeling signal.*

---

## 1. Overall Dimensions (747-400 baseline)

| Dimension | Value | Source |
|---|---|---|
| Overall length | 231 ft 10 in (70.66 m) | [Wikipedia: Boeing 747-400] |
| Wingspan (incl. 6 ft/1.8 m winglets) | 211 ft 5 in (64.44 m) | [Wikipedia: Boeing 747-400]; winglet height confirmed at [Farnborough Air Sciences Trust] |
| Tail height (ground to top of fin) | 63 ft 8 in (19.41 m) | [Wikipedia: Boeing 747-400] |
| Fuselage exterior diameter/width | 21 ft 4 in (6.5 m) | [flugzeuginfo.net: Boeing 747-400]; corroborated in [Jenkinson et al., *Civil Jet Aircraft Design* — Aircraft Data File] |
| Fuselage exterior height (max, at the hump) | ~26 ft 7 in (8.10 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Fuselage fineness ratio (length ÷ diameter) | 10.56 | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Interior cabin width | ~20 ft (6.1 m) | multiple aviation reference sites (general widebody-cabin corroboration), width less than exterior 6.5 m due to sidewall/insulation thickness |
| Wheelbase (nose gear to main gear) | ~84 ft (25.60 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Main gear track (left-to-right) | 36 ft 1 in (11.00 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Landing gear wheel count | 16 main wheels (four 4-wheel bogies: two under the wing roots, two under the centerline fuselage) + 2 nose wheels | [Wikipedia: Boeing 747] |

**Variant deltas (same fuselage cross-section, different length/tail geometry):**
- **747-8** (Intercontinental/Freighter): length 250 ft 2 in (76.25 m) — an 18.3 ft (5.6 m) stretch over the -400; wingspan 224 ft 7 in (68.4 m), the largest of any 747; vertical tail height "largely unchanged" at 63 ft 6 in (19.35 m); fuselage width unchanged at 21 ft 4 in (6.5 m). [Wikipedia: Boeing 747-8]
- **747SP**: length only 183 ft 3 in (55.85 m) — fuselage shortened by 47–48 ft versus the -100/-200 while keeping the full wing, tail structure enlarged; height is actually *taller* than the -400 at 65 ft 10 in (20.06 m) because of an enlarged vertical stabilizer needed to compensate for the shorter tail moment arm. [Wikipedia: Boeing 747SP]; [SimpleFlying: "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design..."]

**Modeling takeaway:** all 747 variants share one fuselage cross-section (~6.5 m diameter); only overall length and vertical-tail size change meaningfully between variants.

---

## 2. Wing Geometry

| Parameter | Value | Source |
|---|---|---|
| Leading-edge sweep angle | 37.5° | [Wikipedia: Boeing 747] — commonly cited figure enabling Mach 0.85 cruise |
| Quarter-chord sweep | 35.5° | technical aircraft-design course notes (Scholz, HAW Hamburg) — the lower figure reflects sweep measured at 25% chord rather than the leading edge; use 37.5° for a leading-edge silhouette |
| Dihedral angle | 7° | corroborated across [aircraftinvestigation.info: Boeing 747-8I performance] and general aerodynamics references |
| Wing incidence | ~2° | aircraft-design course notes (Scholz, HAW Hamburg) |
| Aspect ratio | 6.96 (747-100/-200) → 7.39 (747-400, pre-winglet reference area) | [Jenkinson et al., *Civil Jet Aircraft Design*]. Note: sources vary 7.4–7.9 for the winglet-equipped -400 depending on whether winglet span/area is folded into the reference figure — this is a genuine literature inconsistency, not a single hard number. |
| Taper ratio (tip chord ÷ root chord) | 0.284 (747-100/-200), 0.275 (747-400) | [Jenkinson et al., *Civil Jet Aircraft Design*]; other sources round to ~0.25 |
| Mean aerodynamic chord | 9.80 m (747-100/-200), 9.68 m (747-400) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Wing reference area | ~525 m² (5,650 ft²) per the engineering data table; ~541.2 m² (5,825 ft²) is the figure most commonly quoted on general aviation-spec sites | [Jenkinson et al., *Civil Jet Aircraft Design*] vs. general web consensus — flagged discrepancy, not resolved in sources found |
| Wing planform shape | Continuously tapering chord from root to tip (no straight-then-tapered "kink" panel); leading edge has Krueger flaps running almost its entire span | [Wikipedia: Boeing 747] |

**Modeling takeaway:** a single swept trapezoidal wing (~37.5° leading-edge sweep, taper ratio ~0.27–0.28, mild 7° dihedral) built from one primitive per side, mirrored across the fuselage centerline, is geometrically correct — the 747 wing has no separate outboard "kink" panel the way some later widebodies do.

---

## 3. The Upper-Deck "Hump"

**Origin/purpose:** the hump exists because Boeing's original launch customer (Pan Am) wanted a hinged, front-loading nose cargo door for eventual freighter conversion. Since the cockpit couldn't be split around a nose door, it was raised onto a short upper deck behind the nose — this is the origin of the hump, not an aerodynamic styling choice. [Smithsonian Air & Space Magazine: "How the 747 Got Its Hump"]; [Wikipedia: Boeing 747]

**Shape evolution:** Boeing's first hump concept was a hemispherical bump, which produced too much drag; the aft portion was stretched into a teardrop profile to fair it back into the main fuselage — this is why the hump has a long, gently-sloped aft taper rather than a blunt step-down. The extra internal volume was originally used as a lounge/bar (later converted to seating after the 1973 fuel crisis). [Smithsonian Air & Space Magazine]

**Length by variant** (this is the single most useful hard data point for hump proportions):

| Variant | Upper-deck length | Source |
|---|---|---|
| 747-100 / -200 | 20 ft (6.1 m) | [SimpleFlying: "Why The Boeing 747's Upper Deck Hump Will Be Nearly Impossible To Replicate In A Modern Jet"] |
| 747SP | 39 ft (11.9 m) | same |
| 747-300 | 43 ft (13.1 m) | same |
| 747-400 | 54 ft (16.5 m) | same |
| 747-8I | 73 ft (22.2 m) | same |

**Position along the fuselage:** on the -100/-200, the short hump sits entirely *ahead of* the wing box. Starting with the 747SP, Boeing extended the hump aft so it begins over the section of fuselage containing the wing box rather than ahead of it — this "mated to the wing box" profile then carried over to the -300, -400, and -8. [Wikipedia: Boeing 747SP]; [SimpleFlying: "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design..."]

**Derived fraction (747-400, computed from the cited absolute dimensions above, not itself a separately published percentage):** hump length 16.5 m ÷ total length 70.66 m ≈ **23% of overall fuselage length**. The hump starts almost immediately aft of the cockpit glazing — roughly 6–8% of total length aft of the nose tip — and, given the 23% length, ends around **29–31% of total length from the nose**, consistent with the sourced fact that the -400's extended hump reaches back over the wing box (wing root leading edge sits in roughly that same region on large widebodies).

**Not full-length:** unlike the Airbus A380, the 747's upper deck never runs the full fuselage — it is explicitly a partial, humped second level "not along the whole fuselage." [Aircraft Recognition Guide: Boeing 747]

**Windows:** early -100s had 6 upper-deck windows (3 per side); later stretched-upper-deck variants have up to 10 per side. [Wikipedia: Boeing 747]

---

## 4. Engine Placement

- **Count:** 4 engines. [Wikipedia: Boeing 747]
- **Mounting:** all four underwing on pylons (no tail-mounted or fuselage-mounted engines). [Wikipedia: Boeing 747]
- **Numbering/position convention:** engines are numbered left-to-right from the pilot's forward-facing perspective — Engine 1 = outboard left, Engine 2 = inboard left, Engine 3 = inboard right, Engine 4 = outboard right. [Airliners.net forum: "How Are Engines Numbered?"]
- **Leading-edge flap segmentation as a position marker:** the wing's Krueger flaps run in a distinct 3-segment "flip-over" arrangement between the fuselage root and the *inboard* engine, transitioning to a different drooping leading-edge flap design for the rest of the span out to the tip — meaning the inboard engine sits roughly at the flap-type transition point, a useful landmark distinct from the outboard engine's further-out position. [Wikipedia: Boeing 747]
- **Spare-engine capability:** the 747 can carry a non-functioning fifth "pod" engine slung under the left wing, positioned between the inner functioning engine and the fuselage — evidence that there is deliberate clearance in that inboard region. [Wikipedia: Boeing 747]
- **Spanwise placement (geometric approximation, not independently sourced):** consistent with the general silhouette of a quad underwing-mounted widebody, the inboard pair sits close to the wing root/kink region and the outboard pair sits further out toward mid-span; all four nacelles hang forward of and below the leading edge on pylons, a standard underwing-jet arrangement for clearance and flutter avoidance. Treat exact span-fraction placement as a visual approximation rather than a cited figure — no source found gives precise percentages.

---

## 5. Tail Geometry (747-400 baseline)

| Parameter | Value | Source |
|---|---|---|
| Vertical stabilizer height (above fuselage) | 33 ft 4 in (10.16 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Vertical tail area | 77.10 m² | same |
| Vertical tail aspect ratio | 1.34 (a short, wide-chord fin relative to its height) | same |
| Horizontal stabilizer span | ~72 ft 5 in–72 ft 9 in (22.08 m) | [Jenkinson et al., *Civil Jet Aircraft Design*], corroborated by independent forum sourcing |
| Horizontal tail area | 136.60 m² | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Horizontal tail aspect ratio | 3.57 (noticeably more slender/tapered than the vertical fin) | same |

**Proportion to fuselage:** the vertical fin height (10.16 m) is roughly 1/7 of overall fuselage length, and roughly half the fuselage's own cross-sectional height (8.1 m) — i.e., the fin is a comparatively short, deep-chord surface rather than a tall slender one. The horizontal stabilizer span (22.08 m) is about 1/3 of the main wingspan.

**Variant note — tail size is NOT constant:** the 747SP required an enlarged vertical stabilizer (and taller overall height, 20.06 m vs. the -400's 19.41 m) purely to restore directional stability lost from the shortened fuselage/reduced tail moment arm — proof that 747 tail size scales with fuselage length, it is not a fixed proportion across all variants. [Wikipedia: Boeing 747SP]. By contrast, the 747-8's vertical tail height (19.35 m) is "largely unchanged" from the -400 despite the longer fuselage. [Wikipedia: Boeing 747-8]

**Tail cone shape:** rounded tail cone with the APU exhaust centered in it. [Aircraft Recognition Guide: Boeing 747]

---

## 6. Fuselage Cross-Section & Nose/Tail Taper

- **Cross-section shape:** the 747 uses a single **circular** fuselage cross-section — this was a departure from Boeing's earlier "double-bubble"/figure-8 cross-section (two intersecting circles of different radii joined by the cabin floor, as used on the Boeing 377 Stratocruiser). The upper-deck hump on the 747 is a separate raised pod sitting on top of the circular main fuselage, not a merged double-bubble shape. [Wikipedia: Boeing 377 Stratocruiser] (for the double-bubble contrast); [Aircraft Recognition Guide: Boeing 747] (confirms 747 keeps a consistent circular cross-section)
- **Key cross-section numbers:** exterior diameter 6.5 m; exterior height at the widest point (including the hump) ~8.1 m; interior cabin width ~6.1 m. [Jenkinson et al., *Civil Jet Aircraft Design*]; general references
- **Nose/tail taper (generic estimate — no single sourced fuselage-station table was found for exact percentages):** consistent with standard large-widebody jet proportions and the 747's fineness ratio of 10.56, the nose taper (radome + cockpit section back to full constant-diameter fuselage) spans roughly the first ~8–12% of total length, while the tail taper (aft cabin bulkhead back to the tail cone tip) is longer and shallower, spanning roughly the last ~15–20% of total length. These are reasoned proportions typical of jet transports of this fineness ratio, not independently cited 747-specific fractions — flagged explicitly as an estimate rather than a hard fact.

---

## 7. Livery/Paint Conventions (generic, light-touch)

- **Cheatline:** a decorative horizontal stripe along the fuselage sides, historically used to visually "cheat the eye" into de-emphasizing the staccato rhythm of cabin windows; can be a single band ("rule") or multiple bands ("tramlines"), often incorporating the airline's title/emblem/colors. Cheatlines run either along, above, or below the window line. [Wikipedia: Aircraft livery]; [SimpleFlying: "What Is A Cheatline On An Aircraft Livery?"]
- **Dominant modern convention — "Eurowhite":** since the 1970s, most major-carrier liveries use a predominantly **white fuselage**, with the airline's brand colors concentrated on the vertical tail and engine nacelles; this also suits leased aircraft, which can be repainted between operators with minimal surface-area changes. [Wikipedia: Aircraft livery]
- **Belly:** typically left unpainted white/light gray on the lower fuselage in most modern liveries, consistent with the overall white-dominant convention above; a full-color cheatline (if present) sits at or just below the window line, well above the belly.
- **Cheatlines today are the exception, not the rule** — most current mainline liveries have dropped them in favor of plain white with tail/engine branding; airlines that retain a cheatline (e.g., Singapore Airlines' dark blue/gold stripe) are now the recognizable outliers. [SimpleFlying: "What Is A Cheatline On An Aircraft Livery?"]

---

## 8. Window & Door Row Rhythm (generic widebody convention)

- **Structural frame spacing:** most commercial jet fuselages use structural frames spaced about **20 inches (0.51 m)** apart (e.g., 737, A320); wider-body/later designs vary — 777 uses 21 in, 787 uses 24 in, A350/A380 use 25 in. [Dretloh.com: "Why Aren't the Windows Aligned with the Seats in Aircraft?"]; [Airliners.net forum: "Frame Pitch or Window Spacing Data"]
- **Window placement rule:** cabin windows are centered *between* structural frames rather than on them, and are typically placed at every other frame bay — meaning window pitch (center-to-center spacing) is roughly double the frame pitch, i.e. commonly in the **~38–40 inch** range on classic designs. This is also why window spacing rarely lines up exactly with seat-row pitch (which is independently set by cabin configuration, e.g. 31–34 in economy pitch). [Dretloh.com]; [Airliners.net forum: "Frame Pitch or Window Spacing Data"]
- **Door count context (747-400 specific, for row-rhythm scale reference):** the 747 has multiple large upper-body doors per side along the main deck (numbered sequentially, e.g., Doors 1–4 plus a Door 5 near the tail) spaced at roughly even intervals corresponding to the cabin's structural zones; the 747SP, having a shorter fuselage, has **one fewer door per side** than the standard-length variants. [Wikipedia: Boeing 747SP]; general Boeing airport-planning documentation (door numbering referenced but not independently re-verified in full detail here)
- **Modeling takeaway:** for a primitives-based widebody, a regular window strip with pitch roughly double the "frame" spacing, and door cutouts placed at a handful of evenly-spaced structural zones along the lower half of the fuselage side, is a reasonable generic approximation — exact 747-specific door fuselage-station coordinates were not found in publicly accessible sources during this research pass.

---

## Sources

- [Wikipedia: Boeing 747](https://en.wikipedia.org/wiki/Boeing_747)
- [Wikipedia: Boeing 747-400](https://en.wikipedia.org/wiki/Boeing_747-400)
- [Wikipedia: Boeing 747-8](https://en.wikipedia.org/wiki/Boeing_747-8)
- [Wikipedia: Boeing 747SP](https://en.wikipedia.org/wiki/Boeing_747SP)
- [Wikipedia: Boeing 377 Stratocruiser](https://en.wikipedia.org/wiki/Boeing_377_Stratocruiser)
- [Wikipedia: Aircraft livery](https://en.wikipedia.org/wiki/Aircraft_livery)
- [flugzeuginfo.net — Boeing 747-400 Specifications](https://www.flugzeuginfo.net/acdata_php/acdata_7474_en.php)
- [Jenkinson, Simpkin & Rhodes, *Civil Jet Aircraft Design* — Aircraft Data File (Butterworth-Heinemann / Elsevier)](https://booksite.elsevier.com/9780340741528/appendices/data-a/table-3/table.htm)
- [SimpleFlying — "Why The Boeing 747's Upper Deck Hump Will Be Nearly Impossible To Replicate In A Modern Jet"](https://simpleflying.com/why-boeing-747-upper-deck-hump-nearly-impossible-replicate-modern-jet/)
- [SimpleFlying — "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design Will Be Nearly Impossible To Replicate In 2026"](https://simpleflying.com/boeing-747sp-fuselage-design/)
- [Smithsonian Air & Space Magazine — "How the 747 Got Its Hump"](https://www.smithsonianmag.com/air-space-magazine/how-the-747-got-its-hump-4578877/)
- [SimpleFlying — "What Is A Cheatline On An Aircraft Livery?"](https://simpleflying.com/aircraft-livery-cheatline/)
- [Dretloh.com — "Why Aren't the Windows Aligned with the Seats in Aircraft?"](https://dretloh.com/airplane-windows/)
- [Airliners.net forum — "Frame Pitch or Window Spacing Data"](https://www.airliners.net/forum/viewtopic.php?t=1340405)
- [Airliners.net forum — "How Are Engines Numbered?"](https://www.airliners.net/forum/viewtopic.php?t=737945)
- [Farnborough Air Sciences Trust — "Aircraft on Display: Boeing 747-400 Winglets"](https://airsciences.org.uk/aircraft-on-display-boeing-747-400-winglets/)
- [Aircraft Recognition Guide — Boeing 747](https://www.aircraftrecognitionguide.com/boeing-747)
- [aircraftinvestigation.info — Boeing 747-8I performance](https://aircraftinvestigation.info/airplanes/Boeing_747-8I.html)
- Scholz, D. — Aircraft Design course notes, HAW Hamburg (wing sweep/dihedral/incidence cross-reference, surfaced via web search, not independently re-fetched)
