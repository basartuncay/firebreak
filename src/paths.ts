import { homedir } from "node:os";
import { join } from "node:path";

export const firebreakHome = (): string => process.env.FIREBREAK_HOME ?? join(homedir(), ".firebreak");
export const dbPath = (): string => join(firebreakHome(), "firebreak.db");
export const policyPath = (): string => join(firebreakHome(), "policy.yaml");
