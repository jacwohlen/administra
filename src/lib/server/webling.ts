import { env } from '$env/dynamic/private';

/**
 * Read access to Webling, the club's member database, for the J+S person
 * export (AHV number, address, ...). Those fields are never stored in
 * Administra; they are fetched when an admin downloads the file.
 *
 * Configured with PRIVATE_WEBLING_DOMAIN and PRIVATE_WEBLING_API_KEY, read at
 * runtime. Set them for production only: dev and Deploy Previews hold
 * anonymized members, whose ids would otherwise pull real data.
 */

export interface WeblingMember {
  id: number;
  properties: Record<string, unknown>;
}

export class WeblingError extends Error {}

export function isWeblingConfigured(): boolean {
  return Boolean(env.PRIVATE_WEBLING_DOMAIN && env.PRIVATE_WEBLING_API_KEY);
}

/** All members with their properties, like the daily sync loads them. */
export async function fetchWeblingMembers(): Promise<WeblingMember[]> {
  if (!isWeblingConfigured()) throw new WeblingError('Webling is not configured');
  const url = new URL(`https://${env.PRIVATE_WEBLING_DOMAIN}.webling.ch/api/1/member`);
  url.searchParams.set('format', 'full');
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { apikey: env.PRIVATE_WEBLING_API_KEY! },
      signal: AbortSignal.timeout(20_000)
    });
  } catch (e) {
    // Never the URL or the error's cause: neither belongs in logs
    throw new WeblingError(`Webling not reachable (${e instanceof Error ? e.name : 'error'})`);
  }
  if (!response.ok) throw new WeblingError(`Webling answered HTTP ${response.status}`);
  const members = (await response.json()) as WeblingMember[];
  return Array.isArray(members) ? members : [];
}
