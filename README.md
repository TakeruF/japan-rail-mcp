# japan-rail-mcp

`japan-rail-mcp` is a read-only Model Context Protocol server for structured Japanese railway
data. Version 0.1 is deliberately **Shinkansen-first**: it provides a useful credential-free
station catalog and can query live Shinkansen timetables, fares, seat classes, and stops through a
deployment owner's Ekispert API Standard Plan key.

The server never books tickets, signs in to railway accounts, bypasses access controls, scrapes
operator websites, or presents test fixtures as live data.

> japan-rail-mcp is designed to share a common conceptual interface with china-rail-mcp, with the
> long-term goal of establishing interoperable schemas for railway MCP servers across countries.

This is an **experimental interoperability convention**, not an official railway or MCP standard.

## Features

| Capability                                      | Without an API key                                 | With `EKISPERT_API_KEY`        |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| Japanese, English, and romanized station search | Yes, bundled 58-station Shinkansen-focused catalog | Yes                            |
| Ambiguous station candidates                    | Yes                                                | Yes                            |
| Direct Shinkansen timetable search              | Explicitly unsupported                             | Yes, subject to the key's plan |
| Fare amounts in numeric JPY                     | Explicitly unsupported                             | Yes                            |
| Seat-class normalization                        | Explicitly unsupported                             | Yes                            |
| Ordered train stops                             | Explicitly unsupported                             | Yes                            |
| Reservation inventory / seat availability       | Explicitly unsupported                             | Explicitly unsupported         |
| Transfer journey search                         | Explicitly unsupported in v0.1                     | Explicitly unsupported in v0.1 |

All successful data includes source provenance. Railway timestamps are explicit ISO 8601 values
with the Japan offset, for example `2026-08-26T12:03:00+09:00`. Relative dates such as “tomorrow”
must be resolved by the MCP client; the server requires `YYYY-MM-DD`.

## MCP tools

| Tool                  | When to use it                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `get_provider_status` | Check configured providers and capability boundaries before a live query.                  |
| `search_stations`     | Resolve a name to one or more canonical `jp:station:*` IDs. Use before train search.       |
| `search_trains`       | Search direct Shinkansen services between two resolved station IDs.                        |
| `get_train_details`   | Read the ordered stops for an opaque `trainId` returned by `search_trains`.                |
| `get_availability`    | Check provider support; currently returns `status: "unsupported"` without invented counts. |
| `compare_trains`      | Sort the same structured direct-train candidates without a subjective recommendation.      |
| `search_journeys`     | Reserved for transfer routes; returns a structured unsupported error in v0.1.              |

Every tool is annotated read-only, non-destructive, and idempotent. Every successful tool result
includes both human-readable JSON text and MCP `structuredContent` validated against an output
schema.

## Installation

Requirements: Node.js 22 or newer. CI uses Node.js 24 LTS.

```bash
git clone https://github.com/TakeruF/japan-rail-mcp.git
cd japan-rail-mcp
npm install
npm run build
```

Start the stdio server:

```bash
npm start
```

After an npm release, clients can alternatively launch it with:

```bash
npx -y japan-rail-mcp
```

### Live Shinkansen data

Live timetable functionality requires an access key whose Ekispert API agreement includes the
Standard Plan route-search endpoint. The free plan does not provide that core endpoint.

```bash
export EKISPERT_API_KEY='your-own-key'
npm start
```

The key is sent only to the configured Ekispert API endpoint. It is never returned in tool results
or included in provider errors. The project does not include a shared key, sublicense provider
data, or override the request limits attached to your agreement.

## Client configuration

### Claude Desktop

For a local checkout, add an entry like this and replace the absolute path:

```json
{
  "mcpServers": {
    "japan-rail": {
      "command": "node",
      "args": ["/absolute/path/to/japan-rail-mcp/dist/index.js"],
      "env": {
        "EKISPERT_API_KEY": "your-own-key"
      }
    }
  }
}
```

Omit the `env` object for station search only. Prefer your client's secret-management facility
over committing keys to a configuration repository.

### Codex

Register the built stdio command with Codex's MCP configuration, or use the CLI form supported by
your installed Codex version:

```bash
codex mcp add japan-rail -- node /absolute/path/to/japan-rail-mcp/dist/index.js
```

Provide `EKISPERT_API_KEY` through the process environment or Codex's secret configuration when
live train data is required.

## Tool examples

First resolve station candidates:

```json
{
  "query": "Osaka"
}
```

The result deliberately includes both Osaka and Shin-Osaka when relevant. Then use the exact IDs:

```json
{
  "fromStationId": "jp:station:tokyo",
  "toStationId": "jp:station:shin-osaka",
  "date": "2026-08-26",
  "departureAfter": "12:00",
  "serviceTypes": ["shinkansen"],
  "limit": 10,
  "offset": 0
}
```

A normalized fare is numeric and currency-safe:

```json
{
  "amount": 14720,
  "currency": "JPY",
  "formatted": "¥14,720",
  "kind": "total"
}
```

`formatted` is display-only; clients should use `amount` and `currency` for comparison.

## Data sources

### Bundled station catalog

The project-maintained catalog covers 58 high-value stations: current Shinkansen networks plus a
small set of deliberately ambiguous comparison stations such as Osaka, Shinjuku-area stations,
and Fukuoka in Toyama. It contains station metadata only—no timetable, fare, or availability data.
Operator route maps and travel pages are linked in [the source assessment](docs/data-sources.md).

### Ekispert API

The optional provider uses documented endpoints and a deployment owner's access key. It requests
explicit dates, an explicit midnight when no lower time bound is supplied, stops, seat types, and
operator details. Responses identify `ekispert-standard`, the endpoint dataset, retrieval time,
realtime status, and the provider-agreement boundary.

### Sources not used for Shinkansen timetable data

- The current ODPT JR East train-timetable dataset explicitly excludes Shinkansen.
- GTFS-JP v4 is a data specification, not a nationwide feed or a blanket data license.
- Public JR timetable pages and PDFs do not provide the project with a general-purpose API or a
  redistribution grant, so they are not scraped or bundled.

See [docs/data-sources.md](docs/data-sources.md) for the dated assessment and primary links.

## Architecture

```text
MCP tools
  -> RailService
    -> StationCatalogProvider
       -> StaticShinkansenStationProvider
    -> RailDataProvider
       -> EkispertProvider (optional key)

core rail schemas
  + Japan extensions
  + provider-private parsing and identifiers
```

MCP handlers validate and describe tool calls but do not fetch or parse provider data. Capability
checks fail closed before network access. `search_trains` represents a direct physical train;
`search_journeys` represents an itinerary that may contain transfers. See
[docs/architecture.md](docs/architecture.md) for the extraction boundary.

## Relation to china-rail-mcp

The shared tool names are:

- `search_stations`
- `search_trains`
- `get_train_details`
- `get_availability`
- `compare_trains`

The common candidate schemas are `Station`, `StationRef`, `Train`, `Journey`, `Fare`, `SeatClass`,
`SeatAvailability`, `Source`, `RailError`, and `RailProviderCapabilities`. The contract keeps
numeric ISO 4217 fares, explicit country-local time offsets, provenance, canonical station IDs,
provider capability checks, and structured errors.

Japan-specific details live under `extensions.japan`, including:

- Shinkansen lines and service names
- provider station names
- passenger-facing train numbers versus operational/provider identifiers
- Japanese seat labels such as `自由席`, `指定席`, `グリーン車`, and `グランクラス`

These boundaries are candidates for a future independent `rail-mcp-spec`; this repository does not
claim that such a standard already exists.

## Limitations

- A credential-free install searches stations only.
- Live train behavior has fixture-backed contract tests but has not been validated with a real
  account in this repository. A successful test fixture is not proof of production provider access.
- The Ekispert Standard Plan, limits, allowed presentation, commercial use, caching, and
  redistribution rights depend on the deployment owner's agreement.
- Search results are limited to the provider's first 20 answers per request.
- `search_trains` returns only direct Shinkansen routes. Transfers are not silently flattened.
- Seat classes and published fares are not seat inventory. `get_availability` remains unsupported.
- Service disruptions and realtime train positions are not included.
- The bundled station catalog is Shinkansen-focused, not a complete national station database.
- Important travel, fare, and ticket conditions must be checked with the railway operator or an
  authorized booking channel.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run format
```

Tests cover Japanese/English station matching, ambiguity, Tokyo–Shin-Osaka fixture parsing,
explicit dates and Tokyo timezone boundaries, provider failures, unsupported availability, MCP
structured output, read-only annotations, and a reusable shared rail schema contract.

## Security and read-only scope

There are no ticket purchase, reservation, login, payment, CAPTCHA, account, or mutation tools.
See [SECURITY.md](SECURITY.md) for credential-handling guidance.

## License

Project source code is available under the [MIT License](LICENSE). That license applies to this
repository's code; it does **not** relicense railway-operator data, Ekispert responses, ODPT
datasets, GTFS feeds, or third-party trademarks. Each data source remains subject to its own terms.
