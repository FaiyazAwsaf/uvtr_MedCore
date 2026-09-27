import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Buttons (docs/ui_guidelines.md §4).
 * - default: filled turquoise, dark text, weight 600, 40px (sm is the 32px compact size)
 * - outline: 1px turquoise border and text, transparent, soft turquoise on hover
 * - neutral: 1px border, foreground text (select-like controls, secondary actions)
 * - secondary / ghost: raised surface or transparent, foreground text
 * - destructive (filled) and destructive-outline: rare (reject, cancel, void)
 * - link: turquoise text link ("See all", "Details")
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/35 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary font-semibold text-primary-foreground hover:bg-primary/88 focus-visible:ring-primary/40",
        outline:
          "border-primary bg-transparent text-link hover:bg-primary-soft aria-expanded:bg-primary-soft",
        neutral:
          "border-border bg-transparent text-foreground hover:bg-surface-raised aria-expanded:bg-surface-raised",
        secondary:
          "bg-surface-raised text-foreground hover:bg-[color-mix(in_oklch,var(--surface-raised),var(--foreground)_7%)] aria-expanded:bg-[color-mix(in_oklch,var(--surface-raised),var(--foreground)_7%)]",
        ghost:
          "text-foreground hover:bg-surface-raised aria-expanded:bg-surface-raised",
        destructive:
          "bg-destructive font-semibold text-white hover:bg-destructive/88 focus-visible:ring-destructive/40 dark:text-background",
        "destructive-outline":
          "border-destructive bg-transparent text-destructive hover:bg-destructive/12 focus-visible:ring-destructive/35",
        link: "h-auto! border-0 px-0! text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-7 gap-1 rounded-sm px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-[0.8125rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        compact:
          "h-8 gap-1.5 px-3 text-[0.8125rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-11 gap-2 px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[1.125rem]",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-[1.125rem]",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
