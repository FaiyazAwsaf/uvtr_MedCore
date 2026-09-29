import { ApprovalsScreen } from "@/modules/procurement/components/approvals-screen"

/** "/finance/approvals": high-value approvals for the CFO, and counter approvals (plan §9). */
export default function FinanceApprovalsPage() {
  return <ApprovalsScreen mode="finance" />
}
