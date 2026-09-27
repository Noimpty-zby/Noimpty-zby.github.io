import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializePrivateContent } from '../private-content-client.mjs'

// Explicit external fixtures only. This helper never loads repository data.
export async function privateFixture(initial = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'nanaly-private-fixture-'))
  const old = { mode: process.env.NANALY_PRIVATE_TEST_MODE, directory: process.env.NANALY_PRIVATE_TEST_DIR }
  process.env.NANALY_PRIVATE_TEST_MODE = '1'
  process.env.NANALY_PRIVATE_TEST_DIR = directory
  const defaults = { schedule: { days: {} }, journal: { v: 1, entries: [] }, usage: { v: 1, runs: [] }, profile: 'Synthetic Linux Go interests' }
  const write = (name, data, revision = 1) => writeFileSync(join(directory, name + '.json'), JSON.stringify({ revision, data }), { mode: 0o600 })
  for (const [name, data] of Object.entries({ ...defaults, ...initial })) write(name, data)
  await initializePrivateContent({ force: true })
  return {
    directory, write,
    read: name => JSON.parse(readFileSync(join(directory, name + '.json'), 'utf8')),
    reload: () => initializePrivateContent({ force: true }),
    async set(name, data, revision = 1) { write(name, data, revision); await initializePrivateContent({ force: true }) },
    close() {
      old.mode === undefined ? delete process.env.NANALY_PRIVATE_TEST_MODE : process.env.NANALY_PRIVATE_TEST_MODE = old.mode
      old.directory === undefined ? delete process.env.NANALY_PRIVATE_TEST_DIR : process.env.NANALY_PRIVATE_TEST_DIR = old.directory
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
