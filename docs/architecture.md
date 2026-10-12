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

## Personal option evaluation

`plan_shinkansen_trip` resolves personal constraints before making one departure-based provider
search. It derives the Japan-local date/time from station arrival plus boarding allowance, then
evaluates and saves returned trains for later local comparison. The result distinguishes a new
provider search from saved-snapshot evaluation. Arrival deadlines are filters, not backward searches.

Preferences are validated JSON loaded once at startup from an optional default user-config path
or `JAPAN_RAIL_PREFERENCES_FILE`. Global defaults, directional station allowances, and explicit
per-call overrides are merged in that order. Null budget/seat-class overrides clear saved values.
The read-only `get_personal_preferences` tool exposes loaded settings; no tool edits the file.

`RailService` retains a bounded, process-local snapshot of normalized trains returned by searches
(200 records, 15-minute lifetime). `evaluate_train_options` resolves IDs exclusively against this
snapshot and calls a pure evaluator. Missing/expired IDs fail without a network fallback.
This is explicit re-evaluation of a previous result, not automatic provider-response caching:
every `search_trains` and `compare_trains` invocation still queries the provider.

The evaluator applies personal station arrival/boarding/exit allowances, a destination deadline,
budget, and exact seat-class fare selection. It preserves original provenance, identifies the
snapshot data mode, and separates its evaluation timestamp from provider retrieval timestamps.
No indoor path, commuter-pass deduction, discount, or seat inventory is inferred.

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
