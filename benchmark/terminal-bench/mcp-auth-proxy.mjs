#!/usr/bin/env node
// Header-injecting MCP proxy for Terminal-Bench D-G.
//
// WHY THIS EXISTS — measured 2026-08-04, see rules/tbench-playbook.md.
//
// Harbor CANNOT pass MCP auth headers. Its
// `claude_code.py::_build_register_mcp_servers_command` serialises every
// non-stdio server as exactly `{"type": transport, "url": server.url}` — a
// `headers` block in --mcp-config is silently dropped, and the stdio branch
// carries no `env` either. TerranSoul's MCP router accepts only
// `Authorization: Bearer <token>` (router.rs::validate_auth), so the task
// container could reach the brain but never authenticate: the trial reported
// `"mcp_servers":[{"name":"terransoul","status":"failed"}]` and would have
// scored plain Claude Code while carrying TerranSoul's name.
//
// This proxy takes the container's unauthenticated request and adds the
// header on the host side, so the real token never enters the container.
//
// READ-ONLY BY DEFAULT, deliberately. TB-3's acceptance criterion is
// literally "0 brain writes during a 5-task run", and rules/bench-agi-purity.md
// forbids a benchmark contaminating the brain it is being measured against.
// The allowlist below mirrors router.rs::is_public_tool_name exactly. Set
// TB_PROXY_ALLOW_WRITES=1 to lift it (and then do NOT publish the run as a
// clean measurement).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const LISTEN_PORT = Number(process.env.TB_PROXY_PORT || 7425)
const UPSTREAM_HOST = process.env.TB_PROXY_UPSTREAM_HOST || '127.0.0.1'
const UPSTREAM_PORT = Number(process.env.TB_PROXY_UPSTREAM_PORT || 7423)
const ALLOW_WRITES = process.env.TB_PROXY_ALLOW_WRITES === '1'
const LOG_PATH = process.env.TB_PROXY_LOG || ''

// Mirrors src-tauri/src/ai_integrations/mcp/router.rs::is_public_tool_name.
// Kept as an explicit copy rather than imported: this is a bench-scoped guard,
// and if the server's list ever changes we want the divergence to be visible
// here rather than silently inherited.
//
// ⚠️ MEASURED 2026-08-04: this list is a SUPERSET of what the server actually
// serves. `is_public_tool_name` is the LAN-anonymous READ POLICY; the tools on
// the wire are `tools.rs::EXPOSED_TOOLS`, an owner-approved 9-tool product API
// (2026-08-01, "one coherent CRUD+RAG API", down from 84). Five names below —
// brain_suggest_context, brain_summarize, brain_list_recent, brain_failover_status
// and every brain_wiki_* — are allowlisted here but are NOT advertised by the
// server, so allowing them changes nothing. Harmless as a permission, actively
// misleading as a description: keep the policy mirror intact, and tell the
// agent about EXPOSED_BRAIN_TOOLS instead (see gate()).
const READ_ONLY_TOOLS = new Set([
  'brain_search',
  'brain_get_entry',
  'brain_list_recent',
  'brain_kg_neighbors',
  'brain_summarize',
  'brain_suggest_context',
  'brain_health',
  'brain_failover_status',
  'brain_wiki_audit',
  'brain_wiki_spotlight',
  'brain_wiki_serendipity',
  'brain_wiki_revisit',
])

// The brain tools genuinely ON THE WIRE — mirrors tools.rs::EXPOSED_TOOLS.
// Used only to tell a refused caller what it CAN call, so the proxy never
// advertises a tool the server does not serve.
const EXPOSED_BRAIN_TOOLS = [
  'brain_search',
  'brain_get_entry',
  'brain_kg_neighbors',
  'brain_health',
  'brain_ingest_lesson',
  'brain_append',
  'brain_add_edge',
  'brain_close_edge',
  'brain_delete_memory',
]

// Tools whose reads reach the HOST rather than the brain. Blocked for a
// different reason than writes are, and the refusal says so (see gate()).
const HOST_SCOPED_PREFIXES = ['code_', 'repo_', 'obs_', 'canvas_', 'cross_source_']

// TB_PROXY_MODE=learn — cross-trial learning (owner decision 2026-08-04).
// Adds exactly the tools needed for trial N to record what it learned so trial
// N+1 can retrieve it, and NOTHING else. Blanket TB_PROXY_ALLOW_WRITES=1 would
// also hand the container brain_clear_memory and brain_delete_memory; an agent
// running untrusted benchmark code should never be one bad call away from
// wiping the store it is being measured with.
const LEARN_MODE = process.env.TB_PROXY_MODE === 'learn'
// The full self-learning surface, not just "write a lesson":
//   brain_ingest_lesson  record something new
//   brain_append         REFINE an existing entry instead of creating a
//                        near-duplicate (saves a version snapshot, re-embeds)
//   brain_add_edge       link entries into the knowledge graph
//   brain_close_edge     retract a link that turned out to be wrong
// Deliberately still excluded: brain_delete_memory and anything destructive.
// An agent running untrusted benchmark code may refine and relate what it
// knows; it may not erase it.
// Write tools that carry a prose `content` argument the markup can contaminate.
const LESSON_TOOLS = new Set(['brain_ingest_lesson', 'brain_append'])

const LEARN_TOOLS = new Set([
  'brain_ingest_lesson',
  'brain_append',
  'brain_add_edge',
  'brain_close_edge',
])

// TB_DEFER_WRITES=1 — makes k=5 submittable WITHOUT cross-attempt leakage.
//
// The leaderboard requires >=5 trials per task (leaderboard/SUBMIT.md), but
// with a writable memory attempt 1 of a task could record a lesson that
// attempts 2..5 of the SAME task then retrieve, inflating pass@k.
//
// Rather than filtering reads (which needs response rewriting and a reliable
// way to know which task a request came from), we defer the WRITES: lessons
// are buffered here and flushed to the brain only when this proxy shuts down,
// which run-dg.sh does at the end of each single-task job. So:
//
//   attempts 2..5 of task X  -> cannot see task X's lessons (still buffered)
//   task X+1                 -> sees every lesson from tasks 1..X (flushed)
//
// which is exactly cross-task learning without cross-attempt leakage. It
// requires one task per harbor job; run-sweep.sh does that in deferred mode.
const DEFER_WRITES = process.env.TB_DEFER_WRITES === '1'
const deferred = []

// SPOOL DEFERRED WRITES TO DISK, not only to RAM.
//
// The agent is told "Lesson accepted" the moment a write is deferred, but the
// payload lived only in `deferred[]` until the explicit /__flush. This sweep's
// driver has been killed six times mid-run (script edits, a credential blip, a
// retry-policy fix) and every kill silently discarded whatever was buffered —
// lessons the agent believed it had stored, gone, with the log still showing the
// synthetic ack. That is the same family as every other bug found here: a
// success reported before the effect exists.
//
// Each deferred body is appended to a spool file the moment it arrives, and the
// flush drains the FILE. A killed proxy therefore leaves its lessons on disk,
// and the next run reports them instead of losing them in silence.
const SPOOL_PATH = process.env.TB_DEFER_SPOOL ||
  (LOG_PATH ? `${LOG_PATH}.deferred.jsonl` : '')

function spoolDeferred(bodyBuf) {
  if (!SPOOL_PATH) return
  try {
    fs.appendFileSync(SPOOL_PATH, JSON.stringify({ body: bodyBuf.toString('utf8') }) + '\n')
  } catch (err) {
    console.error(`[tb-proxy] could not spool a deferred lesson: ${err.message}`)
  }
}

/** Deferred bodies still on disk — from THIS run and any killed predecessor. */
function readSpool() {
  if (!SPOOL_PATH || !fs.existsSync(SPOOL_PATH)) return []
  const out = []
  for (const line of fs.readFileSync(SPOOL_PATH, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(Buffer.from(JSON.parse(t).body, 'utf8'))
    } catch {
      // A torn last line (killed mid-append) is skipped, not fatal.
    }
  }
  return out
}

function clearSpool() {
  if (!SPOOL_PATH) return
  try {
    fs.rmSync(SPOOL_PATH, { force: true })
  } catch {
    /* best effort */
  }
}

let token = process.env.TERRANSOUL_MCP_TOKEN || ''
if (!token) {
  const tokenFile =
    process.env.TERRANSOUL_MCP_TOKEN_FILE ||
    path.join(process.cwd(), 'mcp-data', 'mcp-token.txt')
  try {
    token = fs.readFileSync(tokenFile, 'utf8').trim()
  } catch (err) {
    console.error(`[tb-proxy] cannot read MCP token from ${tokenFile}: ${err.message}`)
    process.exit(2)
  }
}
if (!token) {
  console.error('[tb-proxy] MCP token is empty')
  process.exit(2)
}

// Every tool call the container makes is recorded here. This is a HOST-SIDE
// record of whether TerranSoul was actually used, independent of grepping the
// agent's own logs — so "did the brain get used?" has a second witness that
// does not depend on harbor's log format.
const toolCalls = []
function record(entry) {
  toolCalls.push(entry)
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() })
  console.log(`[tb-proxy] ${line}`)
  if (LOG_PATH) {
    try {
      fs.appendFileSync(LOG_PATH, line + '\n')
    } catch {
      // Never let logging failure break the bench run.
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Decide whether to forward. Returns null to allow, or a JSON-RPC error object
 * to return instead. Anything we cannot parse is allowed through — the
 * upstream server is the real authority; this guard exists to stop WRITES, not
 * to second-guess the protocol.
 */
function gate(bodyBuf) {
  if (ALLOW_WRITES) return null
  let req
  try {
    req = JSON.parse(bodyBuf.toString('utf8'))
  } catch {
    return null
  }
  if (!req || req.method !== 'tools/call') return null
  const name = req.params?.name
  if (typeof name !== 'string') return null
  if (READ_ONLY_TOOLS.has(name)) return null
  // Do NOT record here. Allowed calls are recorded exactly once, in noteCall.
  // An earlier version recorded in gate(), noteCall() AND the rewrite pass,
  // so a SINGLE brain_ingest_lesson produced three log lines and the usage
  // check reported "3 tool calls served" for one call — inflated evidence of
  // exactly the thing that check exists to measure honestly.
  if (LEARN_MODE && LEARN_TOOLS.has(name)) return null
  // The refusal text used to assert every blocked tool "is a write/mutating
  // tool". Measured 2026-08-04: the server advertises 47 tools and this
  // allowlist refuses 43 of them, of which 21 (code_*, repo_*, obs_*,
  // canvas_snapshot, cross_source_search) are classified SafeRead by
  // action_trust.rs — so the message was simply false, and an agent that
  // believed it would draw the wrong conclusion about what the brain is.
  //
  // They stay BLOCKED, deliberately and for a different reason than writes:
  // those tools read the HOST's filesystem and code index. A Terminal-Bench
  // container runs untrusted benchmark code and is solving a coding task —
  // handing it a search tool over TerranSoul's own repository is both a host
  // exposure and a contamination path (rules/bench-agi-purity.md). Only the
  // reason changes here, not the policy.
  const kind = HOST_SCOPED_PREFIXES.some(p => name.startsWith(p))
    ? 'reads the host filesystem/code index'
    : 'is a write/mutating tool'
  record({ tool: name, allowed: false, reason: 'blocked' })
  return {
    jsonrpc: '2.0',
    id: req.id ?? null,
    error: {
      code: -32001,
      message:
        `bench proxy: '${name}' ${kind}, so it is blocked during a Terminal-Bench ` +
        'run (TB-3 requires 0 brain writes; host-scoped tools are out of scope for a ' +
        'containerised task). The brain tools available to you are: ' +
        `${EXPOSED_BRAIN_TOOLS.filter(t => READ_ONLY_TOOLS.has(t) || (LEARN_MODE && LEARN_TOOLS.has(t))).join(', ')}.`,
    },
  }
}

/**
 * In learn mode, force every ingested lesson to category `self-improve-attempt`.
 *
 * WHY — this is the product's OWN purity control, not a workaround.
 * gateway.rs::ingest_lesson does:
 *
 *     let sync_to_shared_seed = req.category != "self-improve-attempt";
 *
 * i.e. lessons in that category are written to the runtime store but
 * deliberately NOT appended to the committed mcp-data/shared/seed-lessons.sql.
 * Its comment cites the 2026-07-12 incident where 8 Boeing geometry lessons
 * leaked into the shared seed and were worth roughly +3 bench points to every
 * later run — precisely the answer-derived head-start rules/bench-agi-purity.md
 * forbids.
 *
 * MEASURED HERE 2026-08-04: a learn-mode smoke using category "lesson" landed
 * in the ISOLATED store (memory_id 1123, not production's ~25908 range) but
 * ALSO appended 20 lines to the repo's production seed-lessons.sql. Pointing
 * TERRANSOUL_MCP_DATA_DIR at a bench store isolates the DATABASE but not the
 * seed-persistence path. Isolating the store is therefore NOT sufficient; the
 * category is the control that actually works.
 *
 * Enforced here rather than trusted to the instruction, because a benchmark
 * agent choosing its own category is one wrong string away from contaminating
 * the shipped seed.
 */
/**
 * ...and, in the same pass, PIN THE THINKING MODE.
 *
 * OWNER INSTRUCTION 2026-08-04: "thinking is max". `brain_search` exposes a
 * `thinking_mode` dial — chat | think | research | max — and it DEFAULTS TO
 * CHAT (tools.rs:53). extra-instruction.md described the ladder and left
 * escalation to the agent's judgement, so every sweep so far measured
 * TerranSoul at its cheapest rung while carrying its name. The four rungs are
 * cumulative, not stylistic: chat = plain recall; think = + the reason-then-rank
 * judge; research = + iterative sub-queries, completeness critic and KG-edge
 * expansion; max = research's deep recall + claim-level verification and
 * ranking. Running chat therefore does not merely make the bench faster — it
 * removes the reranker, the graph expansion and the verifier from the
 * measurement entirely.
 *
 * Enforced here, not requested in the prompt, for the same reason the category
 * rewrite above is: an instruction the agent may decline is not a
 * configuration. `TB_THINKING_MODE=off` restores agent discretion; any of the
 * four rung names pins that rung instead.
 *
 * Applied ONLY to tools whose schema actually declares the argument —
 * verified against tools.rs, where `brain_search` has it and
 * `brain_suggest_context` / `brain_kg_neighbors` / `brain_get_entry` do not.
 * Sending it to a tool that does not accept it would be a silent no-op that
 * reads, in the log, exactly like a mode that took effect.
 */
// DEFAULT IS `think`, NOT `max` — owner decision 2026-08-05, revising the
// 2026-08-04 "thinking is max" instruction on measurement rather than taste.
// `max` costs ~374 s per brain_search against the local 12B versus ~1 s at
// `think` (independently confirmed over this campaign: 104 real calls at think
// measured p50 0.95 s, p90 2.20 s, max 5.46 s). On a wall-clock-bounded
// benchmark that is not a latency cost, it is a CORRECTNESS cost — a
// Terminal-Bench task that runs out of time scores 0 no matter how good its
// retrieval was, and this campaign lost 6 tasks to AgentTimeoutError already.
// The owner's words: "we changed to think mode now because of timeout and
// uncertainty of completion."
//
// This default previously read `max` while run-sweep.sh exported `think`, so
// the sweep was correct and anyone invoking run-dg.sh DIRECTLY silently got
// max. Two layers disagreeing about the same setting is how a `think` run gets
// published as a `max` one; they now agree.
const THINKING_MODE = (process.env.TB_THINKING_MODE || 'think').toLowerCase()
const THINKING_MODE_TOOLS = new Set(['brain_search'])
const VALID_THINKING_MODES = new Set(['chat', 'think', 'research', 'max'])

function rewriteOutbound(bodyBuf) {
  let req
  try {
    req = JSON.parse(bodyBuf.toString('utf8'))
  } catch {
    return bodyBuf
  }
  if (req?.method !== 'tools/call') return bodyBuf
  const name = req.params?.name
  let changed = false

  // REPAIR TOOL-CALL MARKUP THAT LEAKED INTO THE LESSON BODY.
  //
  // Measured over the 62 lessons this sweep wrote: 21 (34%) arrived with the
  // agent's own tool-call syntax appended to `content` --
  //     "...bit-identical in render output (cmp on the .tga).</content>
  //      <parameter name="tags">pov-ray,build,...</parameter>"
  // and the tag loss is ENTIRELY explained by it: 13 calls had markup AND lost
  // their tags, 8 had markup alone, and ZERO lost tags without markup.
  //
  // The corruption is upstream of the brain -- the tool_use input is already
  // malformed -- so the brain stored it faithfully and no brain-side change can
  // prevent it. But it is RECOVERABLE, because the real body is intact up to the
  // first marker and the stranded arguments are still parseable out of the tail.
  //
  // It is not cosmetic. An untagged lesson is much harder to retrieve: the
  // untagged `pkill` lesson was rediscovered from scratch by the very next task
  // 35 minutes later, which wrote a DUPLICATE instead of appending to it. That is
  // the self-improvement loop losing to a string-handling bug.
  if (LESSON_TOOLS.has(name) && typeof req.params?.arguments?.content === 'string') {
    const raw = req.params.arguments.content
    const cut = raw.search(/<\/content>|<parameter\s+name=|<\/invoke>/)
    if (cut > 0) {
      const tail = raw.slice(cut)
      req.params.arguments.content = raw.slice(0, cut).trimEnd()
      // Recover arguments the markup swallowed, without overwriting anything the
      // agent set correctly.
      // The tail is UNTERMINATED in practice — measured on ids 1192/1193:
      //   </content>\n<parameter name="tags">pytorch,pth,checkpoint,zipfile,...
      // with no closing </parameter>, because the agent's emission was cut off
      // mid-tool-call. An earlier version required a trailing '<' to close the
      // capture, so it matched nothing and the tags stayed lost: the body was
      // cleaned while the tags — the thing that makes a lesson findable — were
      // still dropped. Anchor on the marker only, and stop at a newline or the
      // next tag if one happens to be there.
      // TWO DIALECTS, both observed in this sweep's own trajectories. Fixing
      // against one sample at a time is why this took three passes:
      //   ids 1192/1193 : </content>\n<parameter name="tags">a,b,c        (unterminated)
      //   ids 1204/1205 : </content>\n<tags>a,b,c</tags>\n<importance>8</importance>\n</invoke>
      // The second form has no `name=` attribute at all, so a regex written for
      // the first matches nothing — the body got cleaned while the tags, the
      // whole point of the repair, were still dropped.
      const tags = tail.match(/<tags>\s*([^<]*)<\/tags>/) ||
                   tail.match(/name="tags">\s*([^<\n]*)/)
      if (tags && tags[1].trim() && !req.params.arguments.tags) {
        req.params.arguments.tags = tags[1].trim()
      }
      const imp = tail.match(/<importance>\s*(\d+)\s*<\/importance>/) ||
                  tail.match(/name="importance">\s*(\d+)/)
      if (imp && req.params.arguments.importance == null) {
        req.params.arguments.importance = Number(imp[1])
      }
      lastRepairedMarkup = { cutAt: cut, recoveredTags: !!tags, recoveredImportance: !!imp }
      changed = true
    }
  }

  if (LEARN_MODE && name === 'brain_ingest_lesson') {
    req.params.arguments = req.params.arguments || {}
    const was = req.params.arguments.category
    if (was !== 'self-improve-attempt') {
      req.params.arguments.category = 'self-improve-attempt'
      // Reported through noteCall's single record, not a second line of its own.
      lastRewrittenFrom = was ?? null
      changed = true
    }
  }

  if (VALID_THINKING_MODES.has(THINKING_MODE) && THINKING_MODE_TOOLS.has(name)) {
    req.params.arguments = req.params.arguments || {}
    // Record the rung on EVERY pinned call, not only when a rewrite happened.
    // Keying the record on "did we change something" meant that an agent which
    // already sent the pinned rung produced no record at all, and witness 5
    // then reported "ran at the server default (chat)" — the witness failing
    // precisely when the agent complied. What is being witnessed is the rung on
    // the wire, which is pinned either way.
    lastThinkingModeFrom = req.params.arguments.thinking_mode ?? null
    if (req.params.arguments.thinking_mode !== THINKING_MODE) {
      req.params.arguments.thinking_mode = THINKING_MODE
      changed = true
    }
  }

  return changed ? Buffer.from(JSON.stringify(req), 'utf8') : bodyBuf
}

// Set by rewriteOutbound, consumed by the next noteCall. Single-threaded
// request handling makes this safe; it exists so one call yields one log line.
let lastRewrittenFrom
let lastThinkingModeFrom
let lastRepairedMarkup

/**
 * The BRAIN's verdict on a call the proxy forwarded — not the proxy's own.
 *
 * WHY (rules/tbench-playbook.md, "Second thing to fix before any sweep"):
 * every witness this proxy produced was an ATTEMPT counter. `noteCall` records
 * `allowed:true` before the request is even written upstream, so a run in which
 * the brain refused every single write still reported "N tool call(s) served".
 * That is the same family as the three instrumentation inflations already fixed
 * on 2026-08-04, and it was live: with `safe_write` trust at 0.50 vs a 0.60
 * threshold (TRUST-BOOTSTRAP-1), every learn-mode write came back
 * `isError:true` and nothing counted it.
 *
 * An MCP error arrives as HTTP 200 with `result.isError:true` (router.rs:190-196),
 * so the status code is no help — the body has to be read. The response is teed,
 * never buffered-then-forwarded, so SSE streaming is unaffected.
 *
 * Uses the key `name`, deliberately NOT `tool`: `"tool":` is the call counter
 * the usage check greps, and one call must still produce exactly one of those.
 */
// MEASURED 2026-08-05: a real `brain_search` response is 17,773 bytes and its
// `"isError"` marker sits at byte 17,738 — i.e. MCP puts the flag we key on at
// the very END of the body. The original 16 KB cap truncated exactly that,
// every large search failed to parse, and the call was logged "unreadable".
// On a task whose only call was one such search, witness 3 then reported
// "THE BRAIN ACCEPTED NOTHING" for a perfectly healthy call — a false alarm
// from the instrument itself, which is the badge-cascade shape
// rules/mcp-response-audit.md exists to catch. 1 MB comfortably clears a
// limit=20 response; the copy is per-request and short-lived.
const OUTCOME_CAP_BYTES = 1_048_576

function parseRpcPayload(text) {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  // Streamable HTTP / SSE: "event: message\ndata: {...}"
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      return JSON.parse(line.slice(5).trim())
    } catch {
      // keep scanning — a partial frame is not a parse failure of the whole
    }
  }
  return null
}

/** Classify one forwarded tools/call by what the brain actually answered. */
function noteOutcome(reqBuf, responseText) {
  let name
  try {
    const req = JSON.parse(reqBuf.toString('utf8'))
    if (req?.method !== 'tools/call') return
    name = req.params?.name
  } catch {
    return
  }
  if (typeof name !== 'string') return

  const rpc = parseRpcPayload(responseText)
  if (!rpc) {
    // Belt-and-braces for the truncation case above: a body we cannot parse is
    // still readable enough to answer the only question that matters. The
    // error markers are literal strings, so look for them directly rather than
    // defaulting to "unreadable" — which reads as a failure and is what raised
    // a false alarm on a healthy call.
    if (responseText.includes('"isError":true')) {
      const gated = responseText.includes('action gated by earned autonomy')
      record({ name, verdict: gated ? 'gate-denied' : 'refused', detail: 'detected in an unparseable body' })
    } else if (responseText.includes('"result"')) {
      record({ name, verdict: 'accepted', truncated: true })
    } else {
      record({ name, verdict: 'unparseable', detail: responseText.slice(0, 120) })
    }
    return
  }
  if (rpc.error) {
    record({ name, verdict: 'refused', detail: String(rpc.error.message ?? '').slice(0, 160) })
    return
  }
  if (rpc.result?.isError) {
    const detail = String(rpc.result?.content?.[0]?.text ?? '').slice(0, 160)
    // The earned-autonomy gate has a stable prefix (action_trust.rs::
    // GATE_DENY_PREFIX). Calling it out by name is the difference between
    // "the brain said no" and "the brain said no BECAUSE it does not trust
    // this agent yet", which is the one a sweep must never ignore.
    const gated = detail.startsWith('action gated by earned autonomy')
    record({ name, verdict: gated ? 'gate-denied' : 'refused', detail })
    return
  }
  record({ name, verdict: 'accepted' })
}

function noteCall(bodyBuf) {
  try {
    const req = JSON.parse(bodyBuf.toString('utf8'))
    if (req?.method === 'tools/call' && typeof req.params?.name === 'string') {
      const entry = { tool: req.params.name, allowed: true }
      if (LEARN_MODE && LEARN_TOOLS.has(req.params.name)) entry.mode = 'learn-write'
      if (lastRewrittenFrom !== undefined) {
        entry.categoryRewrittenFrom = lastRewrittenFrom
        lastRewrittenFrom = undefined
      }
      if (lastRepairedMarkup !== undefined) {
        entry.repairedMarkup = lastRepairedMarkup
        lastRepairedMarkup = undefined
      }
      if (lastThinkingModeFrom !== undefined) {
        entry.thinkingMode = THINKING_MODE
        entry.thinkingModeWas = lastThinkingModeFrom
        lastThinkingModeFrom = undefined
      }
      record(entry)
    } else if (req?.method) {
      record({ method: req.method, allowed: true })
    }
  } catch {
    // Non-JSON body — forwarded verbatim, nothing to record.
  }
}

const server = http.createServer(async (clientReq, clientRes) => {
  // Explicit flush endpoint. Signals are NOT usable for this: on Windows,
  // `kill -TERM` from Git Bash hard-terminates node without running the
  // SIGTERM handler, and the first version of this proxy silently DROPPED
  // every deferred lesson as a result (caught by deferred-writes.test.sh —
  // "lesson lost"). run-dg.sh calls this before stopping the proxy, so the
  // flush is an ordinary request whose completion we can actually observe.
  if (clientReq.url && clientReq.url.startsWith('/__flush')) {
    const t = await flushDeferred()
    // `flushed` stays the ACCEPTED count, not the sent count: it is the number
    // a human reads as "lessons that landed", and reporting sends there is the
    // inflation this file exists to stop.
    const payload = Buffer.from(
      JSON.stringify({ flushed: t.accepted, sent: t.sent, refused: t.refused }),
      'utf8',
    )
    clientRes.writeHead(200, {
      'content-type': 'application/json',
      'content-length': payload.length,
    })
    clientRes.end(payload)
    console.log(
      `[tb-proxy] flushed ${t.accepted}/${t.sent} deferred lesson(s) on request` +
        (t.refused ? `, ${t.refused} REFUSED by the brain` : ''),
    )
    return
  }

  let bodyBuf = Buffer.alloc(0)
  try {
    bodyBuf = await readBody(clientReq)
  } catch {
    clientRes.writeHead(400).end('bad request body')
    return
  }

  const blocked = gate(bodyBuf)
  if (blocked) {
    const payload = Buffer.from(JSON.stringify(blocked), 'utf8')
    clientRes.writeHead(200, {
      'content-type': 'application/json',
      'content-length': payload.length,
    })
    clientRes.end(payload)
    return
  }

  // Rewrite BEFORE recording: the single log line reports what was actually
  // forwarded, including any category rewrite.
  bodyBuf = rewriteOutbound(bodyBuf)
  // Deferred write: acknowledge to the agent, hold the payload, forward it to
  // the brain only at shutdown (end of this task's job).
  if (DEFER_WRITES) {
    let parsed
    try {
      parsed = JSON.parse(bodyBuf.toString('utf8'))
    } catch {
      parsed = null
    }
    // Defer EVERY learning write, not just lesson ingest. brain_append and
    // brain_add_edge mutate retrievable state too, so letting them through
    // immediately would reopen exactly the cross-attempt leakage that
    // deferring exists to close.
    if (parsed?.method === 'tools/call' && LEARN_TOOLS.has(parsed.params?.name)) {
      // Spool BEFORE acknowledging: the agent is about to be told the lesson
      // was accepted, so it must already be recoverable if this process dies.
      spoolDeferred(bodyBuf)
      deferred.push(bodyBuf)
      // Carry the pending rewrite markers on THIS line and clear them. The
      // deferred branch returns before `noteCall`, so previously a repair or a
      // category rewrite applied to a deferred write was never logged — and the
      // marker dangled, to be misattributed to whatever tool call came next.
      // Measured cost of that: the markup repair looked like it had never fired
      // (count 0) while the stored lessons proved it had, which cost a whole
      // iteration to tell apart.
      {
        const entry = { tool: parsed.params.name, allowed: true, mode: 'deferred' }
        if (lastRepairedMarkup !== undefined) {
          entry.repairedMarkup = lastRepairedMarkup
          lastRepairedMarkup = undefined
        }
        if (lastRewrittenFrom !== undefined) {
          entry.categoryRewrittenFrom = lastRewrittenFrom
          lastRewrittenFrom = undefined
        }
        if (lastThinkingModeFrom !== undefined) {
          entry.thinkingMode = THINKING_MODE
          lastThinkingModeFrom = undefined
        }
        record(entry)
      }
      const ack = {
        jsonrpc: '2.0',
        id: parsed.id ?? null,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                deferred: true,
                note: 'Lesson accepted. It becomes retrievable for later tasks, not for further attempts at this one.',
              }),
            },
          ],
        },
      }
      const payload = Buffer.from(JSON.stringify(ack), 'utf8')
      clientRes.writeHead(200, {
        'content-type': 'application/json',
        'content-length': payload.length,
      })
      clientRes.end(payload)
      return
    }
  }

  noteCall(bodyBuf)

  // Forward verbatim, minus hop-by-hop and length headers we are re-deriving,
  // plus the Authorization the container could never have supplied.
  const headers = { ...clientReq.headers }
  delete headers.host
  delete headers.connection
  delete headers['content-length']
  headers.authorization = `Bearer ${token}`
  if (bodyBuf.length > 0) headers['content-length'] = String(bodyBuf.length)

  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: clientReq.method,
      path: clientReq.url,
      headers,
    },
    upstreamRes => {
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      // TEE, not buffer: the client keeps receiving chunks as they arrive (the
      // MCP streamable-HTTP transport uses SSE, so buffering would stall every
      // streamed response), while a bounded copy is kept so `noteOutcome` can
      // report what the brain actually answered.
      let seen = 0
      let copy = ''
      upstreamRes.on('data', chunk => {
        if (seen >= OUTCOME_CAP_BYTES) return
        copy += chunk.toString('utf8')
        seen += chunk.length
      })
      upstreamRes.on('end', () => noteOutcome(bodyBuf, copy))
      upstreamRes.pipe(clientRes)
    },
  )

  upstream.on('error', err => {
    console.error(`[tb-proxy] upstream error: ${err.message}`)
    if (!clientRes.headersSent) clientRes.writeHead(502)
    clientRes.end('upstream unreachable')
  })

  if (bodyBuf.length > 0) upstream.write(bodyBuf)
  upstream.end()
})

// 0.0.0.0 on purpose: the container reaches this through host.docker.internal,
// which is NOT the loopback interface. Bench-scoped and torn down after the
// run — see run-dg.sh, which starts and stops it around the harbor invocation.
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(
    `[tb-proxy] thinking_mode: ${
      VALID_THINKING_MODES.has(THINKING_MODE)
        ? `PINNED to '${THINKING_MODE}' on ${[...THINKING_MODE_TOOLS].join(',')}`
        : `agent's choice (TB_THINKING_MODE=${THINKING_MODE}) — brain_search defaults to chat`
    }`,
  )
  console.log(
    `[tb-proxy] listening on 0.0.0.0:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} ` +
      `(writes ${
        ALLOW_WRITES
          ? 'ALL ALLOWED — run is NOT a clean measurement'
          : LEARN_MODE
            ? `learn-mode: ${[...LEARN_TOOLS].join(',')} only`
            : 'blocked'
      })`,
  )
})

/** Flush deferred lessons to the brain. Sequential: order is the order the
 *  agent wrote them, and the brain's dedup guard prefers a stable sequence.
 *
 *  Returns {sent, accepted, refused}. It used to `res.resume()` — discard the
 *  body — and count every request it managed to SEND as a flushed lesson, so a
 *  brain that refused all of them still reported `flushed:N`. Under
 *  TB_DEFER_WRITES that made three separate layers claim success for a write
 *  that never landed: the synthetic ack returned to the agent, this count, and
 *  the usage check's "N calls served". The response is now read and classified,
 *  and a refusal is printed rather than swallowed. */
function flushDeferred() {
  return new Promise(resolve => {
    const tally = { sent: 0, accepted: 0, refused: 0 }
    // The SPOOL is the source of truth, not the in-memory array: it also holds
    // anything a killed predecessor buffered but never flushed.
    const pending = readSpool()
    if (pending.length > deferred.length) {
      console.error(
        `[tb-proxy] recovered ${pending.length - deferred.length} deferred lesson(s) ` +
          'left on disk by an earlier proxy that was killed before flushing',
      )
    }
    const queue = pending.length ? pending : deferred.slice()
    deferred.length = 0
    if (queue.length === 0) {
      clearSpool()
      return resolve(tally)
    }
    const next = () => {
      const body = queue.shift()
      if (!body) {
        // Only drop the spool once every body in it has been answered for.
        clearSpool()
        return resolve(tally)
      }
      const req = http.request(
        {
          host: UPSTREAM_HOST,
          port: UPSTREAM_PORT,
          method: 'POST',
          path: '/mcp',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'content-length': String(body.length),
          },
        },
        res => {
          let text = ''
          res.on('data', c => {
            if (text.length < OUTCOME_CAP_BYTES) text += c.toString('utf8')
          })
          res.on('end', () => {
            tally.sent += 1
            const rpc = parseRpcPayload(text)
            const failed = !rpc || rpc.error || rpc.result?.isError
            if (failed) {
              tally.refused += 1
              const detail = String(
                rpc?.error?.message ?? rpc?.result?.content?.[0]?.text ?? text,
              ).slice(0, 160)
              console.error(`[tb-proxy] deferred lesson REFUSED by the brain: ${detail}`)
            } else {
              tally.accepted += 1
            }
            noteOutcome(body, text)
            next()
          })
        },
      )
      req.on('error', err => {
        tally.sent += 1
        tally.refused += 1
        console.error(`[tb-proxy] deferred flush failed: ${err.message}`)
        next()
      })
      req.write(body)
      req.end()
    }
    next()
  })
}

async function shutdown() {
  const t = await flushDeferred()
  const allowed = toolCalls.filter(c => c.allowed && c.tool).length
  const blockedCount = toolCalls.filter(c => !c.allowed).length
  // Brain-side verdicts, which are the only ones that mean "it worked".
  const accepted = toolCalls.filter(c => c.verdict === 'accepted').length
  const refused = toolCalls.filter(c => c.verdict === 'refused' || c.verdict === 'gate-denied').length
  console.log(
    `[tb-proxy] shutting down: ${allowed} tool call(s) forwarded ` +
      `(brain accepted ${accepted}, refused ${refused}), ${blockedCount} blocked by this proxy` +
      (DEFER_WRITES ? `, ${t.accepted}/${t.sent} deferred lesson(s) flushed` : ''),
  )
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
