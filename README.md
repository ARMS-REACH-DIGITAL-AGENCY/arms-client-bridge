# ARMS Client Bridge

Internal MCP gateway between ChatGPT and ARMS/HighLevel.

## Production URL

`https://client-bridge.armsreachdigital.agency`

MCP endpoint: `/mcp`

Health endpoint: `/api/health`

OAuth discovery: `/.well-known/oauth-authorization-server`

## Architecture

ChatGPT authenticates to this bridge with the bridge's OAuth flow (or `BRIDGE_API_KEY` for direct testing). HighLevel credentials remain server-side in Vercel environment variables and are never returned to MCP clients.

For internal ARMS access, the bridge supports HighLevel Private Integration Tokens (PITs):

- `HIGHLEVEL_AGENCY_PIT` for agency-level APIs.
- `HIGHLEVEL_LOCATION_PITS` for explicit sub-account/location PITs.
- If no location PIT exists, the bridge attempts HighLevel's documented agency-to-location token exchange using `HIGHLEVEL_AGENCY_PIT` + `HIGHLEVEL_COMPANY_ID`.

## Required Vercel environment variables

Copy `.env.example` names into Vercel. Never commit real secrets.

Minimum secure configuration:

- `BRIDGE_BASE_URL=https://client-bridge.armsreachdigital.agency`
- `BRIDGE_SIGNING_SECRET` — at least 32 random characters
- `BRIDGE_ADMIN_PASSWORD` — password used on the bridge authorization page
- `HIGHLEVEL_DEFAULT_LOCATION_ID=QLS1wvtsvzL1YsLFxYcM` for Susie Sculpts
- `HIGHLEVEL_AGENCY_PIT` and `HIGHLEVEL_COMPANY_ID`. The agency PIT must include HighLevel's `oauth.write` scope so the bridge can obtain a location token dynamically for every current and future sub-account.

Optional:

- `BRIDGE_API_KEY` — dedicated bearer key for direct MCP testing

## MCP tools

- `arms_status` — returns bridge configuration flags only.
- `arms_list_locations` — agency-level location search.
- `arms_highlevel_get` — read-only generic HighLevel API request.
- `arms_highlevel_mutate` — HighLevel POST/PUT/PATCH/DELETE request; marked destructive so clients can require confirmation.

The generic tools only call `https://services.leadconnectorhq.com`, require relative API paths, and block `/oauth/*` so HighLevel tokens cannot be retrieved through the MCP layer. Use `api_path` for advanced requests; `path` remains supported for existing clients.

## ChatGPT custom app

In ChatGPT developer mode, create a custom MCP app using:

`https://client-bridge.armsreachdigital.agency/mcp`

Choose OAuth authentication. The bridge supports OAuth discovery, dynamic client registration, PKCE S256, access tokens, and refresh tokens. During the first connection, enter `BRIDGE_ADMIN_PASSWORD` on the ARMS authorization page.

## HighLevel notes

HighLevel PITs are static/fixed scoped access tokens intended for internal server-to-server integrations. Rotate them periodically and update the Vercel secret when rotated.
