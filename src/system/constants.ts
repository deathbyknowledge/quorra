export const formatPrompt = (cwd?: string) => `\x1b[1m${cwd ?? "/"}$\x1b[0m `;
export const stdout = (input: any) =>`\x1b[33m${input}\x1b[0m`;
export const stderr = (input: any) =>`\x1b[1;31mERROR:\x1b[0m ${stdout(input)}`;