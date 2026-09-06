export function runtimeImports(source: string, file?: string): string[];
export function checkRendererGraph(
  entries: string[],
  read?: (path: string) => string,
  exists?: (path: string) => boolean,
): Set<string>;
export function checkBundle(directory: string): void;
