// src/credentials/types.ts
export interface CredentialReader {
  read(): Promise<string | null>; // returns raw JSON string or null
}
