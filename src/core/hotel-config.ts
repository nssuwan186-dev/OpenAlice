import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'

const CONFIG_DIR = resolve('data/config')
const HOTEL_CONFIG_FILE = 'hotel.json'

const hotelConfigSchema = z.object({
  databasePath: z.string().default('data/db/hotel.sqlite'),
  schemaPath: z.string().default('data/schema/hotel-schema.sql'),
  timezone: z.string().default('Asia/Bangkok'),
})

export type HotelConfig = z.infer<typeof hotelConfigSchema>

async function loadJsonFile(filename: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(resolve(CONFIG_DIR, filename), 'utf-8'))
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

async function parseAndSeed<T>(filename: string, schema: z.ZodType<T>, raw: unknown | undefined): Promise<T> {
  const parsed = schema.parse(raw ?? {})
  if (raw === undefined) {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, filename), JSON.stringify(parsed, null, 2) + '\n')
  }
  return parsed
}

export async function loadHotelConfig(): Promise<HotelConfig> {
  const raw = await loadJsonFile(HOTEL_CONFIG_FILE)
  return parseAndSeed(HOTEL_CONFIG_FILE, hotelConfigSchema, raw)
}
