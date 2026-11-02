export function createFixture(options?: { port?: number; origins?: string[] }): Promise<{
  url: string;
  username: string;
  password: string;
  nodes: Map<string, { directory: boolean; body: Buffer; type: string; modified: string }>;
  close: () => Promise<void>;
}>;
