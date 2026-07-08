import { config } from "./config";

export function authorizeCron(request: Request): boolean {
  if (!config.cronSecret) return process.env.NODE_ENV === "development";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${config.cronSecret}`;
}
