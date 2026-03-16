/**
 * Unified Operation Dispatcher
 *
 * Bridges TradingGit's typed Operation → ITradingAccount method calls.
 * With discriminated union operations, this is now a simple forwarding layer.
 */

import type { ITradingAccount } from './interfaces.js'
import type { Operation } from './git/types.js'

export function createOperationDispatcher(account: ITradingAccount) {
  return async (op: Operation): Promise<unknown> => {
    switch (op.action) {
      case 'placeOrder':
        return account.placeOrder(op.contract, op.order)

      case 'modifyOrder':
        return account.modifyOrder(op.orderId, op.changes as Parameters<ITradingAccount['modifyOrder']>[1])

      case 'closePosition':
        return account.closePosition(op.contract, op.quantity)

      case 'cancelOrder':
        return account.cancelOrder(op.orderId, op.orderCancel)

      default:
        throw new Error(`Unknown operation action: ${(op as { action: string }).action}`)
    }
  }
}
