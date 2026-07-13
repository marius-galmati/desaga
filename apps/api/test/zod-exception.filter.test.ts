import type { ArgumentsHost } from "@nestjs/common";
import { RequestValidationError } from "@ts-rest/nest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ZodExceptionFilter } from "../src/common/zod-exception.filter";

function makeHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function zodErrorOf(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error("expected a zod failure");
  }
  return result.error;
}

const filter = new ZodExceptionFilter();

describe("ZodExceptionFilter", () => {
  it("maps a raw ZodError to a 400 with dotted issue paths", () => {
    const { host, status, json } = makeHost();
    const error = zodErrorOf(z.object({ email: z.string().email() }), { email: 42 });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0]?.[0] as { message: string; issues: { path: string }[] };
    expect(body.message).toBe("Validation failed");
    expect(body.issues[0]?.path).toBe("input.email");
  });

  it("flattens a ts-rest RequestValidationError across sources", () => {
    const { host, status, json } = makeHost();
    const bodyError = zodErrorOf(z.object({ password: z.string().min(8) }), { password: "x" });
    const queryError = zodErrorOf(z.object({ page: z.number() }), { page: "one" });
    const exception = new RequestValidationError(null, null, queryError, bodyError);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0]?.[0] as { message: string; issues: { path: string }[] };
    const paths = body.issues.map((i) => i.path);
    expect(paths).toContain("query.page");
    expect(paths).toContain("body.password");
  });
});
