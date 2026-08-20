import { createUsableLlmServer } from "./lib/usable-llm.mjs";

const port = Number(process.env.PENGLAI_FIXTURE_PORT ?? 0);
const server = createUsableLlmServer();
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const addr = server.address();
const actual = typeof addr === "object" && addr ? addr.port : port;
process.stdout.write(`http://127.0.0.1:${actual}/v1\n`);
export { server };
