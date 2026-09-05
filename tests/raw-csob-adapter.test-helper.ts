import {
  CsobEapi19CustomerPaymentAdapter,
  type CsobEapi19AdapterConfig,
  type InitializedCsobPaymentOperation,
} from "../src/client/csob-eapi-1-9-adapter"
import type { InitializeCustomerPaymentCommand } from "../src/client"

export class TestableCsobEapi19CustomerPaymentAdapter extends CsobEapi19CustomerPaymentAdapter {
  constructor(config: CsobEapi19AdapterConfig) {
    super(config)
  }

  initializePaymentOperationForTest(
    command: InitializeCustomerPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    return this.initializePaymentOperation(command)
  }
}
