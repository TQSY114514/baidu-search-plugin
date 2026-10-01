// Module resolve hook: maps every openclaw/plugin-sdk/* import to the stub.
const STUB_URL = new URL("./openclaw-sdk-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("openclaw/plugin-sdk/")) {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
