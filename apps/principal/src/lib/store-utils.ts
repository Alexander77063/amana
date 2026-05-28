import { ApiError } from '@amana/api-client';

export const toErrorCode = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';
