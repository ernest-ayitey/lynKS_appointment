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

export interface StaffLoginResponse {
  sessionToken: string;
  requiresTwoStep: boolean;
}

export interface StaffTwoStepRequestResponse {
  requestId: string;
}

export interface StaffTwoStepVerifyResponse {
  sessionToken: string;
}

export interface RoleLocationOption {
  staffUserLocationId: string;
  roleName: string;
  locationName: string;
}

export interface StaffFinalTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StaffRoleLocationOptions {
  options: RoleLocationOption[];
}

export type StaffRoleLocationResponse = StaffFinalTokens | StaffRoleLocationOptions;

export function staffLogin(email: string, password: string): Promise<StaffLoginResponse> {
  return apiClient.post<StaffLoginResponse>('/auth/staff/login', { email, password });
}

export function requestStaffTwoStep(
  sessionToken: string,
): Promise<StaffTwoStepRequestResponse> {
  return apiClient.post<StaffTwoStepRequestResponse>('/auth/staff/two-step/request', {
    sessionToken,
  });
}

export function verifyStaffTwoStep(
  sessionToken: string,
  requestId: string,
  code: string,
): Promise<StaffTwoStepVerifyResponse> {
  return apiClient.post<StaffTwoStepVerifyResponse>('/auth/staff/two-step/verify', {
    sessionToken,
    requestId,
    code,
  });
}

export function resolveRoleLocation(
  sessionToken: string,
  staffUserLocationId?: string,
): Promise<StaffRoleLocationResponse> {
  return apiClient.post<StaffRoleLocationResponse>('/auth/staff/role-location', {
    sessionToken,
    staffUserLocationId,
  });
}
