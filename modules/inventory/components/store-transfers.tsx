"use client"

import {
  StoreBranchPicker,
  useStoreBranch,
} from "@/modules/procurement/components/store-context"

import { TransfersScreen } from "./transfers-screen"

/**
 * "/store/transfers": the transfers screen for the store (plan §9). Requests
 * raised here come "from the store", and every transfer shows its value at
 * cost, since both branches' stock updates at cost. The head of procurement
 * picks the branch.
 */
export function StoreTransfersScreen() {
  const { branch } = useStoreBranch()
  return (
    <TransfersScreen
      branch={branch}
      requestedFrom="store"
      showValue
      headerActions={<StoreBranchPicker allowNetwork={false} />}
    />
  )
}
