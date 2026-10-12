import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { serializeRailError } from './core/errors.js';
import {
  availabilitySchema,
  journeySchema,
  railProviderCapabilitiesSchema,
  stationSchema,
  trainDetailsSchema,
  trainSchema,
} from './core/schemas.js';
import type { RailService } from './services/rail-service.js';
import { trainOptionsSchema } from './services/train-options.js';
import { personalInputShape, preferencesSchema } from './core/preferences.js';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an explicit YYYY-MM-DD date in Asia/Tokyo.');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use 24-hour HH:MM.');
const stationId = z.string().min(1).describe('Canonical ID returned by search_stations.');
const pagination = {
  limit: z.number().int().min(1).max(20).default(10),
  offset: z.number().int().min(0).max(19).default(0),
};
const trainFilters = {
  departureAfter: time.optional(),
  departureBefore: time.optional(),
  serviceTypes: z.array(z.string().min(1)).max(20).optional(),
  operators: z.array(z.string().min(1)).max(20).optional(),
};
const searchTrainShape = {
  fromStationId: stationId,
  toStationId: stationId,
  date,
  ...trainFilters,
};
const trainPageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable(),
  trains: z.array(trainSchema),
});
const providerStatusSchema = z.object({
  provider: z.string(),
  capabilities: railProviderCapabilitiesSchema,
  configured: z.boolean(),
  notes: z.array(z.string()),
});
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function createServer(service: RailService): McpServer {
  const server = new McpServer(
    { name: 'japan-rail-mcp', version: '0.1.0' },
    {
      instructions:
        'Read-only Japanese railway data with a Shinkansen-first scope. Resolve station names with search_stations before train searches; never substitute an ambiguous city or station. For personal timing and budget questions, prefer plan_shinkansen_trip for a single provider search, then reuse returned IDs with evaluate_train_options for preference changes without another request. Saved local preferences apply unless explicitly overridden. search_trains returns direct Shinkansen services, while search_journeys is a separate capability. All travel dates must be explicit and all returned railway timestamps use Asia/Tokyo (+09:00). Availability is unsupported unless a provider can prove it. Verify important travel and fare details through an official railway channel and do not poll automatically.',
    },
  );

  server.registerTool(
    'get_provider_status',
    {
      title: 'Get rail provider status',
      description:
        'Use before live train queries to see which read-only capabilities are configured and why unavailable capabilities are disabled.',
      inputSchema: z.object({}),
      outputSchema: providerStatusSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolCall(() => service.getProviderStatus()),
  );

  server.registerTool(
    'search_stations',
    {
      title: 'Search Japanese railway stations',
      description:
        'Use this before search_trains whenever no canonical station ID is known. Returns candidates for Japanese, English, and common romanized names without silently resolving ambiguous inputs such as Osaka or Fukuoka.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: z.object({ stations: z.array(stationSchema) }),
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.searchStations(input)),
  );

  server.registerTool(
    'search_trains',
    {
      title: 'Search direct Shinkansen trains',
      description:
        'Use after resolving both station IDs. Searches direct Shinkansen services only, never transfer journeys. Requires an explicit date; optional time, service, and operator filters are applied before pagination.',
      inputSchema: z.object({ ...searchTrainShape, ...pagination }),
      outputSchema: trainPageSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ limit, offset, ...input }) =>
      toolCall(() => service.searchTrains(input, { limit, offset })),
  );

  server.registerTool(
    'get_train_details',
    {
      title: 'Get Shinkansen train details',
      description:
        'Use with the opaque trainId returned by search_trains to retrieve that service and its ordered stops. Do not construct train IDs manually.',
      inputSchema: z.object({ trainId: z.string().min(1) }),
      outputSchema: trainDetailsSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.getTrainDetails(input)),
  );

  server.registerTool(
    'get_availability',
    {
      title: 'Get seat availability',
      description:
        'Use only to check whether the configured provider exposes seat inventory for an exact train and station pair. The default provider returns an explicit unsupported status and never fabricates inventory.',
      inputSchema: z.object({
        trainId: z.string().min(1),
        fromStationId: stationId,
        toStationId: stationId,
        date,
      }),
      outputSchema: availabilitySchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.getAvailability(input)),
  );

  server.registerTool(
    'compare_trains',
    {
      title: 'Compare direct Shinkansen trains',
      description:
        'Use to sort structured direct-train candidates by departure, arrival, duration, or total fare. This tool does not make a subjective recommendation.',
      inputSchema: z.object({
        ...searchTrainShape,
        ...pagination,
        sortBy: z
          .enum(['departure_time', 'arrival_time', 'duration', 'price'])
          .default('departure_time'),
      }),
      outputSchema: trainPageSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ limit, offset, sortBy, ...input }) =>
      toolCall(() => service.compareTrains(input, { limit, offset }, sortBy)),
  );

  server.registerTool(
    'search_journeys',
    {
      title: 'Search transfer journeys',
      description:
        'Use for routes that may include transfers, not for an individual train. The Shinkansen-first v0.1 provider reports this capability as unsupported rather than returning direct trains under the wrong concept.',
      inputSchema: z.object({
        ...searchTrainShape,
        includeNonShinkansen: z.boolean().default(true),
      }),
      outputSchema: z.object({ journeys: z.array(journeySchema) }),
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.searchJourneys(input)),
  );

  server.registerTool(
    'get_station_details',
    {
      title: 'Get local station details',
      description:
        'Get bundled station metadata by canonical station ID, including Shinkansen lines and source. No API key or network request. Does not provide indoor routes or walking times.',
      inputSchema: z.object({ stationId }),
      outputSchema: stationSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.getStationDetails(input.stationId)),
  );

  server.registerTool(
    'evaluate_train_options',
    {
      title: 'Evaluate trains with personal time and budget constraints',
      description:
        'After search_trains or compare_trains, compare up to 20 returned train IDs for the same route and date without another provider request. Applies station arrival time, boarding and exit allowances, arrival deadline, budget, and an optional exact seat-class fare. Returns cheapest, shortest ride, and earliest arrival picks plus exclusion reasons. Uses a session snapshot valid for 15 minutes; does not refresh schedules or verify availability. Reuse this tool to change preferences cheaply.',
      inputSchema: z.object({
        trainIds: z.array(z.string().min(1)).min(1).max(20),
        ...personalInputShape,
      }),
      outputSchema: trainOptionsSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ trainIds, ...constraints }) =>
      toolCall(() => service.evaluateSavedTrains(trainIds, constraints)),
  );

  server.registerTool(
    'plan_shinkansen_trip',
    {
      title: 'Search and plan a personal Shinkansen trip',
      description:
        'After resolving both canonical station IDs, search once and compare direct Shinkansen trains with personal time, budget, and seat-class constraints. Omitted preferences use local defaults and station-specific allowances; explicit values override them, and null clears budget or seat-class defaults. Search starts at stationReadyAt plus boarding allowance; the Japan-local search date is derived from that timestamp. Departure-based search covers at most 20 candidates, not every train before an arrival deadline. Returned IDs can be re-evaluated locally for 15 minutes.',
      inputSchema: z.object({
        fromStationId: stationId,
        toStationId: stationId,
        ...personalInputShape,
      }),
      outputSchema: trainOptionsSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => toolCall(() => service.planShinkansenTrip(input)),
  );

  server.registerTool(
    'get_personal_preferences',
    {
      title: 'Read local personal planning preferences',
      description:
        'Read the preferences loaded at server startup: global defaults and station-specific boarding/exit allowances. No network request or file mutation. Edit the local preferences JSON and restart the server to change saved values. Per-call values override saved values.',
      inputSchema: z.object({}),
      outputSchema: preferencesSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolCall(() => service.getPersonalPreferences()),
  );

  return server;
}

async function toolCall<T extends object>(
  operation: () => T | Promise<T>,
): Promise<
  | { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown> }
  | { content: { type: 'text'; text: string }[]; isError: true }
> {
  try {
    const output = await operation();
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output as Record<string, unknown>,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify(serializeRailError(error), null, 2) }],
      isError: true,
    };
  }
}
