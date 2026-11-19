export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, `${what} nicht gefunden.`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);
export const conflict = (msg: string) => new AppError(409, msg);
