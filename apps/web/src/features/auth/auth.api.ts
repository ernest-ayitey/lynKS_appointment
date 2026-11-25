import { apiRequest } from '../../lib/api-client';

export async function checkUsernameAvailability(username: string): Promise<boolean> {
  const data = await apiRequest<{ available: boolean }>(
    `/auth/username-availability?username=${encodeURIComponent(username)}`,
  );
  return data.available;
}
