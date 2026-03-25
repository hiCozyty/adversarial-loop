// report.js

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