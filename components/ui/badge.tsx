import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Pills and tags (docs/ui_guidelines.md §4 "Status tag"): fully rounded, soft
 * 15% tint with coloured text for statuses; a filled turquoise pill for the
 * default; `count` is the sample's yellow circle.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/88",
        secondary:
          "bg-surface-raised text-foreground [a]:hover:bg-surface-raised/80",
        soft: "bg-primary-soft text-link",
        success:
          "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success",
        warning:
          "bg-[color-mix(in_oklch,var(--warning)_15%,transparent)] text-warning",
        info: "bg-[color-mix(in_oklch,var(--info)_15%,transparent)] text-info",
        destructive:
          "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive [a]:hover:bg-[color-mix(in_oklch,var(--destructive)_22%,transparent)]",
        muted: "bg-surface-raised text-muted-foreground",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-surface-raised",
        count:
          "count-badge h-5 min-w-5 px-1.5 text-[0.6875rem] font-semibold tabular-nums",
        ghost: "hover:bg-surface-raised hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
