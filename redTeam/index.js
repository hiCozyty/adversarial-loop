// index.js — entry point for the red agent pipeline
// bun run index.js [--round=1] [--dry-run]

import {
  findAgentPaw,
  getAdversaryAbilities,
  createOperation,
  closeOperation,
} from "./src/caldera.js"

import { runOrchestrator } from "./src/orchestrator.js"
import { generateReport, printReport } from "./src/report.js"
import { $ } from "bun"

const ADVERSARY_ID = process.env.ADVERSARY_ID
const TARGET_HOST  = process.env.TARGET_HOST
const ROUND_ID     = parseInt(process.argv.find(a => a.startsWith("--round="))?.split("=")[1] || "1")
const DRY_RUN      = process.argv.includes("--dry-run")

function validateEnv() {
    console.log(process.env.ADVERSARY_ID)
    const required = ["LLM_API_KEY", "CALDERA_URL", "CALDERA_KEY", "ADVERSARY_ID"]
    const missing  = required.filter(k => !process.env[k])
    if (missing.length) {
        console.error(`Missing env vars: ${missing.join(", ")}`)
        process.exit(1)
    }
}

async function main() {
    validateEnv()
    console.log(`\n[round ${ROUND_ID}] Starting red agent${DRY_RUN ? " (DRY RUN)" : ""}`)

    const startTime = new Date()

    // 1. find target agent paw
    console.log("[1/4] Locating target agent...")
    const agentPaw = await findAgentPaw(TARGET_HOST)
    console.log(`  Agent paw: ${agentPaw}`)

    // 2. fetch ability list directly from adversary profile in Caldera — no hardcoding
    console.log("[2/4] Fetching abilities from adversary profile...")
    const abilities = await getAdversaryAbilities(ADVERSARY_ID)
    console.log(`  Loaded ${abilities.length} linux-capable abilities`)

    if (DRY_RUN) {
        console.log("\n[dry-run] Abilities loaded — not running operation\n")
        console.log("ability_id | technique | name | command")
        console.log("-".repeat(120))
        for (const a of abilities) {
            const executor = a.executors?.find(e => e.platform === "linux")
            const cmd = (executor?.command || "").slice(0, 60).replace(/\n/g, " ")
            console.log(`${a.ability_id} | ${(a.technique_id || "").padEnd(11)} | ${a.name.padEnd(40)} | ${cmd}`)
        }
        process.exit(0)
    }

    // 3. create Caldera operation (manual/atomic planner — we drive link execution)
    console.log("[3/4] Creating Caldera operation...")
    const op = await createOperation({
        name:        `purple-team-round-${ROUND_ID}-${Date.now()}`,
        adversaryId: ADVERSARY_ID,
        groupName:   "red",
    })
    console.log(`  Operation ID: ${op.id}`)

    // 4. run LLM orchestrator loop
    console.log("[4/4] Running orchestrator...\n")
    let runResult
    try {
        runResult = await runOrchestrator({
        opId:     op.id,
        agentPaw,
        abilities,
        maxSteps: 30,
        })
    } finally {
        await closeOperation(op.id).catch(e => console.warn("Could not close operation:", e.message))
    }

    // 5. generate and save report
    const report = generateReport({
        roundId: ROUND_ID,
        outcome: runResult.outcome,
        results: runResult.results,
        steps:   runResult.steps,
        agentPaw,
        startTime,
    })

    printReport(report)

    await $`mkdir -p ./reports`
    const reportPath = `./reports/round-${ROUND_ID}-${Date.now()}.json`
    Bun.write(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report saved: ${reportPath}`)

    process.exit(runResult.outcome.success ? 0 : 1)
}

main().catch(err => {
    console.error("[fatal]", err)
    process.exit(2)
})