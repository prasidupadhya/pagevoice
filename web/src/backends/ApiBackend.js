import * as client from "../api";

/** Adapter for the existing HTTP API transport. It never probes by itself. */
export class ApiBackend {
  constructor(transport = client) {
    this.mode = "api";
    this.transport = transport;
  }

  api(...args) {
    return this.transport.api(...args);
  }

  request(...args) {
    return this.transport.request(...args);
  }

  progressEvents(...args) {
    return this.transport.progressEvents(...args);
  }

  uploadBook(...args) {
    return this.transport.uploadBook(...args);
  }

  setAccessToken(...args) {
    return this.transport.setAccessToken(...args);
  }
}

/** Singleton service adapter used by the preserved API-backed reader. */
export const apiBackend = new ApiBackend();
export const API_BASE = client.API_BASE;
export const api = apiBackend.api.bind(apiBackend);
export const apiURL = client.apiURL;
export const request = apiBackend.request.bind(apiBackend);
export const progressEvents = apiBackend.progressEvents.bind(apiBackend);
export const setAccessToken = apiBackend.setAccessToken.bind(apiBackend);
export const uploadBook = apiBackend.uploadBook.bind(apiBackend);
