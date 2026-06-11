"""K21 sanity — add_memory writer tags must cover the K18 reader's filter.

Reader filter (brain_suggest_action ~L2390):
    ["zork", "episodic", f"loc_{room_safe.replace(' ', '_')}"]

Writer tags (add_memory ~L300, post-K21 fix):
    ["zork", kind, f"loc_{location_id}", loc_safe, f"loc_{loc_safe}"]
    where loc_safe = location_name.strip().replace(' ', '_')

The reader uses cognitive_kind="episodic" filter via the kind tag.
"""

def add_memory_tags(location_id, location_name, kind="episodic"):
    tags = ["zork", kind, f"loc_{location_id}"]
    if location_name:
        loc_safe = location_name.strip().replace(" ", "_")
        tags.append(loc_safe)
        tags.append(f"loc_{loc_safe}")
    return tags


def reader_filter(room):
    room_safe = (room or "_unknown").strip() or "_unknown"
    return ["zork", "episodic", f"loc_{room_safe.replace(' ', '_')}"]


def main() -> int:
    cases = [(5, "West House"), (12, "Kitchen"), (3, "Forest Path"), (1, "  Living Room  ")]
    for loc_id, loc_name in cases:
        w = add_memory_tags(loc_id, loc_name)
        r = reader_filter(loc_name)
        miss = [t for t in r if t not in w]
        assert not miss, f"[FAIL] loc={loc_name!r}: reader needs {miss}, writer only has {w}"
        print(f"[PASS] loc={loc_name!r:<22} writer={w}")
    print("\nReader filter is fully covered by writer tags for all 4 locations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
