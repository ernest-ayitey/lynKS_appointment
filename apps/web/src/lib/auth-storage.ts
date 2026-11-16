const ACCESS_TOKEN_KEY = 'lynks.auth.accessToken';
const REFRESH_TOKEN_KEY = 'lynks.auth.refreshToken';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function setTokens(tokens: Tokens): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export const authStorage = { setTokens, getAccessToken };
