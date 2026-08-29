export async function getRequiredAgentMachineId(): Promise<string> {
  try {
    const id = await window.electronAPI?.getMachineId?.();
    if (typeof id === "string" && id.trim()) return id;
  } catch {
    /* fall through to the explicit create failure below */
  }
  throw new Error("Cannot create agent without this machine's machineId.");
}
