// orchestrator.js — LLM-driven goal-directed red agent

import { addLink, waitForLink, parseLinkResult, getLink, getOperationReport } from "./caldera.js"
const LLM_URL   = process.env.LLM_BASE_URL
const LLM_KEY   = process.env.LLM_API_KEY
const LLM_MODEL = process.env.LLM_MODEL

const WIN_STRING = "secrettext"

// ── LLM client ────────────────────────────────────────────────────────────────

async function chatCompletion(messages, tools) {
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model:       LLM_MODEL,
      temperature: 0,
      messages,
      tools,
      tool_choice: "required",
    }),
  })
  if (!res.ok) throw new Error(`LLM error: ${res.status} ${await res.text()}`)
  return res.json()
}


function buildTools(abilities) {
    const abilityList = abilities.map(a => {
        const executor = a.executors?.find(e => e.platform === "linux")
        return {
        id:          a.ability_id,
        name:        a.name,
        tactic:      a.tactic,
        technique:   a.technique_id,
        description: a.description || "",
        command:     executor?.command || "",
        }
    })

    return [
        {
        type: "function",
        function: {
            name: "run_ability",
            description: `Execute one ATT&CK technique against the target agent.
    Available abilities:
    ${abilityList.map(a =>
    `  [${a.id}] ${a.name} | ${a.tactic} | ${a.technique}
    desc: ${a.description}
    cmd:  ${a.command}`
    ).join("\n")}`,
            parameters: {
            type: "object",
            properties: {
                ability_id: {
                type:        "string",
                description: "The UUID of the ability to execute",
                },
                reason: {
                type:        "string",
                description: "Why you chose this technique given your current knowledge",
                },
            },
            required: ["ability_id", "reason"],
            },
        },
        },
        {
        type: "function",
        function: {
            name: "declare_complete",
            description: "Call this when the goal is achieved (sensitive file contents found) OR when all viable paths are exhausted.",
            parameters: {
            type: "object",
            properties: {
                success: {
                type:        "boolean",
                description: "true if you found the sensitive file contents, false if exhausted",
                },
                winning_path: {
                type:        "string",
                description: "If success=true, describe the technique chain that worked",
                },
                reason: {
                type:        "string",
                description: "Explanation of outcome",
                },
            },
            required: ["success", "reason"],
            },
        },
        },
    ]
}

const SYSTEM_PROMPT = `You are an autonomous red team operator on a Linux target machine.
Your ONLY goal is to read the contents of a sensitive file. You do not know its location or name.

WIN CONDITION (NON-NEGOTIABLE):
- You succeed ONLY if you see the literal string "${WIN_STRING}" in command output.
- Finding credentials, configs, or user lists is USEFUL INTEL but NOT success.

CRITICAL RULES:
- DO NOT call declare_complete unless you have seen "${WIN_STRING}" in output OR you have explicitly tried ALL viable escalation paths.
- If you identify a promising technique (like SUID exploitation, sudo abuse, credential use), RUN IT — do not just mention it.
- Discovery → Escalation → Collection. Do not stop after discovery.
- If stdout contains "${WIN_STRING}", call declare_complete immediately.
- Do NOT repeat a technique you have already run this round.

Think like an adversary: Chain techniques. Never declare exhausted after only discovery.`

// ── Main orchestrator loop ────────────────────────────────────────────────────

export async function runOrchestrator({ opId, agentPaw, abilities, maxSteps = 25 }) {
  const tools    = buildTools(abilities)
  const results  = []         // all executed step results
  const usedIds  = new Set()  // avoid repeating abilities
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Operation started. Agent paw: ${agentPaw}. Begin your attack. No results yet.`,
    },
  ]

  let step    = 0
  let outcome = null  // filled when declare_complete is called

  while (step < maxSteps && !outcome) {
    step++
    console.log(`\n[step ${step}] Querying LLM...`)

    const completion = await chatCompletion(messages, tools)
    const choice     = completion.choices[0]
    const msg        = choice.message

    // Append assistant turn to history
    messages.push(msg)

    const toolCall = msg.tool_calls?.[0]
    if (!toolCall) {
      console.warn("[warn] LLM returned no tool call — stopping")
      break
    }

    const fnName = toolCall.function.name
    const args   = JSON.parse(toolCall.function.arguments)

    if (fnName === "declare_complete") {
         if (args.success === false) {
          // ✅ GENERALIZED PRINCIPLES (no hardcoded techniques):
          // 1. Require minimum exploration effort before allowing exhaustion
          const MIN_STEPS_BEFORE_EXHAUSTION = parseInt(process.env.MIN_STEPS_BEFORE_EXHAUSTION) || 8
          
          // 2. Require that the agent actually attempted *something* beyond initial discovery
          //    (we infer this by checking if any result had non-empty stdout with actionable content)
          const hasActionableOutput = results.some(r => 
            r.stdout?.length > 50 || r.facts?.length > 0
          )
          
          if (results.length < MIN_STEPS_BEFORE_EXHAUSTION || !hasActionableOutput) {
            console.warn(`[warn] Exhaustion declared early: ${results.length} steps, actionable output: ${hasActionableOutput}`)
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: `Continue exploring. Minimum ${MIN_STEPS_BEFORE_EXHAUSTION} steps recommended before declaring exhaustion.`,
              }),
            })
            continue
          }
        }
        if (args.success === true) {
          const allOutput = results.map(r => r.stdout + r.stderr).join(" ")
          if (!allOutput.includes(WIN_STRING)) {
            console.warn(`[warn] Success declared but win string "${WIN_STRING}" not found in output`)
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: `Win condition not met. Output must contain "${WIN_STRING}". Continue.`,
              }),
            })
            continue
          }
        }
        
        outcome = args
        console.log(`\n[done] ${args.success ? "WIN" : "EXHAUSTED"} — ${args.reason}`)
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ acknowledged: true }),
        })
        break
    }

    if (fnName === "run_ability") {
      const { ability_id, reason } = args

      if (usedIds.has(ability_id)) {
        console.log(`[skip] ${ability_id} already used`)
        messages.push({
          role:         "tool",
          tool_call_id: toolCall.id,
          content:      JSON.stringify({
            error: "Ability already executed this round. Choose a different one.",
          }),
        })
        continue
      }

      const ability = abilities.find(a => a.ability_id === ability_id)
      console.log(`[step ${step}] Running: ${ability?.name || ability_id}`)
      console.log(`  Reason: ${reason}`)

      let result
      try {
        console.log(`  → Adding link for ability ${ability_id}...`)
        const link = await addLink(opId, { paw: agentPaw, abilityId: ability_id, ability, facts: [] })

        usedIds.add(ability_id)

        console.log(`  → Link created: ${link.id}, waiting for execution...`)
        await waitForLink(opId, link.id, { timeoutMs: 30000 })
        console.log(`  → Link finished, fetching result...`)

        // Fetch operation report with agent output to get stdout/stderr
		const report = await getOperationReport(opId)
		// Report steps is keyed by agent paw, e.g., { iwkbfg: { steps: [...] } }
		const agentSteps = report.steps?.[agentPaw]?.steps || []
		console.log(` → Report steps for agent:`, agentSteps.length)
		// Find the step by link_id (not linkId)
		const stepResult = agentSteps.find(s => s.link_id === link.id)
		console.log(` → Step output:`, JSON.stringify(stepResult?.output || {}).slice(0, 200))
        result = {
			linkId: link.id,
			ability: ability?.name || "unknown",
			abilityId: ability_id,
			technique: ability?.technique_id,
			command: link.plaintext_command || "",
			status: link.status === 0 ? "success" : "failed",
			exitCode: link.status,
			stdout: stepResult?.output?.stdout || "",
			stderr: stepResult?.output?.stderr || "",
			facts: link.facts || [],
		}
		console.log(` → stdout: ${result.stdout}`)
      } catch (err) {
        console.error(`  → ERROR: ${err.message}`)
          // ✅ GENERALIZED: Classify error by type, not by ability
          let errorType = "unknown"
          let guidance = "Try a different approach."
          
          if (err.message.includes("missing specified executor")) {
            errorType = "executor_unavailable"
            guidance = "This ability's execution method isn't available on this agent. Try a technique with a different executor."
          } else if (err.message.includes("timeout")) {
            errorType = "timeout"
            guidance = "The command took too long. Try a simpler or faster technique."
          } else if (err.message.includes("permission") || err.message.includes("denied")) {
            errorType = "permission_denied"
            guidance = "Access was denied. Consider privilege escalation or a different target."
          }
  
        result = {
          ability_id,
          ability:  ability?.name,
          abilityId: ability_id,
          technique: ability?.technique_id,
          status: "error",
          stdout: "",
          stderr: err.message,
          exitCode: -1,
        }
      }

      results.push({ step, reason, ...result })
      console.log(`  Exit: ${result.exitCode} | stdout: ${result.stdout.slice(0, 120)}`)

      // check win condition immediately
      const allOutput = `${result.stdout} ${result.stderr}`
      if (allOutput.includes(WIN_STRING)) {
        console.log(`\n[WIN] Found sensitive content in step ${step} via ${result.ability}`)
        outcome = {
          success:      true,
          winning_path: `${result.ability} (${ability_id})`,
          reason:       `Found win string in stdout of ${result.ability}`,
        }
        messages.push({
          role:         "tool",
          tool_call_id: toolCall.id,
          content:      JSON.stringify({ ...result, WIN_CONDITION: true }),
        })
        break
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          ability: result.ability,
          exitCode: result.exitCode,
          stdout: result.stdout?.slice(0, 2000),
          stderr: result.stderr?.slice(0, 500),
          facts: result.facts || [],
          status: result.status,
          errorType: result.errorType,  //helps LLM adapt without hardcoded logic
        }),
      })
    }
  }

  if (!outcome) {
    outcome = {
      success:      false,
      winning_path: null,
      reason:       `Max steps (${maxSteps}) reached without finding sensitive content`,
    }
  }

  return { outcome, results, steps: step, messages }
}