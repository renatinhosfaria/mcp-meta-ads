export const TOOLSETS = ['ads', 'instagram'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export class InvalidToolsetError extends Error {
  constructor(readonly value: string) {
    super(`toolsets inválido: ${value}. Use: ${TOOLSETS.join(', ')}`);
    this.name = 'InvalidToolsetError';
  }
}

export function parseToolsets(raw: unknown): Toolset[] | undefined {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (parts.length === 0) return undefined;
  for (const part of parts) {
    if (!(TOOLSETS as readonly string[]).includes(part)) throw new InvalidToolsetError(part);
  }
  return [...new Set(parts)] as Toolset[];
}
