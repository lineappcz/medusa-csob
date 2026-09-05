import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import CsobProvider from "./service"
export { default as CsobProvider } from "./service"
export type { CsobProviderOptions } from "./service"
export * from "./operation-store"
export * from "./amount"
export * from "./options"
export default ModuleProvider(Modules.PAYMENT, { services: [CsobProvider] })
