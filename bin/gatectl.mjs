#!/usr/bin/env node
// bin/gatectl.mjs — exit codes are the API: 0 green, 1 not green, 2 NOT_EVALUATED.
import { COMMANDS } from "../src/cli/commands.mjs"

// A reader that has gone away (`gatectl ... | head`) closes stdout under us. That is not the
// command's failure: remember it, stop waiting on the pipe, and keep the command's own code.
let stdoutClosed = false
process.stdout.on("error", () => { stdoutClosed = true })

// A pipe is written asynchronously: exiting before it drains cuts large output (a --json report)
// short. The callback of an empty write runs once everything queued before it is flushed. Every
// exit — a normal return or an exception — goes through here.
async function exit(code) {
  if (!stdoutClosed) await new Promise((resolve) => {
    process.stdout.once("error", resolve)
    process.stdout.write("", resolve)
  })
  process.exit(code)
}

const [cmd, ...args] = process.argv.slice(2)
const handler = COMMANDS[cmd]
if (!handler) {
  console.error(`usage: gatectl <command> [--target <path>]\ncommands: ${Object.keys(COMMANDS).join(", ") || "(none wired yet)"}`)
  await exit(2)
}
let code
try {
  code = await handler(args)
} catch (e) {
  console.error(`NOT_EVALUATED: ${e.message}`)
  await exit(2)
}
await exit(typeof code === "number" ? code : 2)
