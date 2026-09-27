// Read-only readiness check for CI. Never print private response bodies or errors.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPrivateContentClient } from '../private-content-client.mjs'

export async function checkPrivateBackend() {
  // An offline fixture must never make the deployed backend appear healthy.
  if (process.env.NANALY_PRIVATE_TEST_MODE || process.env.NANALY_PRIVATE_TEST_DIR) throw new Error('Offline storage is not a backend readiness check.')
  if (!process.env.NANALY_AGENT_URL?.trim() || !process.env.NANALY_AGENT_TOKEN?.trim()) throw new Error('Missing backend configuration.')
  if (new URL(process.env.NANALY_AGENT_URL).protocol !== 'https:') throw new Error('HTTPS is required.')
  // initialize only GETs the four fixed record names, requires revision >= 1,
  // validates every schema, bounds response bytes and applies a 15s timeout.
  // No flush, model client, mailer or publication module is loaded here.
  await createPrivateContentClient().initialize()
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await checkPrivateBackend()
    console.log('Private backend ready: schedule, journal, profile, usage.')
  } catch {
    // Upstream errors may contain response data, URLs or credentials. Keep this
    // public Actions diagnostic fixed, including for invalid configuration.
    console.error('Private backend readiness failed. Check NANALY_AGENT_URL, NANALY_AGENT_TOKEN, backend availability and private-content migration.')
    process.exitCode = 1
  }
}
