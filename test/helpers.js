/** Collect what a command writes instead of printing it. */
export function capture() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      stdout: { write: (text) => { out.stdout += text; } },
      stderr: { write: (text) => { out.stderr += text; } },
    },
  };
}
