"""K19.1 — verify observe_outcome write tag contains the K18 reader's loc tag.

Mirrors the format strings used at the two write sites and the read site
in terransoul_brain_bridge.py. Sub-10s, no MCP, no docker.
"""

def main() -> int:
    cases = [
        (5, "West of House"),
        (12, "Kitchen"),
        (3, "  Forest Path  "),  # with whitespace
        (0, "loc_0"),  # synthetic fallback name
    ]
    for loc_id_int, loc_name in cases:
        # Write site (both observe_outcome calls)
        write_tags = f"zork,loc_{loc_id_int},loc_{loc_name.strip().replace(' ', '_')}"
        # Read site (K18 brain_suggest_action)
        room = loc_name
        room_safe = (room or "_unknown").strip() or "_unknown"
        read_tag = f"loc_{room_safe.replace(' ', '_')}"
        write_parts = write_tags.split(",")
        assert read_tag in write_parts, (
            f"[FAIL] loc_name={loc_name!r}: reader tag {read_tag!r} not in writer tags {write_parts!r}"
        )
        print(f"[PASS] loc_id={loc_id_int} name={loc_name!r:<22} write={write_tags!r}  read={read_tag!r}")
    print("\nAll 4 cases PASS — reader tag is always present in writer tag set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
