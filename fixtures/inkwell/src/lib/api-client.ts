import axios from "axios";

/** Shared HTTP client for the JSON API. */
export const http = axios.create({ baseURL: "/api", timeout: 10_000 });
