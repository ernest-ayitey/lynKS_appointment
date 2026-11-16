import { apiClient } from '../../lib/api-client';

export interface RequestOtpResponse {
  requestId: string;
  expiresInSeconds: number;
}

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  accountId: string;
}

export function requestOtp(phone: string): Promise<RequestOtpResponse> {
  return apiClient.post<RequestOtpResponse>('/auth/patient/request-otp', { phone });
}

export function verifyOtp(requestId: string, code: string): Promise<VerifyOtpResponse> {
  return apiClient.post<VerifyOtpResponse>('/auth/patient/verify-otp', {
    requestId,
    code,
  });
}
