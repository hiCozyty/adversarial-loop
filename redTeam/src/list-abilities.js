// scripts/list-abilities.js
// run this first to get the actual UUIDs from your Caldera instance
// bun run scripts/list-abilities.js

const BASE   = process.env.CALDERA_URL
const APIKEY = process.env.CALDERA_KEY

const res = await fetch(`${BASE}/api/v2/abilities`, {
  headers: { "KEY": APIKEY }
})

const abilities = await res.json()

// filter to linux abilities only and print a table
const linux = abilities
  .filter(a => a.executors?.some(e => e.platform === "linux"))
  .sort((a, b) => a.tactic.localeCompare(b.tactic))

console.log("\nLinux abilities in Caldera:\n")
console.log("ability_id                            | tactic               | technique   | name")
console.log("-".repeat(100))

for (const a of linux) {
  const id   = a.ability_id.padEnd(36)
  const tac  = (a.tactic || "").padEnd(20)
  const tech = (a.technique_id || "").padEnd(11)
  console.log(`${id} | ${tac} | ${tech} | ${a.name}`)
}

console.log(`\nTotal: ${linux.length} Linux abilities`)