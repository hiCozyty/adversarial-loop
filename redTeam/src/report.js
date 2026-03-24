// report.js — formats the run output into a structured report

export function generateReport({ roundId, outcome, results, steps, agentPaw, startTime }) {
  const endTime     = new Date()
  const durationSec = ((endTime - startTime) / 1000).toFixed(1)

  const successfulSteps = results.filter(r => r.exitCode === 0)
  const failedSteps     = results.filter(r => r.exitCode !== 0)

  // group by MITRE technique
  const byTechnique = {}
  for (const r of results) {
    const t = r.technique || "unknown"
    if (!byTechnique[t]) byTechnique[t] = []
    byTechnique[t].push(r)
  }

  const report = {
    meta: {
      roundId,
      agentPaw,
      startTime: startTime.toISOString(),
      endTime:   endTime.toISOString(),
      durationSec: Number(durationSec),
      totalSteps:  steps,
    },
    outcome: {
      success:      outcome.success,
      winning_path: outcome.winning_path || null,
      reason:       outcome.reason,
    },
    summary: {
      abilitiesAttempted: results.length,
      succeeded:          successfulSteps.length,
      failed:             failedSteps.length,
    },
    steps: results.map(r => ({
      step:      r.step,
      ability:   r.ability,
      abilityId: r.abilityId,
      technique: r.technique,
      reason:    r.reason,
      exitCode:  r.exitCode,
      status:    r.status,
      // truncate stdout for the report — full logs stay in Caldera
      stdoutSnippet: r.stdout?.slice(0, 500) || "",
      stderrSnippet: r.stderr?.slice(0, 200) || "",
      winConditionHit: (r.stdout + r.stderr).includes("secrettext"),
    })),
    techniquesCoverage: Object.entries(byTechnique).map(([technique, steps]) => ({
      technique,
      attempts:  steps.length,
      successes: steps.filter(s => s.exitCode === 0).length,
    })),
  }

  return report
}

export function printReport(report) {
  console.log("\n" + "=".repeat(60))
  console.log(`ROUND ${report.meta.roundId} — ${report.outcome.success ? "RED WIN ✓" : "EXHAUSTED ✗"}`)
  console.log("=".repeat(60))
  console.log(`Duration:   ${report.meta.durationSec}s over ${report.meta.totalSteps} steps`)
  console.log(`Outcome:    ${report.outcome.reason}`)
  if (report.outcome.winning_path) {
    console.log(`Win path:   ${report.outcome.winning_path}`)
  }
  console.log(`\nSteps attempted: ${report.summary.abilitiesAttempted}`)
  console.log(`  Succeeded: ${report.summary.succeeded}`)
  console.log(`  Failed:    ${report.summary.failed}`)
  console.log("\nStep-by-step:")
  for (const s of report.steps) {
    const icon = s.winConditionHit ? "🏆" : s.exitCode === 0 ? "✓" : "✗"
    console.log(`  [${s.step}] ${icon} ${s.ability} (${s.technique}) — exit ${s.exitCode}`)
    if (s.stdoutSnippet) console.log(`      → ${s.stdoutSnippet.slice(0, 100)}`)
  }
  console.log("\nTechnique coverage:")
  for (const t of report.techniquesCoverage) {
    console.log(`  ${t.technique}: ${t.successes}/${t.attempts} succeeded`)
  }
  console.log("=".repeat(60) + "\n")
}