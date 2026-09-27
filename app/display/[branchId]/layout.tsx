/**
 * The queue display board (plan §9 `/display/[branchId]`) is a TV: always
 * full-screen dark whatever the window's theme (docs/ui_guidelines.md §6).
 * The `dark` class scopes the dark tokens to this subtree.
 */
export default function DisplayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="display-board"
      className="dark flex min-h-svh flex-col bg-background text-foreground"
    >
      {children}
    </div>
  )
}
