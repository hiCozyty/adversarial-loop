// caldera.js
const BASE   = process.env.CALDERA_URL
const APIKEY = process.env.CALDERA_KEY

const headers = {
  "KEY":          APIKEY,
  "Content-Type": "application/json",
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Caldera ${method} ${path} → ${res.status}: ${text}`)
  }
  // 204 No Content
  if (res.status === 204) return null
  return res.json()
}

// ── Agents ────────────────────────────────────────────────────────────────────

export async function getAgents() {
  return req("GET", "/api/v2/agents")
}

// Returns the paw of the first agent whose hostname matches name
export async function findAgentPaw(hostname) {
  const agents = await getAgents()
  const match = agents.find(a => a.host === hostname || a.paw === hostname)
  if (!match) throw new Error(`No agent found for host: ${hostname}`)
  return match.paw
}

// ── Abilities ─────────────────────────────────────────────────────────────────

export async function getAbilities() {
  return req("GET", "/api/v2/abilities")
}

// Fetch adversary profile, then hydrate each ability with full details.
// Caldera's adversary response includes ability stubs — we cross-reference
// with the full ability list to get executors, descriptions, technique IDs etc.
export async function getAdversaryAbilities(adversaryId) {
  const [adversary, allAbilities] = await Promise.all([
    req("GET", `/api/v2/adversaries/${adversaryId}`),
    req("GET", "/api/v2/abilities"),
  ])

  const abilityMap = new Map(allAbilities.map(a => [a.ability_id, a]))

  const profileIds = adversary.atomic_ordering ?? []

  if (profileIds.length === 0) {
    throw new Error(`Adversary ${adversaryId} has no abilities in atomic_ordering`)
  }

  const abilities = profileIds
    .map(id => abilityMap.get(id))
    .filter(Boolean)  // drop any stubs not found in full list
    .filter(a => a.executors?.some(e => e.platform === "linux"))  // linux only

  console.log(`  Adversary: "${adversary.name}" — ${profileIds.length} abilities in profile, ${abilities.length} linux-capable loaded`)

  return abilities
}

// ── Operations ────────────────────────────────────────────────────────────────

// Create a new operation in manual state so we control link execution
export async function createOperation({ name, adversaryId, groupName = "red" }) {
  return req("POST", "/api/v2/operations", {
    name,
    adversary:  { adversary_id: adversaryId },
    group:      groupName,
    auto_close: false,
    state:      "running",
    // atomic planner — we add links manually so it doesn't auto-sequence
    planner:    { id: "aaa7c857-37a0-4c4a-85f7-4e9f7f30e31a" },
    visibility: 51,
  })
}

export async function getOperation(opId) {
  return req("GET", `/api/v2/operations/${opId}`)
}

export async function closeOperation(opId) {
  return req("PATCH", `/api/v2/operations/${opId}`, { state: "finished" })
}

// ── Links (individual ability executions) ─────────────────────────────────────

// Queue a single ability against a specific agent in an operation
export async function addLink(opId, { paw, abilityId, facts = [] }) {
  const links = await req("PUT", `/api/v2/operations/${opId}/links`, {  
    paw,
    ability: { ability_id: abilityId },
    facts,
  })
  // Returns array of created links
  return links[0]
}

export async function getLink(opId, linkId) {
  return req("GET", `/api/v2/operations/${opId}/links/${linkId}`)
}

// Poll until the link reaches a terminal status (collect, fail, discard)
// status codes: 0=success, -2=discarded, -3=failed, -4=killed, 1=queued, 2=delegated
export async function waitForLink(opId, linkId, { pollMs = 2000, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const link = await getLink(opId, linkId)
    // finish_time is set when the link is done
    if (link.finish) {
      return link
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`Link ${linkId} timed out after ${timeoutMs}ms`)
}

// Decode base64 command (Caldera stores commands as base64)
export function decodeCommand(b64) {
  try {
    return Buffer.from(b64, "base64").toString("utf-8")
  } catch {
    return b64
  }
}

// Extract readable output from a finished link
export function parseLinkResult(link) {
  const output = link.output ? JSON.parse(link.output) : {}
  return {
    linkId:   link.id,
    ability:  link.ability?.name || "unknown",
    abilityId: link.ability?.ability_id,
    technique: link.ability?.technique_id,
    command:  decodeCommand(link.command || ""),
    status:   link.finish_reason || (link.status === 0 ? "success" : "failed"),
    exitCode: link.status,
    stdout:   output.stdout || "",
    stderr:   output.stderr || "",
  }
}