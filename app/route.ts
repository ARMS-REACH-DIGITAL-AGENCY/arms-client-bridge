// Some MCP clients treat the configured server URL itself as the endpoint.
// Keep the root URL and /mcp behavior identical so both forms are supported.
export { GET, OPTIONS, POST } from "./mcp/route";
