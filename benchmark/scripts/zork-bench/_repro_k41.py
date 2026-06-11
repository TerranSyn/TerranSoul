"""K41 sub-10s repro — acquire-verbs on unstable nouns must score
strictly below frontier exits.

Scenario: in any room, NLP extracts environmental phrases ("song",
"sunlight", "tree", "branches") as candidate nouns. K34 caps unstable
noun bonus at max(bonus-2, 1). For `take` with brain bonus=10, K34
gives 8, which still beats FRONTIER_BONUS=6. Result: agent constantly
picks `take <thing>` (a noop) instead of exploring untried frontier
exits.

K41 fix: when the action is an acquire-verb on an UNSTABLE noun,
additionally cap at FRONTIER_BONUS - 1. Universal text-adventure
semantic: without evidence (stable observation OR prior take-success),
acquire is the lowest signal-to-noise verb class.

Asserts:
  * `take song` (unstable, brain bonus=10) → effective bonus capped
    at FRONTIER_BONUS - 1 = 5. Total 5.
  * `open song` (unstable, brain bonus=9, NOT acquire) → effective
    bonus = max(9-2, 1) = 7 (K34 only). Total 7.
  * Frontier exit `up` (untried in this room) → 6.
  * Therefore: open(7) > frontier(6) > take(5). Agent picks
    `open` (a verb that DOES sometimes work on environmental things
    like leaves/pile) before exploring, then frontier before take.
  * Stable noun take should NOT be capped: `take leaflet` (stable,
    brain bonus=10) → 10 (no demotion). Confirms K41 only fires on
    unstable.
"""
from __future__ import annotations

FRONTIER_BONUS = 6
ACQUIRE_PREFIXES = ("take ", "get ", "grab ", "pick up ")


def k41_effective_bonus(act: str, base_bonus: int, is_stable: bool, is_inventory_item: bool) -> int:
    """Replicates K38/K39/K34/K41 demotion order for the noun-action loop."""
    act_l = act.lower()
    if is_inventory_item and any(act_l.startswith(p) for p in ACQUIRE_PREFIXES):
        return -3  # K38: blocked, returns negative score base
    if is_inventory_item:
        return max(base_bonus - 7, 0)  # K39
    if not is_stable:
        eff = max(base_bonus - 2, 1)  # K34
        if any(act_l.startswith(p) for p in ACQUIRE_PREFIXES):
            eff = min(eff, FRONTIER_BONUS - 1)  # K41
        return eff
    return base_bonus  # stable, not inventory — full bonus


def main() -> None:
    # Brain affordance bonuses (universal text-environment, from MCP).
    take_bonus = 10
    open_bonus = 9
    examine_bonus = 6

    # Unstable noun "song" (NLP false-positive from room description).
    take_song = k41_effective_bonus("take song", take_bonus, is_stable=False, is_inventory_item=False)
    open_song = k41_effective_bonus("open song", open_bonus, is_stable=False, is_inventory_item=False)
    examine_song = k41_effective_bonus("examine song", examine_bonus, is_stable=False, is_inventory_item=False)

    print(f"K41 unstable: take song={take_song} open song={open_song} examine song={examine_song}")
    print(f"K41 frontier: up={FRONTIER_BONUS}")

    assert take_song == FRONTIER_BONUS - 1, f"K41 fail: take_song={take_song}, expected {FRONTIER_BONUS - 1}"
    assert take_song < FRONTIER_BONUS, "K41: speculative take must lose to frontier"
    assert open_song > FRONTIER_BONUS or open_song == 7, f"open_song={open_song}"
    # Note: K41 ONLY targets acquire prefixes; open is unaffected (still K34 only).
    # open_song = max(9-2, 1) = 7. That's slightly above frontier=6, which is OK
    # because `open` is more likely to be useful on environmental things than `take`.

    # Stable noun "leaflet" — full bonus, no K41 cap.
    take_leaflet = k41_effective_bonus("take leaflet", take_bonus, is_stable=True, is_inventory_item=False)
    print(f"K41 stable: take leaflet={take_leaflet}")
    assert take_leaflet == 10, f"K41 should not affect stable nouns: got {take_leaflet}"

    # Inventory item — K38 blocks, K41 doesn't fire.
    take_carried = k41_effective_bonus("take leaflet", take_bonus, is_stable=True, is_inventory_item=True)
    print(f"K41 inventory: take carried leaflet={take_carried}")
    assert take_carried == -3, "K38 should block acquisition on carried"

    # K39: open carried leaflet — K39 caps at max(10-7,0)=3.
    open_carried = k41_effective_bonus("open leaflet", open_bonus, is_stable=True, is_inventory_item=True)
    print(f"K39 inventory: open carried leaflet={open_carried}")
    assert open_carried == max(open_bonus - 7, 0), "K39 cap on inventory-non-acquire"

    print("\nK41 OK — speculative acquire on unstable nouns < frontier; stable + inventory unaffected.")


if __name__ == "__main__":
    main()
