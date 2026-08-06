#!/usr/bin/env bash
# The proxy must repair tool-call markup that leaked into a lesson body.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: the proxy forwarded `content` verbatim,
# so 21 of the 62 lessons this sweep wrote (34%) were stored with the agent's own
# tool-call syntax appended, e.g.
#     "...bit-identical in render output (cmp on the .tga).</content>
#      <parameter name="tags">pov-ray,build,...</parameter>"
# and the tag loss was ENTIRELY explained by it: 13 calls had markup AND lost
# their tags, 8 had markup alone, ZERO lost tags without markup.
#
# It is not cosmetic. The untagged `pkill` lesson was rediscovered from scratch by
# the very next task 35 minutes later, which wrote a DUPLICATE instead of
# appending — the self-improvement loop losing to a string-handling bug.
#
# VERIFIED BY REPLAY, not just by fixtures. The 28 real markup calls in this
# sweep's own trajectories were replayed through this exact logic:
#     19 had stranded tags -> ALL 19 recovered
#      9 had NOTHING to recover: "</content></invoke>", or an importance/category
#        parameter with no tags at all
# i.e. the repair gets 100% of what is recoverable. Re-run that replay against
# jobs/sweep*/**/*.jsonl before trusting a future change to these regexes -- a
# live counter reading 0 means "no markup arrived", not "the repair works", and
# that ambiguity already cost two iterations.
#
# Hermetic: a fake upstream captures what the proxy forwards. No brain needed.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="${PROXY_OVERRIDE:-$HERE/mcp-auth-proxy.mjs}"
PORT="${TB_TEST_PORT:-7448}"
UPSTREAM="${TB_TEST_UPSTREAM_PORT:-7449}"
WORK="$(mktemp -d)"
CAPTURE="$WORK/upstream.txt"
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

node -e "
const http=require('node:http'), fs=require('node:fs')
http.createServer((req,res)=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>{
  fs.appendFileSync(process.argv[1], Buffer.concat(c).toString('utf8').replace(/\n/g,' ')+'\n')
  const b=JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'ok'}]}})
  res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(b)});res.end(b)})
}).listen($UPSTREAM,'127.0.0.1')
" "$CAPTURE" &
UP=$!
trap 'kill $UP 2>/dev/null; [ -n "${P:-}" ] && kill $P 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1

TERRANSOUL_MCP_TOKEN=dummy TB_PROXY_PORT="$PORT" TB_PROXY_UPSTREAM_PORT="$UPSTREAM" \
TB_PROXY_MODE=learn TB_PROXY_LOG="$WORK/proxy.jsonl" node "$PROXY" >"$WORK/proxy.log" 2>&1 &
P=$!
for _ in $(seq 1 40); do
  curl -s -m 2 -o /dev/null -X POST "http://127.0.0.1:$PORT/mcp" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":0,"method":"tools/list"}' && break
  sleep 0.25
done

send() { curl -s -m 10 -X POST "http://127.0.0.1:$PORT/mcp" -H 'content-type: application/json' -d "$1" >/dev/null 2>&1; sleep 0.4; }
last() { tail -n1 "$CAPTURE"; }

# The real shape observed in the sweep: body, then a stray </content>, then the
# arguments that should have been separate fields.
send '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"brain_ingest_lesson","arguments":{"content":"LESSON: pkill -f from an agent shell kills the invoking shell, exit 144.</content>\n<parameter name=\"tags\">agent-shell,pkill,exit-144</parameter>\n<parameter name=\"importance\">8</parameter>","category":"lesson"}}}'

if printf '%s' "$(last)" | grep -q '</content>'; then
  no "markup_is_stripped_from_the_body" "forwarded body still contains </content>: $(last)"
else
  ok "markup_is_stripped_from_the_body"
fi
printf '%s' "$(last)" | grep -q 'exit 144' \
  && ok "the_real_lesson_text_survives" \
  || no "the_real_lesson_text_survives" "$(last)"
printf '%s' "$(last)" | grep -q '"tags":"agent-shell,pkill,exit-144"' \
  && ok "stranded_tags_are_recovered" \
  || no "stranded_tags_are_recovered" "$(last)"
printf '%s' "$(last)" | grep -q '"importance":8' \
  && ok "stranded_importance_is_recovered" \
  || no "stranded_importance_is_recovered" "$(last)"

# THE SHAPE ACTUALLY OBSERVED IN PRODUCTION (ids 1192/1193): the tail is
# UNTERMINATED -- no closing </parameter> -- because the agent's emission was cut
# off mid-tool-call. The first repair required a trailing '<' to close the
# capture, so it stripped the markup and still lost the tags, which is the whole
# thing the repair exists to recover.
send '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"brain_ingest_lesson","arguments":{"content":"LESSON: torch .pth files are zip archives; pickletools reads them with no torch installed.</content> <parameter name=\"tags\">pytorch,pth,checkpoint,zipfile,no-torch","category":"lesson"}}}'
printf '%s' "$(last)" | grep -q '"tags":"pytorch,pth,checkpoint,zipfile,no-torch"'   && ok "unterminated_tail_still_recovers_tags"   || no "unterminated_tail_still_recovers_tags" "$(last)"
printf '%s' "$(last)" | grep -q 'pickletools reads them'   && ok "unterminated_tail_keeps_the_body"   || no "unterminated_tail_keeps_the_body" "$(last)"

# DIALECT 2, taken verbatim from this sweep's trajectories (ids 1204/1205):
# bare <tags>...</tags> and <importance>N</importance> with NO name= attribute,
# closed by </invoke>. A regex written for dialect 1 matches nothing here, which
# is how the repair kept cleaning bodies while still dropping every tag.
send '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"brain_ingest_lesson","arguments":{"content":"LESSON: os.cpu_count lies under a cgroup cpu quota; read cpu.max instead.</content> <tags>cpu-quota,cgroup,torch-threads,oversubscription</tags> <importance>9</importance> </invoke>","category":"lesson"}}}'
printf '%s' "$(last)" | grep -q '"tags":"cpu-quota,cgroup,torch-threads,oversubscription"'   && ok "bare_tags_dialect_recovers_tags"   || no "bare_tags_dialect_recovers_tags" "$(last)"
printf '%s' "$(last)" | grep -q '"importance":9'   && ok "bare_importance_dialect_recovers"   || no "bare_importance_dialect_recovers" "$(last)"
printf '%s' "$(last)" | grep -q 'cpu.max instead'   && ok "bare_dialect_keeps_the_body"   || no "bare_dialect_keeps_the_body" "$(last)"

# A clean call must pass through untouched — the repair must not invent changes.
send '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brain_ingest_lesson","arguments":{"content":"LESSON: a clean body with no markup at all.","category":"lesson","tags":"clean"}}}'
if printf '%s' "$(last)" | grep -q '"content":"LESSON: a clean body with no markup at all."'; then
  ok "clean_calls_pass_through_unchanged"
else
  no "clean_calls_pass_through_unchanged" "$(last)"
fi
printf '%s' "$(last)" | grep -q '"tags":"clean"' \
  && ok "existing_tags_are_not_overwritten" \
  || no "existing_tags_are_not_overwritten" "$(last)"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
