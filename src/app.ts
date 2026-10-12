import { RailError } from './core/errors.js';
import { EkispertProvider } from './providers/ekispert.js';
import { StaticShinkansenStationProvider } from './providers/static/station-provider.js';
import { RailService } from './services/rail-service.js';
import { loadPersonalPreferences } from './core/preferences.js';

export function createDefaultService(env: NodeJS.ProcessEnv = process.env): RailService {
  const stations = new StaticShinkansenStationProvider();
  const baseUrl = validateBaseUrl(env.EKISPERT_API_BASE_URL);
  const rail = new EkispertProvider(stations, {
    ...(env.EKISPERT_API_KEY === undefined ? {} : { apiKey: env.EKISPERT_API_KEY }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
  return new RailService(stations, rail, () => new Date(), loadPersonalPreferences(env));
}

function validateBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new RailError('PROVIDER_UNAVAILABLE', 'EKISPERT_API_BASE_URL must be a valid URL.', {
      cause: error,
    });
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new RailError(
      'PROVIDER_UNAVAILABLE',
      'EKISPERT_API_BASE_URL must use HTTPS except for a loopback test server.',
    );
  }
  return url.toString().replace(/\/$/, '');
}
