import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-md border px-4 py-3 text-left text-[0.8125rem] has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-28 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-hairline bg-card text-card-foreground",
        destructive:
          "border-[color-mix(in_oklch,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] text-destructive *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-current",
        warning:
          "border-[color-mix(in_oklch,var(--warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-warning",
        info: "border-[color-mix(in_oklch,var(--info)_30%,transparent)] bg-[color-mix(in_oklch,var(--info)_10%,transparent)] text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-info",
        success:
          "border-[color-mix(in_oklch,var(--success)_30%,transparent)] bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:text-link [&_a]:underline-offset-3 [&_a]:hover:underline",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-[0.8125rem] text-balance text-muted-foreground md:text-pretty [&_a]:text-link [&_a]:underline-offset-3 [&_a]:hover:underline [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
