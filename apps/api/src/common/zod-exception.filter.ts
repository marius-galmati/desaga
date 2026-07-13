import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import { RequestValidationError } from "@ts-rest/nest";
import { ZodError } from "zod";

// Minimal response shape — avoids depending on express types in app code.
interface MinimalResponse {
  status(code: number): { json(body: unknown): void };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

function issuesOf(error: ZodError | null, source: string): ValidationIssue[] {
  if (!error) {
    return [];
  }
  return error.issues.map((issue) => ({
    path: [source, ...issue.path].join("."),
    message: issue.message,
  }));
}

/**
 * Turns zod validation failures into clean 400s:
 * - RequestValidationError: thrown by @ts-rest/nest when a request does not
 *   match the contract (body/query/params/headers).
 * - Raw ZodError: any schema.parse() an handler runs itself.
 * Body stays compatible with apiErrorSchema ({ message }) + `issues` detail.
 */
@Catch(ZodError, RequestValidationError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError | RequestValidationError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<MinimalResponse>();
    const issues =
      exception instanceof ZodError
        ? issuesOf(exception, "input")
        : [
            ...issuesOf(exception.pathParams, "params"),
            ...issuesOf(exception.headers, "headers"),
            ...issuesOf(exception.query, "query"),
            ...issuesOf(exception.body, "body"),
          ];
    response.status(400).json({ message: "Validation failed", issues });
  }
}
