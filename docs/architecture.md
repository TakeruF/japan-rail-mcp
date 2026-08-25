# Architecture proposal

## Decision

The v0.1 implementation is Shinkansen-first and strictly read-only. It separates a
country-neutral rail core from Japanese extensions and provider-specific fields:

```text
MCP tools
  -> RailService (validation, filtering, pagination, comparison)
    -> JapanRailProvider (capability routing)
      -> StaticShinkansenStationProvider
      -> EkispertProvider (optional user-supplied key)

core schemas
  + japan extensions
  + provider-private response parsing
```

`search_trains` means direct trains only. `search_journeys` is a separate route-search
operation that may contain transfers. This avoids treating a journey as a train and keeps the
meaning compatible with `china-rail-mcp`.

## Provider boundaries

- MCP handlers do not fetch or parse provider data.
- `StationCatalogProvider` and `RailDataProvider` are separate because station search can remain
  useful when timetable access is unavailable.
- Capabilities are checked before network access. Unsupported operations return a structured
  `UNSUPPORTED_FEATURE` error or an explicit unsupported result, never fixtures presented as live
  data.
- Provider-native station codes and route payloads live only in the Japan/provider extension.
- Every successful result carries provenance and a retrieval timestamp.

## Interoperability boundary

Candidates for a future `rail-mcp-spec` package:

- `Station`, `StationRef`, `Train`, `Journey`, `JourneyLeg`
- `Fare`, `SeatClass`, `SeatAvailability`
- `Source`, `RailError`, `RailProviderCapabilities`
- date/time rules, pagination, and provider contract tests

Japan-only fields remain in `JapanStationExtension` and `JapanTrainExtension`: Shinkansen lines,
service names, provider bindings, and the distinction between passenger-facing train numbers and
provider/operational identifiers.

This is an experimental interoperability convention, not an official standard.
