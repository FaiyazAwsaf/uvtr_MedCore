// In-memory IndexedDB for engine tests (Dexie runs against it in Node).
import "fake-indexeddb/auto"

// TEST_DAY_SHIFT=<days> runs the suite as if the wall clock were that many
// days away, to catch tests that only pass on the day their seed data was read.
const shiftDays = Number(process.env.TEST_DAY_SHIFT ?? 0)
if (shiftDays) {
  const realNow = Date.now.bind(Date)
  Date.now = () => realNow() + shiftDays * 86_400_000
}
