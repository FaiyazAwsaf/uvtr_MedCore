/** Staff route loading skeleton: a KPI row and two cards, in the card surfaces. */
export default function AppLoading() {
  return (
    <div className="flex flex-1 flex-col gap-5 pt-1" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[8.25rem] animate-pulse rounded-lg bg-card shadow-(--card-shadow)"
          />
        ))}
      </div>
      <div className="grid min-h-64 flex-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="animate-pulse rounded-lg bg-card shadow-(--card-shadow)" />
        <div className="animate-pulse rounded-lg bg-card shadow-(--card-shadow)" />
      </div>
    </div>
  )
}
