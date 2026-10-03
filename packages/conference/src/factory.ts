import {
  MeshConference,
  type MeshConferenceOptions
} from "./mesh-conference";
import type { ConferenceTransport } from "./transport";

export interface CreateConferenceTransportOptions
  extends MeshConferenceOptions {
  topology?: "mesh";
}

export function createConferenceTransport(
  options: CreateConferenceTransportOptions
): ConferenceTransport {
  return new MeshConference(options);
}
