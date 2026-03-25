// report.js
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
  // ✅ Clearer labels
  console.log(`  Effective: ${report.summary.succeeded}`)   // was "Succeeded"
  console.log(`  Failed:    ${report.summary.failed}`)
  console.log("\nStep-by-step:")
  for (const s of report.steps) {
    // ✅ Icon logic already correct — 🏆 for winConditionHit
    const icon = s.winConditionHit ? "🏆" : s.exitCode === 0 ? "✓" : "✗"
    const statusLabel = s.winConditionHit ? "[WIN]" : 
                    s.exitCode === 0 ? "[OK]" : 
                    s.stdout?.length > 100 ? "[PARTIAL]" : `[EXIT ${s.exitCode}]`
    console.log(`  [${s.step}] ${icon} ${s.ability} (${s.technique}) — ${statusLabel}`)
    if (s.stdoutSnippet) console.log(`      → ${s.stdoutSnippet.slice(0, 100)}`)
  }
  console.log("\nTechnique coverage:")
  for (const t of report.techniquesCoverage) {
    console.log(`  ${t.technique}: ${t.successes}/${t.attempts} effective`)
  }
  console.log("=".repeat(60) + "\n")
}
export function generateReport({ roundId, outcome, results, steps, agentPaw, startTime }) {
  const endTime     = new Date()
  const durationSec = ((endTime - startTime) / 1000).toFixed(1)
  const WIN_STRING = "secrettext"  // ← define or import

  //count steps that either succeeded OR produced the win string
  const effectiveSteps = results.filter(r => 
    r.exitCode === 0 || (r.stdout + r.stderr).includes(WIN_STRING)
  )
  const failedSteps = results.filter(r => 
    r.exitCode !== 0 && !(r.stdout + r.stderr).includes(WIN_STRING)
  )

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
      succeeded:          effectiveSteps.length,  // ← UPDATED
      failed:             failedSteps.length,     // ← UPDATED
    },
    steps: results.map(r => ({
      step:      r.step,
      ability:   r.ability,
      abilityId: r.abilityId,
      technique: r.technique,
      reason:    r.reason,
      exitCode:  r.exitCode,
      status:    r.status,
      stdoutSnippet: r.stdout?.slice(0, 500) || "",
      stderrSnippet: r.stderr?.slice(0, 200) || "",
      winConditionHit: (r.stdout + r.stderr).includes(WIN_STRING),
    })),
    techniquesCoverage: Object.entries(byTechnique).map(([technique, steps]) => ({
      technique,
      attempts:  steps.length,
      //count successes as exitCode 0 OR win string present
      successes: steps.filter(s => 
        s.exitCode === 0 || (s.stdout + s.stderr).includes(WIN_STRING)
      ).length,
    })),
  }

  return report
}