#!/usr/bin/env node
// bin/gatectl.mjs — exit codes are the API: 0 green, 1 not green, 2 NOT_EVALUATED.
import { COMMANDS } from "../src/cli/commands.mjs"

const [cmd, ...args] = process.argv.slice(2)
const handler = COMMANDS[cmd]
if (!handler) {
  console.error(`usage: gatectl <command> [--target <path>]\ncommands: ${Object.keys(COMMANDS).join(", ") || "(none wired yet)"}`)
  process.exit(2)
}
let code
try {
  code = await handler(args)
} catch (e) {
  console.error(`NOT_EVALUATED: ${e.message}`)
  process.exit(2)
}
// A pipe is written asynchronously: exiting before it drains cuts large output (a --json report)
// short. The callback of an empty write runs once everything queued before it is flushed.
await new Promise((resolve) => process.stdout.write("", resolve))
process.exit(typeof code === "number" ? code : 2)
